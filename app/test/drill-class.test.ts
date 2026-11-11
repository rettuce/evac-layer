import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { classDigest, layoutDigest } from '../layout/gate.ts'
import { type HeadlineTables, headlineFromTables, headlineTableVersion } from '../layout/headlineTable.ts'
import { REPO_ROOT, SERVER_ENTRY, postJson, startServer } from './helpers.ts'

const DRILL_SITE = '22424-demo'
const DRILL = 'VTSE41-201609010713-ff3dd5d5c94f'
const NORMAL_SITE = '15205-demo'
const NORMAL = 'VPWW56-202610311653-b3fa1b3a2ced'
const TEST_SITE = '15205-test-status'
const LIVE_SITE = '15205-live-copy'

const skip = !existsSync(SERVER_ENTRY) && 'run `pnpm -F app build` first'

async function makeData(): Promise<string> {
  const dataDir = join(await mkdtemp(join(tmpdir(), 'evac-drill-class-')), 'data')
  await mkdir(join(dataDir, 'sites'), { recursive: true })
  for (const [site, bulletin] of [[DRILL_SITE, DRILL], [NORMAL_SITE, NORMAL]] as const) {
    await cp(join(REPO_ROOT, 'data', 'sites', `${site}.json`), join(dataDir, 'sites', `${site}.json`))
    await cp(join(REPO_ROOT, 'data', 'layouts', site, bulletin), join(dataDir, 'layouts', site, bulletin), { recursive: true })
    await cp(join(REPO_ROOT, 'data', 'layouts', site, 'index.json'), join(dataDir, 'layouts', site, 'index.json'))
    await cp(join(REPO_ROOT, 'data', 'reports', site, bulletin), join(dataDir, 'reports', site, bulletin), { recursive: true })
  }
  const site = JSON.parse(await readFile(join(REPO_ROOT, 'data', 'sites', `${NORMAL_SITE}.json`), 'utf8'))
  await writeFile(join(dataDir, 'sites', `${TEST_SITE}.json`), JSON.stringify({ ...site, id: TEST_SITE, replay: { from: '2026-10-31T16:00+09:00', to: '2026-10-31T17:00+09:00', speed: 1 } }))
  await writeFile(join(dataDir, 'sites', `${LIVE_SITE}.json`), JSON.stringify({ ...site, id: LIVE_SITE }))
  await cp(join(REPO_ROOT, 'data', 'layouts', DRILL_SITE, DRILL), join(dataDir, 'layouts', LIVE_SITE, DRILL), { recursive: true })
  await cp(join(REPO_ROOT, 'data', 'layouts', NORMAL_SITE, NORMAL), join(dataDir, 'layouts', LIVE_SITE, NORMAL), { recursive: true })
  await writeFile(join(dataDir, 'layouts', LIVE_SITE, 'index.json'), JSON.stringify({ municipality: '15205', name: '柏崎市', site: LIVE_SITE, entries: [
    { issued_at: '2016-09-01T07:13:00+09:00', bulletin_id: DRILL, wmo_code: 'VTSE41', raw_title: 't', municipality_level: null, screen: true },
    { issued_at: '2026-10-31T16:53:00+09:00', bulletin_id: NORMAL, wmo_code: 'VPWW56', raw_title: 't', municipality_level: 4, screen: true, status: 'test' },
  ] }))
  const layoutDir = join(dataDir, 'layouts', TEST_SITE, NORMAL)
  await cp(join(REPO_ROOT, 'data', 'layouts', NORMAL_SITE, NORMAL), layoutDir, { recursive: true })
  const files = await Promise.all((await readdir(layoutDir)).map(async (f) => ({ shape: f.slice(0, -5), body: await readFile(join(layoutDir, f), 'utf8') })))
  await mkdir(join(dataDir, 'reports', TEST_SITE, NORMAL), { recursive: true })
  await writeFile(join(dataDir, 'reports', TEST_SITE, NORMAL, 'report.json'), JSON.stringify({ outcome: 'pass', verifier: 'static+browser(test)', layout_digest: layoutDigest(files), browser_skipped: [] }))
  await writeFile(join(dataDir, 'layouts', TEST_SITE, 'index.json'), JSON.stringify({ municipality: '15205', name: '柏崎市', site: TEST_SITE, entries: [{ issued_at: '2026-10-31T16:53:00+09:00', bulletin_id: NORMAL, wmo_code: 'VPWW56', raw_title: 't', municipality_level: 4, screen: true, status: 'test' }] }))
  const at = '2026-11-11T00:00:00Z'
  await writeFile(join(dataDir, 'approvals.json'), JSON.stringify({ version: '0.1', layouts: {}, sites: { [TEST_SITE]: { auto_publish: true, updated_at: at } }, classes: { [`${TEST_SITE}/landslide/evac-now/4`]: { approved: true, updated_at: at, digest: classDigest(files), approved_from: 'B0' } } }))
  return dataDir
}

