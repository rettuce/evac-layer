import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { layoutDigest } from '../layout/gate.ts'
import { type HeadlineTables, type HeadlineText, headlineFromTables, headlineTableVersion } from '../layout/headlineTable.ts'
import { facilityRouteAllowed } from '../server/utils/adminPolicy.ts'
import { DRAFT_WRITER_SOURCE, REAL_WRITER_SOURCES, REAL_WRITER_SOURCE_PREFIXES, approveRechecked, wordingOf } from '../server/utils/classApprovalSteps.ts'
import { advanceSiteGeneration, guardedSiteWrite, stillSameSite, withSiteLock } from '../server/utils/siteLocks.ts'
import { REPO_ROOT, SERVER_ENTRY, postJson, startServer } from './helpers.ts'

const OPERATOR_TOKEN = 'operator-token-for-class-tests'
const TOKEN_A = 'facility-a-token-for-class-tests'
const TOKEN_B = 'facility-b-token-for-class-tests'
const FACILITY_A = 'alpha-fac'
const FACILITY_B = 'beta-fac'
const FACILITY_C = 'gamma-fac'
const CLASS = 'landslide/evac-now/4'
const SOURCE_SITE = '15205-demo'
const REAL = 'VPWW56-202610311653-b3fa1b3a2ced'
const SYN = 'SYN-VPWW56-202411020800-314b561ca69f'
const MISSING = 'no-such-site'
const GAMMA_SITES = 201

const READY = 'alpha-01-ready'
const READY_TOO = 'alpha-02-ready'
const STALE = 'alpha-03-stale'
const FAILED = 'alpha-04-failed'
const STATIC_ONLY = 'alpha-05-static'
const DRAFT = 'alpha-06-draft'
const EMPTY = 'alpha-07-empty'
const HEADLINE = 'alpha-08-headline'
const NO_SOURCE = 'alpha-09-no-source'
const UNKNOWN_SOURCE = 'alpha-10-unknown-source'
const UNREVIEWED = 'alpha-11-unreviewed'
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
const attempt = (source?: string) => ({ attempts: [{ n: 1, ...(source === undefined ? {} : { writer_source: source }), findings: [], screens_ok: {} }] })

// A class approval opens only screens whose headline is the JMA dictionary table's, so the copies carry the table's
// headline and a report of that check, against a reviewed copy of the tables.
async function reviewedTables(dataDir: string): Promise<HeadlineTables> {
  await cp(join(REPO_ROOT, 'data', 'jma'), join(dataDir, 'jma'), { recursive: true })
  await setReviewed(dataDir, true)
  const easy = JSON.parse(await readFile(join(dataDir, 'jma', 'warning-names-ja-easy.json'), 'utf8'))
  return { names: JSON.parse(await readFile(join(dataDir, 'jma', 'warning-names.json'), 'utf8')), easy }
}

async function setReviewed(dataDir: string, reviewed: boolean): Promise<void> {
  const easyFile = join(dataDir, 'jma', 'warning-names-ja-easy.json')
  await writeFile(easyFile, JSON.stringify({ ...JSON.parse(await readFile(easyFile, 'utf8')), reviewed }))
}

async function writeScreens(dataDir: string, site: string, bulletin: string, tables: HeadlineTables, report: Report = {}, headline?: (text: HeadlineText) => HeadlineText): Promise<void> {
  const found = headlineFromTables({ ja: 'レベル４土砂災害危険警報', name: 'レベル４土砂災害危険警報', cleared: false, drill: false }, tables)
  if (!('text' in found)) throw new Error(found.missing)
  const text = headline ? headline(found.text) : found.text
  const source = join(REPO_ROOT, 'data', 'layouts', SOURCE_SITE, REAL)
  const dir = join(dataDir, 'layouts', site, bulletin)
  await mkdir(dir, { recursive: true })
  const files: { shape: string; body: string }[] = []
  for (const name of (await readdir(source)).filter((f) => f.endsWith('.json'))) {
    const layout = JSON.parse(await readFile(join(source, name), 'utf8'))
    const cells = layout.cells.map((c: { role: string }) => (c.role === 'headline' ? { ...c, text } : c))
    const body = `${JSON.stringify({ ...layout, alert: { ...layout.alert, bulletin_id: bulletin }, cells, sources: layout.sources.map((s: { type: string }) => (s.type === 'jma' ? { ...s, bulletin_id: bulletin } : s)) }, null, 2)}\n`
    await writeFile(join(dir, name), body)
    files.push({ shape: name.slice(0, -5), body })
  }
  const digest = layoutDigest(files)
  await mkdir(join(dataDir, 'reports', site, bulletin), { recursive: true })
  await writeFile(join(dataDir, 'reports', site, bulletin, 'report.json'), JSON.stringify({
    outcome: 'pass', verifier: 'static+browser(test)', layout_digest: digest, browser_skipped: [], ...attempt('writer-cache'),
    headline_table: { ok: true, table_version: headlineTableVersion(tables), layout_digest: digest, shapes: files.map((f) => f.shape) },
    ...report,
  }))
}

