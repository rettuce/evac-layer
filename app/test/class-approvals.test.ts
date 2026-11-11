import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { layoutDigest } from '../layout/gate.ts'
import { type HeadlineTables, headlineFromTables, headlineTableVersion } from '../layout/headlineTable.ts'
import { facilityRouteAllowed } from '../server/utils/adminPolicy.ts'
import { advanceSiteGeneration, guardedSiteWrite, stillSameSite, withSiteLock } from '../server/utils/siteLocks.ts'
import { REPO_ROOT, SERVER_ENTRY, postJson, startServer } from './helpers.ts'

const OPERATOR_TOKEN = 'operator-token-for-class-tests'
const TOKEN_A = 'facility-a-token-for-class-tests'
const TOKEN_B = 'facility-b-token-for-class-tests'
const FACILITY_A = 'alpha-fac'
const FACILITY_B = 'beta-fac'
const CLASS = 'landslide/evac-now/4'
const SOURCE_SITE = '15205-demo'
const REAL = 'VPWW56-202610311653-b3fa1b3a2ced'
const SYN = 'SYN-VPWW56-202411020800-314b561ca69f'
const MISSING = 'no-such-site'

const READY = 'alpha-1-ready'
const READY_TOO = 'alpha-2-ready'
const STALE = 'alpha-3-stale'
const FAILED = 'alpha-4-failed'
const STATIC_ONLY = 'alpha-5-static'
const DRAFT = 'alpha-6-draft'
const EMPTY = 'alpha-7-empty'
const OTHER = 'beta-1-ready'

const skip = !existsSync(SERVER_ENTRY) && 'run `pnpm -F app build` first'
const bearer = (token: string) => ({ authorization: `Bearer ${token}` })
const sha256 = (token: string) => createHash('sha256').update(token).digest('hex')
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const TOKENS_FILE = {
  version: '0.1',
  tokens: [
    { id: 'tok-a', label: 'alpha signage', facility_id: FACILITY_A, sha256: sha256(TOKEN_A), created_at: '2026-11-01T00:00:00Z' },
    { id: 'tok-b', label: 'beta signage', facility_id: FACILITY_B, sha256: sha256(TOKEN_B), created_at: '2026-11-01T00:00:00Z' },
  ],
}

type Report = Record<string, unknown>

// A class approval opens only screens whose headline is the JMA dictionary table's, so the copies carry the table's
// headline and a report of that check, against a reviewed copy of the tables.
async function reviewedTables(dataDir: string): Promise<HeadlineTables> {
  await cp(join(REPO_ROOT, 'data', 'jma'), join(dataDir, 'jma'), { recursive: true })
  const easyFile = join(dataDir, 'jma', 'warning-names-ja-easy.json')
  await writeFile(easyFile, JSON.stringify({ ...JSON.parse(await readFile(easyFile, 'utf8')), reviewed: true }))
  return { names: JSON.parse(await readFile(join(dataDir, 'jma', 'warning-names.json'), 'utf8')), easy: JSON.parse(await readFile(easyFile, 'utf8')) }
}

async function writeScreens(dataDir: string, site: string, bulletin: string, tables: HeadlineTables, report: (digest: string) => Report): Promise<void> {
  const found = headlineFromTables({ ja: 'レベル４土砂災害危険警報', name: 'レベル４土砂災害危険警報', cleared: false, drill: false }, tables)
  if (!('text' in found)) throw new Error(found.missing)
  const source = join(REPO_ROOT, 'data', 'layouts', SOURCE_SITE, REAL)
  const dir = join(dataDir, 'layouts', site, bulletin)
  await mkdir(dir, { recursive: true })
  const files: { shape: string; body: string }[] = []
  for (const name of (await readdir(source)).filter((f) => f.endsWith('.json'))) {
    const layout = JSON.parse(await readFile(join(source, name), 'utf8'))
    const cells = layout.cells.map((c: { role: string }) => (c.role === 'headline' ? { ...c, text: found.text } : c))
    const body = `${JSON.stringify({ ...layout, alert: { ...layout.alert, bulletin_id: bulletin }, cells, sources: layout.sources.map((s: { type: string }) => (s.type === 'jma' ? { ...s, bulletin_id: bulletin } : s)) }, null, 2)}\n`
    await writeFile(join(dir, name), body)
    files.push({ shape: name.slice(0, -5), body })
  }
  const digest = layoutDigest(files)
  await mkdir(join(dataDir, 'reports', site, bulletin), { recursive: true })
  await writeFile(join(dataDir, 'reports', site, bulletin, 'report.json'), JSON.stringify({
    outcome: 'pass', verifier: 'static+browser(test)', layout_digest: digest, browser_skipped: [], attempts: [{ n: 1, writer_source: 'writer-cache', findings: [], screens_ok: {} }],
    headline_table: { ok: true, table_version: headlineTableVersion(tables), layout_digest: digest, shapes: files.map((f) => f.shape) },
    ...report(digest),
  }))
}

