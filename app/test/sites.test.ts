import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { type IncomingHttpHeaders, createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { layoutDigest } from '../layout/gate.ts'
import { APP_DIR, SERVER_ENTRY, postJson, startServer } from './helpers.ts'

const require = createRequire(import.meta.url)
const puppeteer = require('puppeteer-core') as typeof import('puppeteer-core')

const SHARED_MUNICIPALITY = '00009'
const SOLO_MUNICIPALITY = '00008'
const SITE_A = 'site-a-station'
const SITE_B = 'site-b-harbour'
const SOLO = 'solo-site'
const REPLAYED = 'replayed-site'
const BULLETIN = 'TEST-SITE-1'
const SECRET = 'a-shared-secret-of-enough-length'
const WAIT_MS = 15000
const CHROME_PATH = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const skip = !existsSync(SERVER_ENTRY) && 'run `pnpm -F app build` first'

async function layoutFor(marker: string): Promise<string> {
  const fixture = JSON.parse(await readFile(join(APP_DIR, 'fixtures', 'wajima-tsunami.json'), 'utf8'))
  return JSON.stringify({ ...fixture, shape: '16x9', alert: { ...fixture.alert, bulletin_id: BULLETIN }, test_marker: marker })
}

async function addSite(dataDir: string, site: Record<string, unknown> & { id: string; municipality_id: string }, marker: string): Promise<string> {
  const layoutDir = join(dataDir, 'layouts', site.id, BULLETIN)
  await mkdir(layoutDir, { recursive: true })
  const body = await layoutFor(marker)
  await writeFile(join(layoutDir, '16x9.json'), body)
  await writeFile(
    join(dataDir, 'layouts', site.id, 'index.json'),
    JSON.stringify({
      municipality: site.municipality_id,
      name: `${marker} 市`,
      site: site.id,
      entries: [{ issued_at: '2026-10-21T15:55:00+09:00', bulletin_id: BULLETIN, wmo_code: 'VXKO50', raw_title: 'test', municipality_level: 4, screen: true }],
    }),
  )
  await writeFile(join(dataDir, 'sites', `${site.id}.json`), JSON.stringify(site))
  return body
}

async function makeData(): Promise<{ dataDir: string; soloBody: string }> {
  const dataDir = join(await mkdtemp(join(tmpdir(), 'evac-sites-')), 'data')
  await mkdir(join(dataDir, 'sites'), { recursive: true })
  await addSite(dataDir, { id: SITE_A, municipality_id: SHARED_MUNICIPALITY, lat: 1, lng: 1 }, 'a')
  await addSite(dataDir, { id: SITE_B, municipality_id: SHARED_MUNICIPALITY, lat: 2, lng: 2 }, 'b')
  const soloBody = await addSite(dataDir, { id: SOLO, municipality_id: SOLO_MUNICIPALITY }, 'solo')
  await addSite(dataDir, { id: REPLAYED, municipality_id: '00007', replay: { speed: 1200 } }, 'replayed')
  return { dataDir, soloBody }
}

const getJson = async (base: string, path: string) => {
  const response = await fetch(`${base}${path}`)
  assert.equal(response.status, 200, path)
  return response.json()
}

async function setLive(base: string, site: string, bulletin: string | null) {
  const response = await postJson(base, '/api/admin/live', { site_id: site, bulletin_id: bulletin })
  assert.equal(response.status, 200, await response.clone().text())
  return response.json()
}

describe('sites in one municipality', { skip }, () => {
  let base = ''
  let child: ChildProcess | undefined
  let dataDir = ''
  let soloBody = ''

  before(async () => {
    ;({ dataDir, soloBody } = await makeData())
    ;({ base, child } = await startServer({ EVAC_DATA_DIR: dataDir, NUXT_DATA_DIR: '', NUXT_ADMIN_TOKEN: '' }))
    for (const site of [SITE_A, SITE_B, SOLO]) assert.equal((await postJson(base, '/api/admin/site', { site_id: site, auto_publish: true })).status, 200)
  })
  after(() => child?.kill())

  test('each site feeds its own layouts, and an approval at one site does not open the other', async () => {
    assert.equal((await postJson(base, '/api/admin/approve', { site_id: SITE_A, bulletin_id: BULLETIN, approved: true })).status, 200)
    await setLive(base, SITE_A, BULLETIN)
    await setLive(base, SITE_B, BULLETIN)
    const a = await getJson(base, `/api/feed/${SITE_A}`)
    assert.equal(a.state, 'alert')
    assert.equal(a.layouts['16x9'].test_marker, 'a')
    assert.equal((await getJson(base, `/api/feed/${SITE_B}`)).state, 'ambient')
    assert.equal((await fetch(`${base}/api/live-layout?site=${SITE_B}&bulletin=${BULLETIN}&shape=16x9`)).status, 403)

    assert.equal((await postJson(base, '/api/admin/approve', { site_id: SITE_B, bulletin_id: BULLETIN, approved: true })).status, 200)
    const b = await getJson(base, `/api/feed/${SITE_B}`)
    assert.equal(b.state, 'alert')
    assert.equal(b.layouts['16x9'].test_marker, 'b')
    assert.equal((await getJson(base, `/api/live-layout?site=${SITE_A}&bulletin=${BULLETIN}&shape=16x9`)).test_marker, 'a')
    assert.equal((await getJson(base, `/api/admin/preview-layout?site=${SITE_B}&bulletin=${BULLETIN}&shape=16x9`)).test_marker, 'b')
  })

  test('municipality alone is refused with 400 when it has two sites, and stands for the site when it has one', async () => {
    const shared = `municipality=${SHARED_MUNICIPALITY}&bulletin=${BULLETIN}&shape=16x9`
    for (const path of [`/api/admin/preview-layout?${shared}`, `/api/live-layout?${shared}`, `/api/replay?municipality=${SHARED_MUNICIPALITY}`]) {
      const response = await fetch(`${base}${path}`)
      assert.equal(response.status, 400, path)
      assert.match(await response.text(), /specify site/)
    }
    assert.equal((await postJson(base, '/api/admin/approve', { municipality: SHARED_MUNICIPALITY, bulletin_id: BULLETIN, approved: true })).status, 400)
    assert.equal((await fetch(`${base}/api/admin/preview-layout?municipality=00006&bulletin=${BULLETIN}&shape=16x9`)).status, 400)
    assert.equal((await fetch(`${base}/api/admin/preview-layout?site=${SITE_A}&municipality=${SOLO_MUNICIPALITY}&bulletin=${BULLETIN}&shape=16x9`)).status, 400)

    assert.equal((await getJson(base, `/api/admin/preview-layout?municipality=${SOLO_MUNICIPALITY}&bulletin=${BULLETIN}&shape=16x9`)).test_marker, 'solo')
    const approved = await (await postJson(base, '/api/admin/approve', { municipality: SOLO_MUNICIPALITY, bulletin_id: BULLETIN, approved: false })).json()
    assert.equal(approved.site_id, SOLO)
  })

  test('a legacy <municipality>/<bulletin> approval stands for the only site of that municipality', async () => {
    const file = join(dataDir, 'approvals.json')
    const approvals = JSON.parse(await readFile(file, 'utf8'))
    delete approvals.layouts[`${SOLO}/${BULLETIN}`]
    delete approvals.layouts[`${SITE_B}/${BULLETIN}`]
    const digest = layoutDigest([{ shape: '16x9', body: soloBody }])
    approvals.layouts[`${SOLO_MUNICIPALITY}/${BULLETIN}`] = { approved: true, updated_at: '2026-11-06T00:00:00Z', digest }
    approvals.layouts[`${SHARED_MUNICIPALITY}/${BULLETIN}`] = { approved: true, updated_at: '2026-11-06T00:00:00Z', digest }
    await writeFile(file, JSON.stringify(approvals))
    await setLive(base, SOLO, BULLETIN)
    assert.equal((await getJson(base, `/api/feed/${SOLO}`)).state, 'alert')
    assert.equal((await getJson(base, `/api/feed/${SITE_B}`)).state, 'ambient', 'a legacy key of a two-site municipality opens neither site')
    assert.equal((await postJson(base, '/api/admin/site', { site_id: SOLO, auto_publish: true })).status, 200)
    const rewritten = JSON.parse(await readFile(file, 'utf8'))
    assert.deepEqual(Object.keys(rewritten.layouts).filter((key) => key.startsWith('0000')), [])
    assert.equal(rewritten.layouts[`${SOLO}/${BULLETIN}`].digest, digest)
  })

  test('the live state follows POST /api/admin/live: alert, then clear', async () => {
    assert.equal((await postJson(base, '/api/admin/approve', { site_id: SITE_A, bulletin_id: BULLETIN, approved: true })).status, 200)
    const posted = await setLive(base, SITE_A, BULLETIN)
    assert.equal(posted.bulletin_id, BULLETIN)
    assert.deepEqual(JSON.parse(await readFile(join(dataDir, 'live', `${SITE_A}.json`), 'utf8')), { bulletin_id: BULLETIN, updated_at: posted.updated_at })
    assert.equal((await getJson(base, `/api/feed/${SITE_A}`)).bulletin_id, BULLETIN)
    const replay = await getJson(base, `/api/replay?site=${SITE_A}`)
    assert.deepEqual(replay.rows.map((row: { bulletin_id: string }) => row.bulletin_id), [BULLETIN])
    assert.equal(replay.speed, 1)

    await setLive(base, SITE_A, null)
    const cleared = await getJson(base, `/api/feed/${SITE_A}`)
    assert.equal(cleared.state, 'ambient')
    assert.deepEqual((await getJson(base, `/api/replay?site=${SITE_A}`)).rows, [])

    assert.equal((await postJson(base, '/api/admin/live', { site_id: 'no-such-site', bulletin_id: null })).status, 404)
    assert.equal((await postJson(base, '/api/admin/live', { site_id: SITE_A, bulletin_id: '../x' })).status, 400)
    assert.equal((await postJson(base, '/api/admin/live', { site_id: SITE_A })).status, 400)
    assert.equal((await postJson(base, '/api/admin/live', { site_id: REPLAYED, bulletin_id: BULLETIN })).status, 409)
  })

  test('a site with replay takes its speed from the site file when asked by site alone', async () => {
    assert.equal((await getJson(base, `/api/replay?site=${REPLAYED}`)).speed, 1200)
    assert.equal((await getJson(base, `/api/replay?municipality=00007`)).speed, 600)
  })

  test('demo site layouts are not served without EVAC_DEMO=1', async () => {
    assert.equal((await fetch(`${base}/api/demo-site-layout?path=${encodeURIComponent('demo/sites/x/16x9.json')}`)).status, 404)
  })
})

describe('/screen?site=<id>&mode=live', { skip: skip || (!existsSync(CHROME_PATH) && `no Chrome at ${CHROME_PATH}`) }, () => {
  let base = ''
  let child: ChildProcess | undefined
  let browser: import('puppeteer-core').Browser | undefined

  before(async () => {
    const { dataDir } = await makeData()
    ;({ base, child } = await startServer({ EVAC_DATA_DIR: dataDir, NUXT_ADMIN_TOKEN: '' }))
    assert.equal((await postJson(base, '/api/admin/site', { site_id: SITE_A, auto_publish: true })).status, 200)
    assert.equal((await postJson(base, '/api/admin/approve', { site_id: SITE_A, bulletin_id: BULLETIN, approved: true })).status, 200)
    browser = await puppeteer.launch({ executablePath: CHROME_PATH })
  })
  after(async () => {
    await browser?.close()
    child?.kill()
  })

  test('shows the posted bulletin and returns to ambient on clear', async () => {
    const page = await browser!.newPage()
    await page.setViewport({ width: 1920, height: 1080 })
    await page.goto(`${base}/screen?site=${SITE_A}&mode=live&shape=16x9`)
    await page.waitForSelector('[data-mode="live"][data-ready="1"]', { timeout: WAIT_MS })
    assert.equal(await page.$eval('[data-mode="live"]', (el) => el.getAttribute('data-showing')), null)
    await setLive(base, SITE_A, BULLETIN)
    await page.waitForSelector(`[data-mode="live"][data-showing="${BULLETIN}"]`, { timeout: WAIT_MS })
    await setLive(base, SITE_A, null)
    await page.waitForFunction(() => !document.querySelector('[data-mode="live"]')?.hasAttribute('data-showing'), { timeout: WAIT_MS })
  })
})

interface Delivery {
  headers: IncomingHttpHeaders
  body: string
}

describe('webhook across a restart', { skip }, () => {
  const deliveries: Delivery[] = []
  const receiver = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      deliveries.push({ headers: req.headers, body })
      res.writeHead(204).end()
    })
  })
  let child: ChildProcess | undefined

  async function nextDelivery(count: number): Promise<Delivery> {
    const deadline = Date.now() + WAIT_MS
    while (deliveries.length < count && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100))
    assert.ok(deliveries.length >= count, `expected webhook delivery #${count}`)
    return deliveries[count - 1]!
  }

  before(() => new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve)))
  after(() => {
    child?.kill()
    receiver.close()
  })

  test('a clear that happened while the server was down is sent after it comes back, and subscriptions can be listed and removed', async () => {
    const { dataDir } = await makeData()
    const env = { EVAC_DATA_DIR: dataDir, NUXT_ADMIN_TOKEN: '', NUXT_WEBHOOK_ALLOW_PRIVATE: '1' }
    let base = ''
    ;({ base, child } = await startServer(env))
    const { port } = receiver.address() as { port: number }
    assert.equal((await postJson(base, '/api/admin/site', { site_id: SITE_A, auto_publish: true })).status, 200)
    assert.equal((await postJson(base, '/api/admin/approve', { site_id: SITE_A, bulletin_id: BULLETIN, approved: true })).status, 200)
    const registered = await (await postJson(base, '/api/admin/subscriptions', { site_id: SITE_A, url: `http://127.0.0.1:${port}/hook`, secret: SECRET })).json()

    await setLive(base, SITE_A, BULLETIN)
    assert.equal((await nextDelivery(1)).headers['x-evaclayer-event'], 'alert')
    const deadline = Date.now() + WAIT_MS
    let stored: { last_bulletin_id?: string | null } = {}
    while (stored.last_bulletin_id !== BULLETIN && Date.now() < deadline) {
      stored = JSON.parse(await readFile(join(dataDir, 'subscriptions.json'), 'utf8')).subscriptions[0]
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.equal(stored.last_bulletin_id, BULLETIN)

    child!.kill()
    await new Promise((resolve) => child!.once('exit', resolve))
    await writeFile(join(dataDir, 'live', `${SITE_A}.json`), JSON.stringify({ bulletin_id: null, updated_at: new Date().toISOString() }))
    ;({ base, child } = await startServer(env))
    const clear = await nextDelivery(2)
    assert.equal(clear.headers['x-evaclayer-event'], 'clear')
    assert.equal(JSON.parse(clear.body).state, 'ambient')

    const listed = await (await fetch(`${base}/api/admin/subscriptions?site=${SITE_A}`)).json()
    assert.equal(listed.subscriptions.length, 1)
    assert.equal(listed.subscriptions[0].id, registered.id)
    assert.equal(listed.subscriptions[0].secret, undefined)
    assert.equal((await (await fetch(`${base}/api/admin/subscriptions?site=${SITE_B}`)).json()).subscriptions.length, 0)
    assert.equal((await fetch(`${base}/api/admin/subscriptions/${registered.id}`, { method: 'DELETE' })).status, 204)
    assert.equal((await fetch(`${base}/api/admin/subscriptions/${registered.id}`, { method: 'DELETE' })).status, 404)
    assert.equal((await (await fetch(`${base}/api/admin/subscriptions`)).json()).subscriptions.length, 0)
  })
})