const SYN_ROW = { issued_at: '2024-11-02T08:00:00+09:00', bulletin_id: SYN, wmo_code: 'VPWW56', raw_title: '新潟県土砂災害警報・注意報', municipality_level: 4, synthetic: true, screen: true, template: 'evac-now', display_level: 4 }
const REAL_ROW = { issued_at: '2026-10-31T16:53:00+09:00', bulletin_id: REAL, wmo_code: 'VPWW56', raw_title: '新潟県土砂災害警報・注意報', municipality_level: 4, screen: true, template: 'evac-now', display_level: 4 }

async function writeIndex(dataDir: string, site: string, rows: object[]): Promise<void> {
  await writeFile(join(dataDir, 'layouts', site, 'index.json'), JSON.stringify({ municipality: '15205', name: '柏崎市', site, entries: rows }))
}

async function addReal(dataDir: string, site: string, tables: HeadlineTables): Promise<void> {
  await writeScreens(dataDir, site, REAL, tables)
  await writeIndex(dataDir, site, [SYN_ROW, REAL_ROW])
}

async function makeData(): Promise<{ dataDir: string; tables: HeadlineTables }> {
  const dataDir = join(await mkdtemp(join(tmpdir(), 'evac-class-approvals-')), 'data')
  await mkdir(join(dataDir, 'sites'), { recursive: true })
  await writeFile(join(dataDir, 'tokens.json'), JSON.stringify(TOKENS_FILE), { mode: 0o600 })
  const tables = await reviewedTables(dataDir)
  const site = JSON.parse(await readFile(join(REPO_ROOT, 'data', 'sites', `${SOURCE_SITE}.json`), 'utf8'))
  const offTable = (text: HeadlineText) => ({ ...text, en: `${text.en} (edited)` })
  const sites: [string, string, (() => Promise<void>) | undefined, object?][] = [
    [READY, FACILITY_A, () => writeScreens(dataDir, READY, SYN, tables)],
    [READY_TOO, FACILITY_A, () => writeScreens(dataDir, READY_TOO, SYN, tables)],
    [STALE, FACILITY_A, () => writeScreens(dataDir, STALE, SYN, tables), { location_updated_at: '2099-01-01T00:00:00Z' }],
    [FAILED, FACILITY_A, () => writeScreens(dataDir, FAILED, SYN, tables, { outcome: 'fail' })],
    [STATIC_ONLY, FACILITY_A, () => writeScreens(dataDir, STATIC_ONLY, SYN, tables, { verifier: 'static' })],
    [DRAFT, FACILITY_A, () => writeScreens(dataDir, DRAFT, SYN, tables, attempt(DRAFT_WRITER_SOURCE))],
    [EMPTY, FACILITY_A, undefined],
    [HEADLINE, FACILITY_A, () => writeScreens(dataDir, HEADLINE, SYN, tables, {}, offTable)],
    [NO_SOURCE, FACILITY_A, () => writeScreens(dataDir, NO_SOURCE, SYN, tables, attempt())],
    [UNKNOWN_SOURCE, FACILITY_A, () => writeScreens(dataDir, UNKNOWN_SOURCE, SYN, tables, attempt('fixture:writer.json'))],
    [UNREVIEWED, FACILITY_A, () => writeScreens(dataDir, UNREVIEWED, SYN, tables)],
    [OTHER, FACILITY_B, () => writeScreens(dataDir, OTHER, SYN, tables)],
  ]
  for (const [id, facility, screens, extra] of sites) {
    await writeFile(join(dataDir, 'sites', `${id}.json`), JSON.stringify({ ...site, id, facility_id: facility, ...extra }))
    if (!screens) continue
    await screens()
    await writeIndex(dataDir, id, [SYN_ROW])
  }
  for (let i = 0; i < GAMMA_SITES; i++) await writeFile(join(dataDir, 'sites', `gamma-${i}.json`), JSON.stringify({ ...site, id: `gamma-${i}`, facility_id: FACILITY_C }))
  return { dataDir, tables }
}