const SYN_ROW = { issued_at: '2024-11-02T08:00:00+09:00', bulletin_id: SYN, wmo_code: 'VPWW56', raw_title: '新潟県土砂災害警報・注意報', municipality_level: 4, synthetic: true, screen: true, template: 'evac-now', display_level: 4 }
const REAL_ROW = { issued_at: '2026-10-31T16:53:00+09:00', bulletin_id: REAL, wmo_code: 'VPWW56', raw_title: '新潟県土砂災害警報・注意報', municipality_level: 4, screen: true, template: 'evac-now', display_level: 4 }

async function writeIndex(dataDir: string, site: string, rows: object[]): Promise<void> {
  await writeFile(join(dataDir, 'layouts', site, 'index.json'), JSON.stringify({ municipality: '15205', name: '柏崎市', site, entries: rows }))
}

async function makeData(): Promise<{ dataDir: string; tables: HeadlineTables }> {
  const dataDir = join(await mkdtemp(join(tmpdir(), 'evac-class-approvals-')), 'data')
  await mkdir(join(dataDir, 'sites'), { recursive: true })
  await writeFile(join(dataDir, 'tokens.json'), JSON.stringify(TOKENS_FILE), { mode: 0o600 })
  const tables = await reviewedTables(dataDir)
  const site = JSON.parse(await readFile(join(REPO_ROOT, 'data', 'sites', `${SOURCE_SITE}.json`), 'utf8'))
  const sites: [string, string, ((digest: string) => Report) | undefined, object?][] = [
    [READY, FACILITY_A, () => ({})],
    [READY_TOO, FACILITY_A, () => ({})],
    [STALE, FACILITY_A, () => ({}), { location_updated_at: '2099-01-01T00:00:00Z' }],
    [FAILED, FACILITY_A, () => ({ outcome: 'fail' })],
    [STATIC_ONLY, FACILITY_A, () => ({ verifier: 'static' })],
    [DRAFT, FACILITY_A, () => ({ attempts: [{ n: 1, writer_source: 'placeholder', findings: [], screens_ok: {} }] })],
    [EMPTY, FACILITY_A, undefined],
    [OTHER, FACILITY_B, () => ({})],
  ]
  for (const [id, facility, report, extra] of sites) {
    await writeFile(join(dataDir, 'sites', `${id}.json`), JSON.stringify({ ...site, id, facility_id: facility, ...extra }))
    if (!report) continue
    await writeScreens(dataDir, id, SYN, tables, report)
    await writeIndex(dataDir, id, [SYN_ROW])
  }
  return { dataDir, tables }
}

