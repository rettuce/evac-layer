import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { layoutDigest } from '../layout/gate.ts'
import { REPO_ROOT, SERVER_ENTRY, postJson, startServer } from './helpers.ts'

const SITE = '15205-demo'
const REPLAY_SITE = '15205-replay'
const REAL = 'VPWW56-202610311653-b3fa1b3a2ced'
const SYN = 'SYN-VPWW56-202411020800-314b561ca69f'

const skip = !existsSync(SERVER_ENTRY) && 'run `pnpm -F app build` first'

async function writeScreens(dataDir: string, site: string, bulletin: string, from: string): Promise<void> {
  const source = join(REPO_ROOT, 'data', 'layouts', SITE, from)
  const dir = join(dataDir, 'layouts', site, bulletin)
  await mkdir(dir, { recursive: true })
  const files: { shape: string; body: string }[] = []
  for (const name of (await readdir(source)).filter((f) => f.endsWith('.json'))) {
    const layout = JSON.parse(await readFile(join(source, name), 'utf8'))
    const body = `${JSON.stringify({ ...layout, alert: { ...layout.alert, bulletin_id: bulletin }, sources: layout.sources.map((s: { type: string }) => (s.type === 'jma' ? { ...s, bulletin_id: bulletin } : s)) }, null, 2)}\n`
    await writeFile(join(dir, name), body)
    files.push({ shape: name.slice(0, -5), body })
  }
  await mkdir(join(dataDir, 'reports', site, bulletin), { recursive: true })
  await writeFile(join(dataDir, 'reports', site, bulletin, 'report.json'), JSON.stringify({ outcome: 'pass', verifier: 'static+browser(test)', layout_digest: layoutDigest(files), browser_skipped: [] }))
}

async function makeData(): Promise<string> {
  const dataDir = join(await mkdtemp(join(tmpdir(), 'evac-synthetic-')), 'data')
  await mkdir(join(dataDir, 'sites'), { recursive: true })
  const site = JSON.parse(await readFile(join(REPO_ROOT, 'data', 'sites', `${SITE}.json`), 'utf8'))
  await writeFile(join(dataDir, 'sites', `${SITE}.json`), JSON.stringify(site))
  await writeFile(join(dataDir, 'sites', `${REPLAY_SITE}.json`), JSON.stringify({ ...site, id: REPLAY_SITE, replay: { from: '2024-01-01T00:00+09:00', to: '2027-01-01T00:00+09:00', speed: 1 } }))
  const rows = [
    { issued_at: '2024-11-02T08:00:00+09:00', bulletin_id: SYN, wmo_code: 'VPWW56', raw_title: '新潟県土砂災害警報・注意報', municipality_level: 4, file: `synthetic/15205/${SYN}.xml`, synthetic: true, screen: true, template: 'evac-now', display_level: 4 },
    { issued_at: '2026-10-31T16:53:00+09:00', bulletin_id: REAL, wmo_code: 'VPWW56', raw_title: '新潟県土砂災害警報・注意報', municipality_level: 4, screen: true, template: 'evac-now', display_level: 4 },
  ]
  for (const site of [SITE, REPLAY_SITE]) {
    await writeScreens(dataDir, site, SYN, REAL)
    await writeScreens(dataDir, site, REAL, REAL)
    await writeFile(join(dataDir, 'layouts', site, 'index.json'), JSON.stringify({ municipality: '15205', name: '柏崎市', site, entries: rows }))
  }
  return dataDir
}

describe('synthetic bulletins', { skip }, () => {
  let base = ''
  let child: ChildProcess | undefined
  let dataDir = ''
  const feed = async (site: string) => (await fetch(`${base}/api/feed/${site}`)).json()

  before(async () => {
    dataDir = await makeData()
    ;({ base, child } = await startServer({ NUXT_DATA_DIR: dataDir, NUXT_ADMIN_TOKEN: '' }))
    for (const site of [SITE, REPLAY_SITE]) assert.equal((await postJson(base, '/api/admin/site', { site_id: site, auto_publish: true })).status, 200)
  })
  after(() => {
    child?.kill()
  })

  test('approving a synthetic bulletin writes the approval of its class', async () => {
    for (const site of [SITE, REPLAY_SITE]) {
      const body = await (await postJson(base, '/api/admin/approve', { site_id: site, bulletin_id: SYN, approved: true })).json()
      assert.equal(body.class, 'landslide/evac-now/4')
      assert.equal(body.class_approval.approved_from, SYN)
    }
  })

  test('a synthetic bulletin cannot be posted live, and the feed never shows it', async () => {
    const refused = await postJson(base, '/api/admin/live', { site_id: SITE, bulletin_id: SYN })
    assert.equal(refused.status, 400)
    assert.equal(existsSync(join(dataDir, 'live', `${SITE}.json`)), false)
    assert.equal((await feed(SITE)).state, 'ambient')
    await mkdir(join(dataDir, 'live'), { recursive: true })
    await writeFile(join(dataDir, 'live', `${SITE}.json`), JSON.stringify({ bulletin_id: SYN, fallback_bulletin_id: null, updated_at: '2026-11-11T00:00:00Z' }))
    assert.equal((await feed(SITE)).state, 'ambient', 'not even when the live file names it')
    const layout = await fetch(`${base}/api/live-layout?site=${SITE}&bulletin=${SYN}&shape=16x9`)
    assert.equal(layout.status, 403)
  })

  test('the real bulletin of the class goes out on the approval given to the synthetic one', async () => {
    assert.equal((await postJson(base, '/api/admin/live', { site_id: SITE, bulletin_id: REAL })).status, 200)
    const now = await feed(SITE)
    assert.equal(now.state, 'alert')
    assert.equal(now.bulletin_id, REAL)
  })

  test('a replay leaves synthetic rows out', async () => {
    const replay = await (await fetch(`${base}/api/replay?site=${REPLAY_SITE}&t=999999999999`)).json()
    assert.deepEqual(replay.rows.map((r: { bulletin_id: string }) => r.bulletin_id), [REAL])
    const now = await feed(REPLAY_SITE)
    assert.equal(now.bulletin_id, REAL)
  })
})