describe('drill bulletins and class approvals', { skip }, () => {
  let base = ''
  let child: ChildProcess | undefined
  let dataDir = ''

  before(async () => {
    dataDir = await makeData()
    ;({ base, child } = await startServer({ NUXT_DATA_DIR: dataDir, NUXT_ADMIN_TOKEN: '' }))
  })
  after(() => {
    child?.kill()
  })

  test('a layout written without a status, whose index row says test, is out of class approval', async () => {
    assert.equal((await (await fetch(`${base}/api/feed/${TEST_SITE}`)).json()).state, 'ambient', 'a class approval under the normal key does not open it')
    const body = await (await postJson(base, '/api/admin/approve', { site_id: TEST_SITE, bulletin_id: NORMAL, approved: true })).json()
    assert.equal(body.class, 'landslide/evac-now/4/test')
    assert.equal(body.class_approval, undefined)
  })

  test('approving a drill bulletin approves that bulletin only and writes no class approval', async () => {
    const response = await postJson(base, '/api/admin/approve', { site_id: DRILL_SITE, bulletin_id: DRILL, approved: true })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.class, 'tsunami/evac-now/4/drill')
    assert.equal(body.class_approval, undefined)
    const approvals = JSON.parse(await readFile(join(dataDir, 'approvals.json'), 'utf8'))
    assert.equal(approvals.layouts[`${DRILL_SITE}/${DRILL}`].approved, true)
    assert.deepEqual(Object.keys(approvals.classes).filter((key) => key.startsWith(`${DRILL_SITE}/`)), [])
  })

  test('approving a normal bulletin still writes its class approval', async () => {
    const body = await (await postJson(base, '/api/admin/approve', { site_id: NORMAL_SITE, bulletin_id: NORMAL, approved: true })).json()
    assert.equal(body.class, 'landslide/evac-now/4')
    assert.equal(body.class_approval.approved_from, NORMAL)
  })

  test('a drill bulletin approved on its own is shown by the replay of the bundled drill demo', async () => {
    assert.equal((await postJson(base, '/api/admin/site', { site_id: DRILL_SITE, auto_publish: true })).status, 200)
    const feed = await (await fetch(`${base}/api/feed/${DRILL_SITE}`)).json()
    assert.equal(feed.state, 'alert')
    assert.equal(feed.bulletin_id, DRILL)
    assert.equal((await postJson(base, '/api/admin/live', { site_id: DRILL_SITE, bulletin_id: DRILL })).status, 409, 'the demo replays; it is not driven live')
  })

  test('a drill or test bulletin is never posted to a live site, by its index row or its stored layout', async () => {
    const drill = await postJson(base, '/api/admin/live', { site_id: LIVE_SITE, bulletin_id: DRILL })
    assert.equal(drill.status, 409)
    assert.match((await drill.json()).message, /drill bulletin/)
    const testStatus = await postJson(base, '/api/admin/live', { site_id: LIVE_SITE, bulletin_id: NORMAL })
    assert.equal(testStatus.status, 409)
    assert.match((await testStatus.json()).message, /test bulletin/)
    assert.equal((await postJson(base, '/api/admin/live', { site_id: LIVE_SITE, bulletin_id: null })).status, 200)
    assert.equal((await postJson(base, '/api/admin/live', { site_id: NORMAL_SITE, bulletin_id: NORMAL })).status, 200, 'a normal bulletin still goes live')
  })

  test('a drill screen approved on its own and left in the live state of a live site, current or fallback, is not delivered', async () => {
    assert.equal((await postJson(base, '/api/admin/approve', { site_id: LIVE_SITE, bulletin_id: DRILL, approved: true })).status, 200)
    assert.equal((await postJson(base, '/api/admin/site', { site_id: LIVE_SITE, auto_publish: true })).status, 200)
    const live = (state: object) => writeFile(join(dataDir, 'live', `${LIVE_SITE}.json`), JSON.stringify({ updated_at: '2026-11-11T00:00:00Z', ...state }))
    await mkdir(join(dataDir, 'live'), { recursive: true })
    await live({ bulletin_id: DRILL, fallback_bulletin_id: null })
    assert.equal((await (await fetch(`${base}/api/feed/${LIVE_SITE}`)).json()).state, 'ambient', 'a drill as the current bulletin')
    assert.equal((await fetch(`${base}/api/live-layout?site=${LIVE_SITE}&bulletin=${DRILL}&shape=16x9`)).status, 403)
    await live({ bulletin_id: 'VPWW55-202611111000-000000000000', fallback_bulletin_id: DRILL })
    assert.equal((await (await fetch(`${base}/api/feed/${LIVE_SITE}`)).json()).state, 'ambient', 'a drill as the fallback of an unapproved bulletin')
    assert.equal((await fetch(`${base}/api/live-layout?site=${DRILL_SITE}&bulletin=${DRILL}&shape=16x9`)).status, 200, 'the replay site still serves its drill')
  })
})