describe('class approvals', { skip }, () => {
  let base = ''
  let child: ChildProcess | undefined
  let dataDir = ''
  let tables: HeadlineTables

  const get = (path: string, token: string) => fetch(`${base}${path}`, { headers: bearer(token) })
  const bulk = (body: object, token: string) => postJson(base, '/api/admin/class-approvals', body, bearer(token))
  const approvalsFile = async () => JSON.parse(await readFile(join(dataDir, 'approvals.json'), 'utf8').catch(() => '{"layouts":{},"classes":{}}'))
  const auditLines = async (): Promise<Record<string, any>[]> => (await readFile(join(dataDir, 'audit.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map((line) => JSON.parse(line))

  before(async () => {
    ;({ dataDir, tables } = await makeData())
    ;({ base, child } = await startServer({ NUXT_DATA_DIR: dataDir, NUXT_ADMIN_TOKEN: OPERATOR_TOKEN }))
  })
  after(async () => {
    child?.kill()
    await rm(join(dataDir, '..'), { recursive: true, force: true })
  })

  test('a facility lists the classes of its own sites, with what a bulk approval would do at each', async () => {
    const response = await get('/api/admin/classes', TOKEN_A)
    assert.equal(response.status, 200)
    const { classes } = await response.json()
    assert.deepEqual(classes.map((c: { class: string }) => c.class), [CLASS])
    const [row] = classes
    assert.deepEqual(row.sites.map((s: { site_id: string }) => s.site_id), [READY, READY_TOO, STALE, FAILED, STATIC_ONLY, DRAFT])
    assert.deepEqual({ total: row.total, approved: row.approved, pending: row.pending, blocked: row.blocked, live: row.live }, {
      total: 6, approved: 0, pending: 2, blocked: { count: 4, reasons: ['draft-wording', 'not-passed', 'stale'] }, live: false,
    })
    const single = await (await get(`/api/admin/sites/${READY}`, TOKEN_A)).json()
    assert.deepEqual(row.sites[0].state, single.classes[0], 'the same state the site endpoint answers')
    assert.deepEqual(await (await get(`/api/admin/classes?facility_id=${FACILITY_B}`, TOKEN_A)).json(), { classes }, 'another facility id is ignored, as for the site list')
  })

  test('the operator names the facility', async () => {
    assert.equal((await get('/api/admin/classes', OPERATOR_TOKEN)).status, 400)
    assert.equal((await get('/api/admin/classes?facility_id=Not_An_Id', OPERATOR_TOKEN)).status, 400)
    const { classes } = await (await get(`/api/admin/classes?facility_id=${FACILITY_B}`, OPERATOR_TOKEN)).json()
    assert.deepEqual(classes[0].sites.map((s: { site_id: string }) => s.site_id), [OTHER])
    assert.equal((await bulk({ class: CLASS, approved: true }, OPERATOR_TOKEN)).status, 400, 'neither facility_id nor site_ids')
  })

  test('requests that do not validate answer 400 and change nothing', async () => {
    const before = await approvalsFile()
    const refused: object[] = [
      { class: 'tsunami/evac-now/4/drill', approved: true },
      { class: 'landslide/evac-now/4/test', approved: true },
      { class: 'Landslide/evac-now/4', approved: true },
      { class: 'landslide/evac-now', approved: true },
      { class: CLASS },
      { class: CLASS, approved: 'yes' },
      { class: CLASS, approved: true, site_ids: [] },
      { class: CLASS, approved: true, site_ids: ['../etc'] },
      { class: CLASS, approved: true, site_ids: [READY, 7] },
      { class: CLASS, approved: true, site_ids: Array.from({ length: 1000 }, (_, i) => `site-${i}`) },
      { class: CLASS, approved: true, unknown: 1 },
    ]
    for (const body of refused) {
      const response = await bulk(body, TOKEN_A)
      assert.equal(response.status, 400, JSON.stringify(body).slice(0, 120))
      assert.equal((await response.json()).data?.code, 'invalid-request')
    }
    assert.deepEqual(await approvalsFile(), before)
  })

  test('a site of another facility and a site that does not exist are skipped alike', async () => {
    const before = await approvalsFile()
    const only = async (site: string) => {
      const response = await bulk({ class: CLASS, approved: true, site_ids: [site] }, TOKEN_A)
      return { status: response.status, body: (await response.text()).replaceAll(site, '<asked>') }
    }
    const missing = await only(MISSING)
    assert.equal(missing.status, 200)
    assert.deepEqual(JSON.parse(missing.body).results, [{ site_id: '<asked>', result: 'skipped', reason: 'not-found' }])
    assert.deepEqual(await only(OTHER), missing)
    const mixed = await (await bulk({ class: CLASS, approved: false, site_ids: [OTHER, MISSING] }, TOKEN_A)).json()
    assert.deepEqual(mixed.results.map((r: object) => ({ ...r, site_id: '<asked>' })), Array(2).fill({ site_id: '<asked>', result: 'skipped', reason: 'not-found' }))
    assert.deepEqual(await approvalsFile(), before)
  })

  test('a bulk approval approves the sites whose screens may go out and tells why the others were skipped', async () => {
    const response = await bulk({ class: CLASS, approved: true, actor: { id: 'staff-9', name: '承認 担当' } }, TOKEN_A)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.class, CLASS)
    assert.deepEqual(body.results.map((r: { site_id: string; result: string; reason?: string }) => [r.site_id, r.result, r.reason]), [
      [READY, 'approved', undefined],
      [READY_TOO, 'approved', undefined],
      [STALE, 'skipped', 'stale'],
      [FAILED, 'skipped', 'not-passed'],
      [STATIC_ONLY, 'skipped', 'not-passed'],
      [DRAFT, 'skipped', 'draft-wording'],
      [EMPTY, 'skipped', 'no-screens'],
    ])
    const [ready] = body.results
    assert.equal(ready.state.approved, true)
    assert.deepEqual(ready.state.approved_by, { token_label: 'alpha signage', mode: 'bulk', actor: { id: 'staff-9', name: '承認 担当' } })
    assert.equal(body.results[2].state.approved, false)
    assert.equal(body.results[6].state, undefined)

    const approvals = await approvalsFile()
    assert.equal(approvals.classes[`${READY}/${CLASS}`].mode, 'bulk')
    assert.equal(approvals.classes[`${READY}/${CLASS}`].approved_from, SYN)
    assert.equal(approvals.layouts[`${READY}/${SYN}`].mode, 'bulk')
    assert.deepEqual(Object.keys(approvals.classes).sort(), [`${READY}/${CLASS}`, `${READY_TOO}/${CLASS}`])

    const { classes } = await (await get('/api/admin/classes', TOKEN_A)).json()
    assert.deepEqual([classes[0].approved, classes[0].pending, classes[0].blocked.count], [2, 0, 4])

    let line: Record<string, any> | undefined
    for (let i = 0; i < 40 && !line; i++, await sleep(50)) line = (await auditLines()).find((l) => l.path === '/api/admin/class-approvals' && l.status === 200 && l.actor?.id === 'staff-9')
    assert.ok(line, 'one audit line for the bulk approval')
    assert.deepEqual(line.class_approvals, { class: CLASS, approved: true, results: { approved: 2, revoked: 0, skipped: 5 } })
    assert.deepEqual(line.actor, { id: 'staff-9', name: '承認 担当' })
  })

  test('a later real bulletin of the class goes out on the bulk approval', async () => {
    await writeScreens(dataDir, READY, REAL, tables, () => ({}))
    await writeIndex(dataDir, READY, [SYN_ROW, REAL_ROW])
    assert.equal((await postJson(base, '/api/admin/site', { site_id: READY, auto_publish: true }, bearer(TOKEN_A))).status, 200)
    assert.equal((await postJson(base, '/api/admin/live', { site_id: READY, bulletin_id: REAL }, bearer(OPERATOR_TOKEN))).status, 200)
    const feed = await (await fetch(`${base}/api/feed/${READY}`)).json()
    assert.deepEqual([feed.state, feed.bulletin_id], ['alert', REAL])
    const { classes } = await (await get('/api/admin/classes', TOKEN_A)).json()
    assert.equal(classes[0].live, true)
  })

  test('a bulk revocation revokes the class where it is approved and skips the sites without one', async () => {
    const body = await (await bulk({ class: CLASS, approved: false, site_ids: [READY_TOO, FAILED, READY_TOO] }, TOKEN_A)).json()
    assert.deepEqual(body.results.map((r: { site_id: string; result: string; reason?: string }) => [r.site_id, r.result, r.reason]), [
      [READY_TOO, 'revoked', undefined],
      [FAILED, 'skipped', 'not-approved'],
    ])
    assert.equal(body.results[0].state.approved, false)
    const approvals = await approvalsFile()
    assert.equal(approvals.classes[`${READY_TOO}/${CLASS}`].approved, false)
    assert.equal(approvals.classes[`${READY}/${CLASS}`].approved, true, 'a site not named keeps its approval')
  })

  test('the operator approves the sites of the facility it names', async () => {
    const body = await (await bulk({ class: CLASS, approved: true, facility_id: FACILITY_B }, OPERATOR_TOKEN)).json()
    assert.deepEqual(body.results.map((r: { site_id: string; result: string }) => [r.site_id, r.result]), [[OTHER, 'approved']])
    assert.equal(body.results[0].state.approved_by.token_label, 'operator')
    const named = await (await bulk({ class: CLASS, approved: false, facility_id: FACILITY_B, site_ids: [OTHER, READY] }, OPERATOR_TOKEN)).json()
    assert.deepEqual(named.results.map((r: { result: string; reason?: string }) => [r.result, r.reason]), [['revoked', undefined], ['skipped', 'not-found']], 'a site outside the named facility')
  })

  test('an approval records whether a person named the screens they looked at', async () => {
    const state = await (await get(`/api/admin/sites/${READY_TOO}`, TOKEN_A)).json()
    const reviewed = await postJson(base, '/api/admin/approve', { site_id: READY_TOO, bulletin_id: SYN, approved: true, digest: state.classes[0].digest }, bearer(TOKEN_A))
    assert.equal(reviewed.status, 200)
    assert.equal((await reviewed.json()).mode, 'reviewed')
    let approvals = await approvalsFile()
    assert.equal(approvals.layouts[`${READY_TOO}/${SYN}`].mode, 'reviewed')
    assert.equal(approvals.classes[`${READY_TOO}/${CLASS}`].mode, 'reviewed')
    assert.equal((await (await get(`/api/admin/sites/${READY_TOO}`, TOKEN_A)).json()).classes[0].approved_by.mode, 'reviewed')
    assert.equal((await postJson(base, '/api/admin/approve', { site_id: READY_TOO, bulletin_id: SYN, approved: true }, bearer(TOKEN_A))).status, 200)
    approvals = await approvalsFile()
    assert.equal(approvals.layouts[`${READY_TOO}/${SYN}`].mode, 'bulk')
    assert.equal(approvals.classes[`${READY_TOO}/${CLASS}`].mode, 'bulk')
  })
})

describe('class approval paths and the site guard', () => {
  test('a facility credential reaches the two class paths', () => {
    assert.equal(facilityRouteAllowed('GET', '/api/admin/classes'), true)
    assert.equal(facilityRouteAllowed('POST', '/api/admin/class-approvals'), true)
    assert.equal(facilityRouteAllowed('POST', '/api/admin/classes'), false)
    assert.equal(facilityRouteAllowed('GET', '/api/admin/class-approvals'), false)
  })

  test('a site deleted and registered again after its classes were read gets no approval, whoever may see it', async () => {
    const writes: string[] = []
    const seenByOperator = stillSameSite('reused-id', async () => true)
    await withSiteLock('reused-id', async () => advanceSiteGeneration('reused-id'))
    assert.equal(await guardedSiteWrite('reused-id', { visible: seenByOperator, write: async () => writes.push('approval') }), undefined)

    let release = () => {}
    const deleting = withSiteLock('held-id', () => new Promise<void>((resolve) => (release = () => (advanceSiteGeneration('held-id'), resolve()))))
    const waiting = guardedSiteWrite('held-id', { visible: stillSameSite('held-id', async () => true), write: async () => writes.push('approval') })
    await sleep(10)
    release()
    await deleting
    assert.equal(await waiting, undefined)
    assert.deepEqual(writes, [])

    assert.deepEqual(await guardedSiteWrite('fresh-id', { visible: stillSameSite('fresh-id', async () => true), write: async () => 'written' }), { value: 'written' })
  })
})