const rows = (results: { site_id: string; result: string; reason?: string }[]) => results.map((r) => [r.site_id, r.result, r.reason])

describe('class approvals', { skip }, () => {
  let base = ''
  let child: ChildProcess | undefined
  let dataDir = ''
  let tables: HeadlineTables

  const get = (path: string, token: string) => fetch(`${base}${path}`, { headers: bearer(token) })
  const bulk = (body: object, token: string) => postJson(base, '/api/admin/class-approvals', body, bearer(token))
  const approvalsFile = async () => JSON.parse(await readFile(join(dataDir, 'approvals.json'), 'utf8').catch(() => '{"layouts":{},"classes":{}}'))
  const auditLines = async (): Promise<Record<string, any>[]> => (await readFile(join(dataDir, 'audit.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map((line) => JSON.parse(line))
  const feed = async (site: string) => (await fetch(`${base}/api/feed/${site}`)).json()
  const goLive = async (site: string) => {
    assert.equal((await postJson(base, '/api/admin/site', { site_id: site, auto_publish: true }, bearer(TOKEN_A))).status, 200)
    assert.equal((await postJson(base, '/api/admin/live', { site_id: site, bulletin_id: REAL }, bearer(OPERATOR_TOKEN))).status, 200)
  }

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
    assert.deepEqual(row.sites.map((s: { site_id: string }) => s.site_id), [READY, READY_TOO, STALE, FAILED, STATIC_ONLY, DRAFT, HEADLINE, NO_SOURCE, UNKNOWN_SOURCE, UNREVIEWED])
    assert.deepEqual({ total: row.total, approved: row.approved, pending: row.pending, blocked: row.blocked, live: row.live }, {
      total: 10, approved: 0, pending: 3, blocked: { count: 7, reasons: ['draft-wording', 'headline-unchecked', 'not-passed', 'stale', 'wording-unknown'] }, live: false,
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
    const refused: [object, string][] = [
      [{ class: 'tsunami/evac-now/4/drill', approved: true }, 'invalid-request'],
      [{ class: 'landslide/evac-now/4/test', approved: true }, 'invalid-request'],
      [{ class: 'Landslide/evac-now/4', approved: true }, 'invalid-request'],
      [{ class: 'landslide/evac-now', approved: true }, 'invalid-request'],
      [{ class: CLASS }, 'invalid-request'],
      [{ class: CLASS, approved: 'yes' }, 'invalid-request'],
      [{ class: CLASS, approved: true, site_ids: [] }, 'invalid-request'],
      [{ class: CLASS, approved: true, site_ids: ['../etc'] }, 'invalid-request'],
      [{ class: CLASS, approved: true, site_ids: [READY, 7] }, 'invalid-request'],
      [{ class: CLASS, approved: true, unknown: 1 }, 'invalid-request'],
      [{ class: CLASS, approved: true, site_ids: [READY], actor: { id: 'staff\n9' } }, 'invalid-request'],
      [{ class: CLASS, approved: true, site_ids: [READY], actor: { id: 'staff-9', name: 'a\u0007b' } }, 'invalid-request'],
      [{ class: CLASS, approved: true, site_ids: Array.from({ length: 1000 }, (_, i) => `site-${i}`) }, 'too-many-sites'],
      [{ class: CLASS, approved: true, site_ids: Array.from({ length: 1000 }, () => READY) }, 'too-many-sites'],
    ]
    for (const [body, code] of refused) {
      const response = await bulk(body, TOKEN_A)
      assert.equal(response.status, 400, JSON.stringify(body).slice(0, 120))
      assert.equal((await response.json()).data?.code, code, JSON.stringify(body).slice(0, 120))
    }
    const facilityTooLarge = await bulk({ class: CLASS, approved: true, facility_id: FACILITY_C }, OPERATOR_TOKEN)
    assert.equal(facilityTooLarge.status, 400)
    assert.equal((await facilityTooLarge.json()).data?.code, 'too-many-sites')
    assert.equal((await bulk({ class: CLASS, approved: true, facility_id: FACILITY_C, site_ids: ['gamma-0', 'gamma-1'] }, OPERATOR_TOKEN)).status, 200, 'named sites of a large facility')
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

  test('a bulk approval writes class approvals only, at the sites whose screens may go out, and tells why the others were skipped', async () => {
    const response = await bulk({ class: CLASS, approved: true, actor: { id: 'staff-9', name: '承認 担当' } }, TOKEN_A)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.class, CLASS)
    assert.deepEqual(rows(body.results), [
      [READY, 'approved', undefined],
      [READY_TOO, 'approved', undefined],
      [STALE, 'skipped', 'stale'],
      [FAILED, 'skipped', 'not-passed'],
      [STATIC_ONLY, 'skipped', 'not-passed'],
      [DRAFT, 'skipped', 'draft-wording'],
      [EMPTY, 'skipped', 'no-screens'],
      [HEADLINE, 'skipped', 'headline-unchecked'],
      [NO_SOURCE, 'skipped', 'wording-unknown'],
      [UNKNOWN_SOURCE, 'skipped', 'wording-unknown'],
      [UNREVIEWED, 'approved', undefined],
    ])
    const [ready] = body.results
    assert.equal(ready.state.approved, true)
    assert.equal(ready.state.approved_via, 'class')
    assert.deepEqual(ready.state.approved_by, { token_label: 'alpha signage', mode: 'bulk', actor: { id: 'staff-9', name: '承認 担当' } })
    assert.equal(body.results[2].state.approved, false)
    assert.equal(body.results[6].state, undefined)

    const approvals = await approvalsFile()
    assert.deepEqual(approvals.layouts, {}, 'no bulletin approval is written')
    assert.deepEqual(Object.keys(approvals.classes).sort(), [READY, READY_TOO, UNREVIEWED].map((site) => `${site}/${CLASS}`))
    const record = approvals.classes[`${READY}/${CLASS}`]
    assert.deepEqual({ ...record, updated_at: undefined, digest: undefined }, {
      approved: true, approved_from: SYN, mode: 'bulk', token_label: 'alpha signage', actor: { id: 'staff-9', name: '承認 担当' }, updated_at: undefined, digest: undefined,
    })

    const { classes } = await (await get('/api/admin/classes', TOKEN_A)).json()
    assert.deepEqual([classes[0].approved, classes[0].pending, classes[0].blocked.count, classes[0].total], [3, 0, 7, 10])

    let line: Record<string, any> | undefined
    for (let i = 0; i < 40 && !line; i++, await sleep(50)) line = (await auditLines()).find((l) => l.path === '/api/admin/class-approvals' && l.status === 200 && l.actor?.id === 'staff-9')
    assert.ok(line, 'one audit line for the bulk approval')
    assert.deepEqual(line.class_approvals, { class: CLASS, approved: true, results: { approved: 3, revoked: 0, skipped: 8 } })
  })

  test('a real bulletin whose headline is not the table\'s is skipped and not delivered', async () => {
    await writeScreens(dataDir, HEADLINE, REAL, tables, {}, (text) => ({ ...text, en: `${text.en} (edited)` }))
    await writeIndex(dataDir, HEADLINE, [SYN_ROW, REAL_ROW])
    const body = await (await bulk({ class: CLASS, approved: true, site_ids: [HEADLINE] }, TOKEN_A)).json()
    assert.deepEqual(rows(body.results), [[HEADLINE, 'skipped', 'headline-unchecked']])
    assert.equal(body.results[0].state.bulletin_id, REAL)
    await goLive(HEADLINE)
    assert.equal((await feed(HEADLINE)).state, 'ambient')
  })

  test('a later real bulletin of the class goes out on the bulk approval; approving its class again and revoking leaves nothing out', async () => {
    await addReal(dataDir, READY, tables)
    await goLive(READY)
    assert.deepEqual(await feed(READY).then((f) => [f.state, f.bulletin_id]), ['alert', REAL])
    assert.equal((await (await get('/api/admin/classes', TOKEN_A)).json()).classes[0].live, true)

    const again = await (await bulk({ class: CLASS, approved: true, site_ids: [READY] }, TOKEN_A)).json()
    assert.deepEqual(rows(again.results), [[READY, 'approved', undefined]])
    assert.equal((await approvalsFile()).classes[`${READY}/${CLASS}`].approved_from, REAL)
    const revoked = await (await bulk({ class: CLASS, approved: false, site_ids: [READY] }, TOKEN_A)).json()
    assert.deepEqual(rows(revoked.results), [[READY, 'revoked', undefined]])
    assert.equal(revoked.results[0].bulletin_approvals_left, undefined)
    assert.equal(revoked.results[0].state.approved, false)
    assert.equal((await feed(READY)).state, 'ambient')
    const approvals = await approvalsFile()
    assert.deepEqual(approvals.layouts, {})
    assert.deepEqual({ approved: approvals.classes[`${READY}/${CLASS}`].approved, mode: approvals.classes[`${READY}/${CLASS}`].mode, actor: approvals.classes[`${READY}/${CLASS}`].actor }, { approved: false, mode: 'bulk', actor: undefined })
  })

  test('a bulk revocation leaves bulletin approvals alone and names the bulletins that still go out', async () => {
    await addReal(dataDir, READY_TOO, tables)
    assert.equal((await postJson(base, '/api/admin/approve', { site_id: READY_TOO, bulletin_id: REAL, approved: true }, bearer(TOKEN_A))).status, 200)
    const body = await (await bulk({ class: CLASS, approved: false, site_ids: [READY_TOO, FAILED, READY_TOO] }, TOKEN_A)).json()
    assert.deepEqual(rows(body.results), [[READY_TOO, 'revoked', undefined], [FAILED, 'skipped', 'not-approved']])
    assert.deepEqual(body.results[0].bulletin_approvals_left, [REAL])
    assert.equal(body.results[0].state.approved, true, 'its bulletin approval still holds')
    assert.equal(body.results[0].state.approved_via, 'bulletin')
    const approvals = await approvalsFile()
    assert.equal(approvals.classes[`${READY_TOO}/${CLASS}`].approved, false)
    assert.equal(approvals.layouts[`${READY_TOO}/${REAL}`].approved, true)
    const { classes } = await (await get('/api/admin/classes', TOKEN_A)).json()
    assert.equal(classes[0].approved, 1, 'a bulletin approval alone is not counted as the class approved')
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
    const reviewed = await postJson(base, '/api/admin/approve', { site_id: READY_TOO, bulletin_id: REAL, approved: true, digest: state.classes[0].digest }, bearer(TOKEN_A))
    assert.equal(reviewed.status, 200)
    assert.equal((await reviewed.json()).mode, 'reviewed')
    let approvals = await approvalsFile()
    assert.equal(approvals.layouts[`${READY_TOO}/${REAL}`].mode, 'reviewed')
    assert.equal(approvals.classes[`${READY_TOO}/${CLASS}`].mode, 'reviewed')
    assert.equal((await (await get(`/api/admin/sites/${READY_TOO}`, TOKEN_A)).json()).classes[0].approved_by.mode, 'reviewed')
    assert.equal((await postJson(base, '/api/admin/approve', { site_id: READY_TOO, bulletin_id: REAL, approved: true }, bearer(TOKEN_A))).status, 200)
    approvals = await approvalsFile()
    assert.equal(approvals.layouts[`${READY_TOO}/${REAL}`].mode, 'bulk')
    assert.equal(approvals.classes[`${READY_TOO}/${CLASS}`].mode, 'bulk')
  })

  test('while the ja_easy table is unreviewed, a site whose headline is the table\'s is approved by class but nothing goes out', async () => {
    assert.equal((await (await bulk({ class: CLASS, approved: false, site_ids: [UNREVIEWED] }, TOKEN_A)).json()).results[0].result, 'revoked')
    await addReal(dataDir, UNREVIEWED, tables)
    await setReviewed(dataDir, false)
    try {
      const body = await (await bulk({ class: CLASS, approved: true, site_ids: [UNREVIEWED] }, TOKEN_A)).json()
      assert.deepEqual(rows(body.results), [[UNREVIEWED, 'approved', undefined]])
      assert.equal((await approvalsFile()).classes[`${UNREVIEWED}/${CLASS}`].approved, true)
      await goLive(UNREVIEWED)
      assert.equal((await feed(UNREVIEWED)).state, 'ambient')
    } finally {
      await setReviewed(dataDir, true)
    }
    assert.equal((await feed(UNREVIEWED)).state, 'alert', 'the same class approval opens it once the table is reviewed')
  })
})

describe('class approval paths, steps and the site guard', () => {
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

  test('a site that moves, or whose screens change, between the judgement and the write gets no approval', async () => {
    for (const [label, change, expected] of [
      ['moved', (s: { stale: boolean; digest: string }) => ({ ...s, stale: true }), 'stale'],
      ['composed again', (s: { stale: boolean; digest: string }) => ({ ...s, digest: 'sha256:other' }), 'changed'],
    ] as const) {
      const id = `moving-${label.replace(' ', '-')}`
      let current = { bulletin_id: 'B1', digest: 'sha256:one', class_digest: 'sha256:class', stale: false }
      const writes: string[] = []
      let release = () => {}
      const held = withSiteLock(id, () => new Promise<void>((resolve) => (release = () => ((current = change(current)), resolve()))))
      const pending = approveRechecked({
        read: async () => current,
        block: async (seen) => (seen.stale ? 'stale' : undefined),
        guard: (write) => guardedSiteWrite(id, { visible: stillSameSite(id, async () => true), write }),
        write: async () => void writes.push('class approval'),
      })
      await sleep(10)
      release()
      await held
      assert.equal(await pending, expected, label)
      assert.deepEqual(writes, [], label)
    }
  })

  test('only Writer sources known to be real wording pass, and they are the ones the agents write', async () => {
    assert.equal(wordingOf({ attempts: [{ writer_source: 'placeholder' }, { writer_source: 'writer-cache' }] }), 'real')
    assert.equal(wordingOf({ attempts: [{ writer_source: 'writer-api:opus' }] }), 'real')
    assert.equal(wordingOf({ attempts: [{ writer_source: 'writer-class-cache:VPWW56-1' }] }), 'real')
    assert.equal(wordingOf({ attempts: [{ writer_source: 'writer-cache' }, { writer_source: 'placeholder' }] }), 'draft')
    for (const report of [undefined, {}, { attempts: [] }, { attempts: [{}] }, { attempts: [{ writer_source: 'fixture:w.json' }] }, { attempts: [{ writer_source: 'writer-api:' }] }, { attempts: [{ writer_source: 7 }] }]) {
      assert.equal(wordingOf(report), 'unknown', JSON.stringify(report))
    }
    const files = ['writer/step.ts', 'loop/revisers.ts', 'loop/cli.ts'].map((f) => join(REPO_ROOT, 'agents', 'src', f))
    const written = new Set<string>()
    for (const file of files) {
      const text = await readFile(file, 'utf8')
      for (const match of text.matchAll(/(?:writerSource|source)(?:\s*=\s*|:\s*)["`]([a-z-]+)(:?)/g)) written.add(`${match[1]}${match[2]}`)
      for (const match of text.matchAll(/fixed\([^,]+,\s*["`]([a-z-]+)(:?)/g)) written.add(`${match[1]}${match[2]}`)
    }
    const known = new Set([DRAFT_WRITER_SOURCE, ...REAL_WRITER_SOURCES, ...REAL_WRITER_SOURCE_PREFIXES, 'fixture:'])
    assert.deepEqual([...written].sort(), [...known].sort(), 'a Writer source the agents write that the bulk approval does not classify, or one it lists that the agents no longer write')
  })
})
