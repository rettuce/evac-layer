import assert from 'node:assert/strict'
import { type ChildProcess, execFile } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { type IncomingHttpHeaders, createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { promisify } from 'node:util'
import { APP_DIR, REPO_ROOT, SERVER_ENTRY, postJson, startServer } from './helpers.ts'

const MUNICIPALITY = '00002'
const BULLETIN = 'TEST-FEED-1'
const SITE = 'feed-site'
const SHAPES = ['16x9', '9x16', '32x9', '1x1'] as const
const SECRET = 'a-shared-secret-of-enough-length'
const WEBHOOK_WAIT_MS = 8000

const skip = !existsSync(SERVER_ENTRY) && 'run `pnpm -F app build` first'

async function makeDelivery(): Promise<{ dataDir: string; distDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'evac-feed-'))
  const dataDir = join(root, 'data')
  const distDir = join(root, 'dist')
  const layoutDir = join(dataDir, 'layouts', MUNICIPALITY, BULLETIN)
  const assetDir = join(distDir, SITE, BULLETIN)
  await mkdir(layoutDir, { recursive: true })
  await mkdir(assetDir, { recursive: true })
  await mkdir(join(dataDir, 'sites'))
  const fixture = JSON.parse(await readFile(join(APP_DIR, 'fixtures', 'wajima-tsunami.json'), 'utf8'))
  for (const shape of SHAPES) {
    const layout = { ...fixture, shape, alert: { ...fixture.alert, bulletin_id: BULLETIN } }
    await writeFile(join(layoutDir, `${shape}.json`), JSON.stringify(layout))
  }
  await writeFile(join(assetDir, '16x9.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  await writeFile(join(assetDir, '16x9.html'), '<!doctype html><title>16x9</title>')
  await writeFile(
    join(dataDir, 'layouts', MUNICIPALITY, 'index.json'),
    JSON.stringify({
      municipality: MUNICIPALITY,
      name: 'フィード市',
      site: SITE,
      entries: [{ issued_at: '2026-10-21T15:55:00+09:00', bulletin_id: BULLETIN, wmo_code: 'VXKO50', raw_title: 'test', municipality_level: 4, screen: true }],
    }),
  )
  await writeFile(
    join(dataDir, 'sites', `${SITE}.json`),
    JSON.stringify({ id: SITE, municipality_id: MUNICIPALITY, replay: { municipality: MUNICIPALITY, speed: 1200 } }),
  )
  return { dataDir, distDir }
}

async function validateWithAgents(doc: unknown): Promise<string> {
  const file = join(await mkdtemp(join(tmpdir(), 'evac-feed-doc-')), 'feed.json')
  await writeFile(file, JSON.stringify(doc))
  const { stdout } = await promisify(execFile)('pnpm', ['-s', '-F', 'agents', 'validate', file], { cwd: REPO_ROOT })
  return stdout
}

async function approve(base: string, approved: boolean) {
  assert.equal((await postJson(base, '/api/admin/site', { site_id: SITE, auto_publish: true })).status, 200)
  assert.equal((await postJson(base, '/api/admin/approve', { municipality: MUNICIPALITY, bulletin_id: BULLETIN, approved })).status, 200)
}

describe('feed', { skip }, () => {
  let base = ''
  let child: ChildProcess | undefined

  before(async () => {
    const { dataDir, distDir } = await makeDelivery()
    ;({ base, child } = await startServer({ NUXT_DATA_DIR: dataDir, NUXT_DIST_DIR: distDir, NUXT_ADMIN_TOKEN: '', NUXT_WEBHOOK_ALLOW_PRIVATE: '' }))
  })
  after(() => child?.kill())

  test('is ambient before approval, alert with layouts and assets after, and passes the feed schema', async () => {
    const ambient = await fetch(`${base}/api/feed/${SITE}`)
    assert.equal(ambient.status, 200)
    const ambientFeed = await ambient.json()
    assert.equal(ambientFeed.state, 'ambient')
    assert.deepEqual(ambientFeed.layouts, {})
    assert.match(await validateWithAgents(ambientFeed), /^OK /)

    const etag = ambient.headers.get('etag')!
    assert.equal((await fetch(`${base}/api/feed/${SITE}`, { headers: { 'if-none-match': etag } })).status, 304)
    assert.equal((await fetch(`${base}/delivery/${SITE}/${BULLETIN}/16x9.png`)).status, 404)

    await approve(base, true)
    const alert = await fetch(`${base}/api/feed/${SITE}`, { headers: { 'if-none-match': etag } })
    assert.equal(alert.status, 200)
    assert.notEqual(alert.headers.get('etag'), etag)
    const alertFeed = await alert.json()
    assert.equal(alertFeed.state, 'alert')
    assert.equal(alertFeed.bulletin_id, BULLETIN)
    assert.equal(alertFeed.alert.template, 'evac-now')
    assert.deepEqual(Object.keys(alertFeed.layouts).sort(), [...SHAPES].sort())
    assert.deepEqual(alertFeed.assets, {
      '16x9': { png: `/delivery/${SITE}/${BULLETIN}/16x9.png`, html: `/delivery/${SITE}/${BULLETIN}/16x9.html` },
    })
    assert.match(await validateWithAgents(alertFeed), /^OK /)

    const pillar = await fetch(`${base}/api/live-layout?municipality=${MUNICIPALITY}&bulletin=${BULLETIN}&shape=pillar&site=${SITE}`)
    assert.equal(pillar.status, 200)
    assert.equal((await pillar.json()).shape, '9x16')
    assert.equal(alertFeed.layouts.pillar, undefined)

    const png = await fetch(`${base}${alertFeed.assets['16x9'].png}`)
    assert.equal(png.status, 200)
    assert.equal(png.headers.get('content-type'), 'image/png')
    assert.equal((await fetch(`${base}/delivery/${SITE}/${BULLETIN}/..%2F..%2Fsites%2F${SITE}.json`)).status, 404)

    await approve(base, false)
    assert.equal((await (await fetch(`${base}/api/feed/${SITE}`)).json()).state, 'ambient')
    assert.equal((await fetch(`${base}${alertFeed.assets['16x9'].png}`)).status, 404)
  })

  test('unknown sites are 404 and webhook targets on the LAN are refused by default', async () => {
    assert.equal((await fetch(`${base}/api/feed/no-such-site`)).status, 404)
    const lan = await postJson(base, '/api/admin/subscriptions', { site_id: SITE, url: 'http://127.0.0.1:9/hook', secret: SECRET })
    assert.equal(lan.status, 400)
    const ftp = await postJson(base, '/api/admin/subscriptions', { site_id: SITE, url: 'ftp://example.com/hook', secret: SECRET })
    assert.equal(ftp.status, 400)
    const shortSecret = await postJson(base, '/api/admin/subscriptions', { site_id: SITE, url: 'https://example.com/hook', secret: 'short' })
    assert.equal(shortSecret.status, 400)
  })
})

interface Delivery {
  headers: IncomingHttpHeaders
  body: string
}

describe('webhook', { skip }, () => {
  let base = ''
  let child: ChildProcess | undefined
  const deliveries: Delivery[] = []
  const receiver = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      deliveries.push({ headers: req.headers, body })
      res.writeHead(204).end()
    })
  })

  async function nextDelivery(count: number): Promise<Delivery> {
    const deadline = Date.now() + WEBHOOK_WAIT_MS
    while (deliveries.length < count && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100))
    assert.ok(deliveries.length >= count, `expected webhook delivery #${count}`)
    return deliveries[count - 1]!
  }

  before(async () => {
    await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve))
    const { dataDir, distDir } = await makeDelivery()
    ;({ base, child } = await startServer({ NUXT_DATA_DIR: dataDir, NUXT_DIST_DIR: distDir, NUXT_ADMIN_TOKEN: '', NUXT_WEBHOOK_ALLOW_PRIVATE: '1' }))
  })
  after(() => {
    child?.kill()
    receiver.close()
  })

  test('posts signed alert and clear events when the site state changes', async () => {
    const { port } = receiver.address() as { port: number }
    const registered = await postJson(base, '/api/admin/subscriptions', { site_id: SITE, url: `http://127.0.0.1:${port}/hook`, secret: SECRET })
    assert.equal(registered.status, 201)
    assert.equal((await registered.json()).secret, undefined)

    await approve(base, true)
    const alert = await nextDelivery(1)
    assert.equal(alert.headers['x-evaclayer-event'], 'alert')
    const signed = `${alert.headers['x-evaclayer-timestamp']}.${alert.headers['x-evaclayer-delivery']}.alert.${alert.body}`
    assert.equal(alert.headers['x-evaclayer-signature'], `sha256=${createHmac('sha256', SECRET).update(signed).digest('hex')}`)
    assert.ok(Math.abs(Number(alert.headers['x-evaclayer-timestamp']) - Date.now() / 1000) < 60)
    assert.equal(JSON.parse(alert.body).bulletin_id, BULLETIN)
    assert.equal(alert.body, await (await fetch(`${base}/api/feed/${SITE}`)).text())

    await approve(base, false)
    const clear = await nextDelivery(2)
    assert.equal(clear.headers['x-evaclayer-event'], 'clear')
    assert.equal(JSON.parse(clear.body).state, 'ambient')
    assert.notEqual(clear.headers['x-evaclayer-delivery'], alert.headers['x-evaclayer-delivery'])
  })
})