const EVIDENCE_SITE = '17204-evidence'
const ADVISORY_CLEAR = 'VPWW55-202610201141-6bb4c931f4d3'
const WARNING_CLEAR = 'VPWW55-202611111000-000000000001'
const WRITER_CLEAR = 'VPWW55-202611111000-000000000002'

async function makeEvidenceData(): Promise<{ dataDir: string; tables: HeadlineTables }> {
  const dataDir = join(await mkdtemp(join(tmpdir(), 'evac-headline-evidence-')), 'data')
  await mkdir(join(dataDir, 'sites'), { recursive: true })
  await cp(join(REPO_ROOT, 'data', 'jma'), join(dataDir, 'jma'), { recursive: true })
  const easyFile = join(dataDir, 'jma', 'warning-names-ja-easy.json')
  await writeFile(easyFile, JSON.stringify({ ...JSON.parse(await readFile(easyFile, 'utf8')), reviewed: true }))
  const tables: HeadlineTables = { names: JSON.parse(await readFile(join(dataDir, 'jma', 'warning-names.json'), 'utf8')), easy: JSON.parse(await readFile(easyFile, 'utf8')) }
  const { replay: _replay, ...site } = JSON.parse(await readFile(join(REPO_ROOT, 'data', 'sites', '17204-demo.json'), 'utf8'))
  await writeFile(join(dataDir, 'sites', `${EVIDENCE_SITE}.json`), JSON.stringify({ ...site, id: EVIDENCE_SITE }))
  const source = join(REPO_ROOT, 'data', 'layouts', '17204-demo', ADVISORY_CLEAR)
  const entries = []
  for (const [bulletin, name, fromTable] of [[ADVISORY_CLEAR, 'レベル２大雨注意報', true], [WARNING_CLEAR, 'レベル３大雨警報', true], [WRITER_CLEAR, 'レベル３大雨警報', false]] as const) {
    const found = headlineFromTables({ ja: `${name}解除`, name, cleared: true, drill: false }, tables)
    if (!('text' in found)) throw new Error(found.missing)
    const dir = join(dataDir, 'layouts', EVIDENCE_SITE, bulletin)
    await mkdir(dir, { recursive: true })
    const files = []
    for (const file of (await readdir(source)).filter((f) => f.endsWith('.json'))) {
      const layout = JSON.parse(await readFile(join(source, file), 'utf8'))
      layout.alert.bulletin_id = bulletin
      layout.sources = layout.sources.map((x: { type: string }) => (x.type === 'jma' ? { ...x, bulletin_id: bulletin } : x))
      const headline = layout.cells.find((c: { role: string }) => c.role === 'headline')
      headline.text = fromTable ? found.text : { ...headline.text, ja: `${name}解除` }
      const body = `${JSON.stringify(layout, null, 2)}\n`
      await writeFile(join(dir, file), body)
      files.push({ shape: file.slice(0, -5), body })
    }
    const digest = layoutDigest(files)
    await mkdir(join(dataDir, 'reports', EVIDENCE_SITE, bulletin), { recursive: true })
    await writeFile(join(dataDir, 'reports', EVIDENCE_SITE, bulletin, 'report.json'), JSON.stringify({
      outcome: 'pass', verifier: 'static+browser(test)', layout_digest: digest, browser_skipped: [],
      headline_table: { ok: true, table_version: headlineTableVersion(tables), layout_digest: digest, shapes: files.map((f) => f.shape) },
    }))
    entries.push({ issued_at: '2026-11-11T10:00:00+09:00', bulletin_id: bulletin, wmo_code: 'VPWW55', raw_title: 't', municipality_level: null, screen: true })
  }
  await writeFile(join(dataDir, 'layouts', EVIDENCE_SITE, 'index.json'), JSON.stringify({ municipality: '17204', name: '輪島市', site: EVIDENCE_SITE, entries }))
  return { dataDir, tables }
}

