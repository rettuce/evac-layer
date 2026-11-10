import assert from 'node:assert/strict'
import { type ChildProcess, execFile } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { type IncomingHttpHeaders, createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { promisify } from 'node:util'
import { EXPORT_DIGEST_FILE } from '../layout/feed.ts'
import { layoutDigest } from '../layout/gate.ts'
import { APP_DIR, REPO_ROOT, SERVER_ENTRY, postJson, startServer } from './helpers.ts'

const MUNICIPALITY = '00002'
const BULLETIN = 'TEST-FEED-1'
const SITE = 'feed-site'
const SHAPES = ['16x9', '9x16', '32x9', '1x1', 'pillar'] as const
const SECRET = 'a-shared-secret-of-enough-length'
const WEBHOOK_WAIT_MS = 8000
const EXPORT_WAIT_MS = 15000
const EXPORT_SWEEP_MS = 5000

const RECEIVED_AT = '2026-11-10T05:00:00.000Z'
const skip = !existsSync(SERVER_ENTRY) && 'run `pnpm -F app build` first'

async function makeDelivery(): Promise<{ dataDir: string; distDir: string; digest: string }> {
  const root = await mkdtemp(join(tmpdir(), 'evac-feed-'))
  const dataDir = join(root, 'data')
  const distDir = join(root, 'dist')
  const layoutDir = join(dataDir, 'layouts', SITE, BULLETIN)
  const assetDir = join(distDir, SITE, BULLETIN)
  await mkdir(layoutDir, { recursive: true })
  await mkdir(assetDir, { recursive: true })
  await mkdir(join(dataDir, 'sites'))
  const fixture = JSON.parse(await readFile(join(APP_DIR, 'fixtures', 'wajima-tsunami.json'), 'utf8'))
  const files = SHAPES.map((shape) => ({ shape, body: JSON.stringify({ ...fixture, shape, alert: { ...fixture.alert, bulletin_id: BULLETIN } }) }))
  for (const file of files) await writeFile(join(layoutDir, `${file.shape}.json`), file.body)
  const digest = layoutDigest(files)
  await writeFile(join(assetDir, EXPORT_DIGEST_FILE), digest)
  await writeFile(join(assetDir, '16x9.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  await writeFile(join(assetDir, '16x9.html'), '<!doctype html><title>16x9</title>')
  await writeFile(join(assetDir, 'pillar.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  await writeFile(join(assetDir, 'pillar.html'), '<!doctype html><title>pillar</title>')
  await writeFile(
    join(dataDir, 'layouts', SITE, 'index.json'),
    JSON.stringify({
      municipality: MUNICIPALITY,
      name: 'フィード市',
      site: SITE,
      entries: [{ issued_at: '2026-10-21T15:55:00+09:00', bulletin_id: BULLETIN, wmo_code: 'VXKO50', raw_title: 'test', municipality_level: 4, screen: true }],
    }),
  )
  await mkdir(join(dataDir, 'live'))
  await writeFile(join(dataDir, 'live', `${SITE}.receiver.json`), JSON.stringify({ since: '2026-10-21T06:55:19Z', showing: {}, received_at: RECEIVED_AT }))
  await writeFile(
    join(dataDir, 'sites', `${SITE}.json`),
    JSON.stringify({ id: SITE, municipality_id: MUNICIPALITY, replay: { municipality: MUNICIPALITY, speed: 1200 } }),
  )
  return { dataDir, distDir, digest }
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
  let digestFile = ''

  before(async () => {
    const { dataDir, distDir } = await makeDelivery()
    digestFile = join(distDir, SITE, BULLETIN, EXPORT_DIGEST_FILE)
    ;({ base, child } = await startServer({ NUXT_DATA_DIR: dataDir, NUXT_DIST_DIR: distDir, NUXT_ADMIN_TOKEN: '', NUXT_WEBHOOK_ALLOW_PRIVATE: '' }))
  })
  after(() => child?.kill())

  test('is ambient before approval, alert with layouts and assets after, and passes the feed schema', async () => {
    const ambient = await fetch(`${base}/api/feed/${SITE}`)
    assert.equal(ambient.status, 200)
    const ambientFeed = await ambient.json()
    assert.equal(ambientFeed.state, 'ambient')
    assert.equal(ambientFeed.last_received_at, RECEIVED_AT)
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
    assert.equal(alertFeed.last_received_at, RECEIVED_AT)
    assert.equal(alertFeed.bulletin_id, BULLETIN)
    assert.equal(alertFeed.alert.template, 'evac-now')
    assert.deepEqual(Object.keys(alertFeed.layouts).sort(), [...SHAPES].sort())
    assert.deepEqual(alertFeed.assets, {
      '16x9': { png: `/delivery/${SITE}/${BULLETIN}/16x9.png`, html: `/delivery/${SITE}/${BULLETIN}/16x9.html` },
      pillar: { png: `/delivery/${SITE}/${BULLETIN}/pillar.png`, html: `/delivery/${SITE}/${BULLETIN}/pillar.html` },
    })
    assert.match(await validateWithAgents(alertFeed), /^OK /)

    const pillar = await fetch(`${base}/api/live-layout?municipality=${MUNICIPALITY}&bulletin=${BULLETIN}&shape=pillar&site=${SITE}`)
    assert.equal(pillar.status, 200)
    assert.equal((await pillar.json()).shape, 'pillar')

    const png = await fetch(`${base}${alertFeed.assets['16x9'].png}`)
    assert.equal(png.status, 200)
    assert.equal(png.headers.get('content-type'), 'image/png')
    assert.equal((await fetch(`${base}${alertFeed.assets.pillar.png}`)).status, 200)
    assert.equal((await fetch(`${base}${alertFeed.assets.pillar.html}`)).status, 200)
    assert.equal((await fetch(`${base}/delivery/${SITE}/${BULLETIN}/..%2F..%2Fsites%2F${SITE}.json`)).status, 404)
    assert.equal((await fetch(`${base}/delivery/${SITE}/${BULLETIN}/${EXPORT_DIGEST_FILE}`)).status, 404)

    const exportedFrom = await readFile(digestFile, 'utf8')
    await writeFile(digestFile, 'sha256:screens-as-they-were-before')
    const outdated = await (await fetch(`${base}/api/feed/${SITE}`)).json()
    assert.equal(outdated.state, 'alert')
    assert.deepEqual(outdated.assets, {}, 'files exported from other screens are not linked')
    await writeFile(digestFile, exportedFrom)

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

const FAKE_EXPORTER = `#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
const { values } = parseArgs({ options: { site: { type: 'string' }, bulletin: { type: 'string' }, out: { type: 'string' }, 'base-url': { type: 'string' } } })
appendFileSync(process.env.FAKE_EXPORT_CALLS, values.site + ' ' + values.bulletin + '\\n')
if (process.env.FAKE_EXPORT_FAILS) {
  console.error('[export stopped] no Chrome found')
  process.exit(3)
}
const dir = join(values.out, values.site, values.bulletin)
mkdirSync(dir, { recursive: true })
for (const shape of ${JSON.stringify(SHAPES)}) {
  writeFileSync(join(dir, shape + '.png'), 'png from ' + values['base-url'])
  writeFileSync(join(dir, shape + '.html'), '<!doctype html>')
}
writeFileSync(join(dir, '${EXPORT_DIGEST_FILE}'), process.env.FAKE_EXPORT_DIGEST)
`

async function startExportingServer(env: Record<string, string>, approvedBeforeStart = false) {
  const { dataDir, distDir, digest } = await makeDelivery()
  if (approvedBeforeStart) {
    const at = '2026-11-10T00:00:00.000Z'
    const approvals = { version: '0.1', layouts: { [`${SITE}/${BULLETIN}`]: { approved: true, updated_at: at, digest } }, sites: { [SITE]: { auto_publish: true, updated_at: at } }, classes: {} }
    await writeFile(join(dataDir, 'approvals.json'), JSON.stringify(approvals))
  }
  await rm(join(distDir, SITE), { recursive: true })
  const exporter = join(dataDir, 'fake-export.mjs')
  const calls = join(dataDir, 'fake-export-calls.log')
  await writeFile(exporter, FAKE_EXPORTER)
  await chmod(exporter, 0o755)
  await writeFile(calls, '')
  const server = await startServer({ NUXT_DATA_DIR: dataDir, NUXT_DIST_DIR: distDir, NUXT_ADMIN_TOKEN: '', NUXT_EXPORT_COMMAND: exporter, FAKE_EXPORT_CALLS: calls, FAKE_EXPORT_DIGEST: digest, ...env })
  return { ...server, dataDir, calls }
}

interface ExportJob { status: string; message?: string }

async function exportJob(dataDir: string, status: string): Promise<ExportJob> {
  const deadline = Date.now() + EXPORT_WAIT_MS
  let job: ExportJob | undefined
  while (Date.now() < deadline) {
    job = await readFile(join(dataDir, 'live', `${SITE}.export.json`), 'utf8').then((body) => JSON.parse(body).jobs[BULLETIN], () => undefined)
    if (job?.status === status) return job
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.fail(`expected the export of ${BULLETIN} to be ${status}, last saw ${JSON.stringify(job)}`)
}

// A replay site is on its bulletin only for part of each replay round, so the feed is asked until it is.
async function feedOnAlert(base: string) {
  const deadline = Date.now() + EXPORT_WAIT_MS
  let feed: { state: string; assets: Record<string, { png: string }> } | undefined
  while (Date.now() < deadline) {
    feed = await (await fetch(`${base}/api/feed/${SITE}`)).json()
    if (feed!.state === 'alert') break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.equal(feed?.state, 'alert')
  return feed!
}

describe('export on approval', { skip }, () => {
  const children: ChildProcess[] = []
  after(() => children.forEach((child) => child.kill()))

  test('approving a bulletin of a publishing site exports it once, and the feed then links every shape', async () => {
    const { base, child, dataDir, calls } = await startExportingServer({})
    children.push(child)
    await approve(base, true)
    assert.equal((await (await fetch(`${base}/api/feed/${SITE}`)).json()).state, 'alert')

    await exportJob(dataDir, 'ok')
    const feed = await feedOnAlert(base)
    assert.deepEqual(Object.keys(feed.assets).sort(), [...SHAPES].sort())
    const png = await fetch(`${base}${feed.assets.pillar!.png}`)
    assert.equal(png.status, 200)
    assert.equal(await png.text(), `png from ${base}`)

    await approve(base, true)
    assert.equal(await readFile(calls, 'utf8'), `${SITE} ${BULLETIN}\n`, 'screens that are already exported are not rendered again')
  })

  test('an approval given while auto publish is off is exported when auto publish is switched on', async () => {
    const { base, child, dataDir, calls } = await startExportingServer({})
    children.push(child)
    assert.equal((await postJson(base, '/api/admin/approve', { site_id: SITE, bulletin_id: BULLETIN, approved: true })).status, 200)
    assert.equal(await readFile(calls, 'utf8'), '')

    assert.equal((await postJson(base, '/api/admin/site', { site_id: SITE, auto_publish: true })).status, 200)
    await exportJob(dataDir, 'ok')
    assert.equal(await readFile(calls, 'utf8'), `${SITE} ${BULLETIN}\n`)
    assert.deepEqual(Object.keys((await feedOnAlert(base)).assets).sort(), [...SHAPES].sort())
  })

  test('a failed export is recorded with its reason and leaves the alert on the feed without assets', async () => {
    const { base, child, dataDir } = await startExportingServer({ FAKE_EXPORT_FAILS: '1' })
    children.push(child)
    await approve(base, true)

    const job = await exportJob(dataDir, 'failed')
    assert.match(job.message ?? '', /no Chrome found/)
    assert.deepEqual((await feedOnAlert(base)).assets, {})
  })

  test('a bulletin that is on the feed with no approval action since the server started is exported by the sweep', async () => {
    const { base, child, dataDir, calls } = await startExportingServer({}, true)
    children.push(child)
    await feedOnAlert(base)

    await exportJob(dataDir, 'ok')
    assert.deepEqual(Object.keys((await feedOnAlert(base)).assets).sort(), [...SHAPES].sort())
    assert.equal(await readFile(calls, 'utf8'), `${SITE} ${BULLETIN}\n`)
  })

  test('the sweep does not export the same screens again after their export failed', async () => {
    const { base, child, dataDir, calls } = await startExportingServer({ FAKE_EXPORT_FAILS: '1' }, true)
    children.push(child)
    await feedOnAlert(base)

    await exportJob(dataDir, 'failed')
    await new Promise((resolve) => setTimeout(resolve, 2 * EXPORT_SWEEP_MS))
    assert.equal(await readFile(calls, 'utf8'), `${SITE} ${BULLETIN}\n`)
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
