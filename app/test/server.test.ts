import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { APP_DIR, SERVER_ENTRY, postJson, startServer } from './helpers.ts'

const MUNICIPALITY = '00001'
const BULLETIN = 'TEST-B1'
const SITE = 'test-site'

async function makeDataDir(): Promise<string> {
  const data = join(await mkdtemp(join(tmpdir(), 'evac-data-')), 'data')
  const layoutDir = join(data, 'layouts', MUNICIPALITY, BULLETIN)
  await mkdir(layoutDir, { recursive: true })
  await mkdir(join(data, 'sites'))
  await cp(join(APP_DIR, 'fixtures', 'wajima-tsunami.json'), join(layoutDir, '16x9.json'))
  await writeFile(
    join(data, 'layouts', MUNICIPALITY, 'index.json'),
    JSON.stringify({
      municipality: MUNICIPALITY,
      name: 'テスト市',
      site: SITE,
      entries: [{ issued_at: '2026-10-21T15:55:00+09:00', bulletin_id: BULLETIN, raw_title: 'test', municipality_level: 4, screen: true, template: 'evac-now', display_level: 4, layouts: [`data/layouts/${MUNICIPALITY}/${BULLETIN}/16x9.json`] }],
    }),
  )
  await writeFile(join(data, 'sites', `${SITE}.json`), JSON.stringify({ id: SITE, municipality_id: MUNICIPALITY, lat: 0, lng: 0 }))
  return data
}

function getWithHost(base: string, path: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, base)
    request({ hostname: url.hostname, port: url.port, path: url.pathname, headers: { host } }, (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    }).on('error', reject).end()
  })
}

const layoutPath = `/api/live-layout?municipality=${MUNICIPALITY}&bulletin=${BULLETIN}&shape=16x9`

describe('production build', { skip: !existsSync(SERVER_ENTRY) && 'run `pnpm -F app build` first' }, () => {
  let base = ''
  let dataDir = ''
  let child: ChildProcess | undefined

  before(async () => {
    dataDir = await makeDataDir()
    ;({ base, child } = await startServer({ NUXT_DATA_DIR: dataDir, NUXT_ADMIN_TOKEN: '' }))
  })
  after(() => child?.kill())

  test('live layout is gated by auto publish, then by approval', async () => {
    const off = await fetch(`${base}${layoutPath}`)
    assert.equal(off.status, 403)
    assert.equal((await off.json()).data.reason, 'auto-publish-off')

    assert.equal((await postJson(base, '/api/admin/site', { site_id: SITE, auto_publish: true })).status, 200)
    const unapproved = await fetch(`${base}${layoutPath}`)
    assert.equal(unapproved.status, 403)
    assert.equal((await unapproved.json()).data.reason, 'unapproved')

    assert.equal((await postJson(base, '/api/admin/approve', { municipality: MUNICIPALITY, bulletin_id: BULLETIN, approved: true })).status, 200)
    const ok = await fetch(`${base}${layoutPath}`)
    assert.equal(ok.status, 200)
    assert.equal((await ok.json()).kind, 'evac-screen')

    const approvals = JSON.parse(await readFile(join(dataDir, 'approvals.json'), 'utf8'))
    assert.equal(approvals.sites[SITE].auto_publish, true)
    assert.equal(approvals.layouts[`${MUNICIPALITY}/${BULLETIN}`].approved, true)
    assert.match(approvals.layouts[`${MUNICIPALITY}/${BULLETIN}`].digest, /^sha256:[0-9a-f]{64}$/)
  })

  test('a regenerated layout is stale until it is approved again', async () => {
    const file = join(dataDir, 'layouts', MUNICIPALITY, BULLETIN, '16x9.json')
    const screen = JSON.parse(await readFile(file, 'utf8'))
    screen.cells[0].text.ja = `${screen.cells[0].text.ja}（再生成）`
    await writeFile(file, JSON.stringify(screen))
    const stale = await fetch(`${base}${layoutPath}`)
    assert.equal(stale.status, 403)
    assert.equal((await stale.json()).data.reason, 'stale')
    assert.equal((await fetch(`${base}/api/feed/${SITE}`)).status, 200)

    assert.equal((await postJson(base, '/api/admin/approve', { municipality: MUNICIPALITY, bulletin_id: BULLETIN, approved: true })).status, 200)
    assert.equal((await fetch(`${base}${layoutPath}`)).status, 200)
  })

  test('an approval written without a digest is stale until it is approved again', async () => {
    const file = join(dataDir, 'approvals.json')
    const approvals = JSON.parse(await readFile(file, 'utf8'))
    delete approvals.layouts[`${MUNICIPALITY}/${BULLETIN}`].digest
    await writeFile(file, JSON.stringify(approvals))
    const stale = await fetch(`${base}${layoutPath}`)
    assert.equal(stale.status, 403)
    assert.equal((await stale.json()).data.reason, 'stale')

    assert.equal((await postJson(base, '/api/admin/approve', { municipality: MUNICIPALITY, bulletin_id: BULLETIN, approved: true })).status, 200)
    assert.equal((await fetch(`${base}${layoutPath}`)).status, 200)
  })

  test('the dev layout bridge does not exist in production', async () => {
    const file = join(APP_DIR, 'fixtures', 'wajima-tsunami.json')
    assert.equal((await fetch(`${base}/api/layout?file=${encodeURIComponent(file)}`)).status, 404)
  })

  test('local admin refuses cross-origin, non-JSON and rebound-host requests', async () => {
    assert.equal((await fetch(`${base}/api/admin/catalog`)).status, 200)
    assert.equal((await postJson(base, '/api/admin/site', { site_id: SITE, auto_publish: false }, { origin: 'http://evil.example' })).status, 403)
    assert.equal((await postJson(base, '/api/admin/site', { site_id: SITE, auto_publish: false }, { 'sec-fetch-site': 'cross-site' })).status, 403)
    const formPost = await fetch(`${base}/api/admin/site`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ site_id: SITE, auto_publish: false }) })
    assert.equal(formPost.status, 403)
    assert.equal(await getWithHost(base, '/api/admin/catalog', 'evil.example'), 403)
    assert.equal((await postJson(base, '/api/admin/site', { site_id: 'unknown-site', auto_publish: true })).status, 404)
  })
})