describe('a class approval and the headline table on the server', { skip }, () => {
  let base = ''
  let child: ChildProcess | undefined
  let dataDir = ''

  before(async () => {
    ;({ dataDir } = await makeEvidenceData())
    ;({ base, child } = await startServer({ NUXT_DATA_DIR: dataDir, NUXT_ADMIN_TOKEN: '' }))
  })
  after(() => {
    child?.kill()
  })

  test('the class approved from an advisory\'s all-clear opens a warning\'s all-clear whose headline is the table\'s, and not one whose headline is not', async () => {
    const approved = await (await postJson(base, '/api/admin/approve', { site_id: EVIDENCE_SITE, bulletin_id: ADVISORY_CLEAR, approved: true })).json()
    assert.equal(approved.class, 'heavy_rain/all-clear/1')
    assert.equal((await postJson(base, '/api/admin/site', { site_id: EVIDENCE_SITE, auto_publish: true })).status, 200)
    assert.equal((await postJson(base, '/api/admin/live', { site_id: EVIDENCE_SITE, bulletin_id: WARNING_CLEAR })).status, 200)
    const feed = await (await fetch(`${base}/api/feed/${EVIDENCE_SITE}`)).json()
    assert.deepEqual([feed.state, feed.bulletin_id], ['alert', WARNING_CLEAR])
    assert.equal((await postJson(base, '/api/admin/live', { site_id: EVIDENCE_SITE, bulletin_id: null })).status, 200)
    assert.equal((await postJson(base, '/api/admin/live', { site_id: EVIDENCE_SITE, bulletin_id: WRITER_CLEAR })).status, 200)
    assert.equal((await (await fetch(`${base}/api/feed/${EVIDENCE_SITE}`)).json()).state, 'ambient', 'its report claims the check, the stored headline says otherwise')
  })

  test('while the ja_easy table is unreviewed, the class approval opens nothing; the bulletin approval still does', async () => {
    const easyFile = join(dataDir, 'jma', 'warning-names-ja-easy.json')
    await writeFile(easyFile, JSON.stringify({ ...JSON.parse(await readFile(easyFile, 'utf8')), reviewed: false }))
    assert.equal((await postJson(base, '/api/admin/live', { site_id: EVIDENCE_SITE, bulletin_id: WARNING_CLEAR })).status, 200)
    assert.equal((await (await fetch(`${base}/api/feed/${EVIDENCE_SITE}`)).json()).state, 'ambient')
    assert.equal((await postJson(base, '/api/admin/live', { site_id: EVIDENCE_SITE, bulletin_id: ADVISORY_CLEAR })).status, 200)
    assert.equal((await (await fetch(`${base}/api/feed/${EVIDENCE_SITE}`)).json()).state, 'alert')
  })
})