describe('production build with an admin token', { skip: !existsSync(SERVER_ENTRY) && 'run `pnpm -F app build` first' }, () => {
  let base = ''
  let child: ChildProcess | undefined

  before(async () => {
    ;({ base, child } = await startServer({ NUXT_DATA_DIR: await makeDataDir(), NUXT_ADMIN_TOKEN: 'test-token-123' }))
  })
  after(() => child?.kill())

  test('admin API requires the Bearer token', async () => {
    assert.equal((await fetch(`${base}/api/admin/catalog`)).status, 401)
    assert.equal((await fetch(`${base}/api/admin/catalog`, { headers: { authorization: 'Bearer wrong' } })).status, 401)
    assert.equal((await fetch(`${base}/api/admin/catalog`, { headers: { authorization: 'Bearer test-token-123' } })).status, 200)
    assert.equal((await postJson(base, '/api/admin/site', { site_id: SITE, auto_publish: true })).status, 401)
  })
})

describe('production build serving demo/sites layouts', { skip: !existsSync(SERVER_ENTRY) && 'run `pnpm -F app build` first' }, () => {
  let base = ''
  let child: ChildProcess | undefined

  before(async () => {
    const root = await mkdtemp(join(tmpdir(), 'evac-repo-'))
    await mkdir(join(root, 'demo', 'sites', 'tsurumai-kaikan'), { recursive: true })
    await cp(join(APP_DIR, 'fixtures', 'wajima-tsunami.json'), join(root, 'demo', 'sites', 'tsurumai-kaikan', '16x9.json'))
    await writeFile(join(root, 'secret.json'), '{"leak":true}')
    ;({ base, child } = await startServer({ NUXT_REPO_ROOT: root, NUXT_DATA_DIR: await makeDataDir(), NUXT_ADMIN_TOKEN: '' }))
  })
  after(() => child?.kill())

  test('only relative demo/sites/**/*.json paths are served, without the approval gate', async () => {
    const at = (path: string) => fetch(`${base}/api/demo-site-layout?path=${encodeURIComponent(path)}`)
    const ok = await at('demo/sites/tsurumai-kaikan/16x9.json')
    assert.equal(ok.status, 200)
    assert.equal((await ok.json()).kind, 'evac-screen')
    for (const path of ['demo/sites/../secret.json', 'demo/sites/tsurumai-kaikan/../../../secret.json', '/secret.json', 'secret.json']) {
      assert.equal((await at(path)).status, 400, path)
    }
    const missing = await at('demo/sites/missing/16x9.json')
    assert.equal(missing.status, 404)
    assert.doesNotMatch(await missing.text(), /evac-repo-/)
  })
})
