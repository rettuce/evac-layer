import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { SERVER_ENTRY, postJson, startServer } from './helpers.ts'
import { type SmtpMessage, decodeWords, parseMail, pause, smtpReceiver, stop, until, writeSite } from './notify-helpers.ts'

const MINUTE = 60000
const TICKS_MS = 7000
const OPERATOR = 'operator-token-0123456789abcdef'
const FACILITY_A = 'facility-a-token-0123456789abcdef'
const FACILITY_B = 'facility-b-token-0123456789abcdef'

const skip = !existsSync(SERVER_ENTRY) && 'run `pnpm -F app build` first'

const isReceiverNotice = (text: string) => /受信が(まだ)?止まっています/.test(text)
const isIdleNotice = (text: string) => /フィードを取りに来て/.test(text)
const about = (id: string) => (text: string) => text.includes(`(\`${id}\`)`)

describe('notices that something has stopped', { skip }, () => {
  const slackBodies: string[] = []
  const mails: SmtpMessage[] = []
  const smtpSeen = { connections: 0, commands: [] as string[] }
  const slack = createHttpServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      slackBodies.push(body)
      res.writeHead(200).end('ok')
    })
  })
  const smtp = smtpReceiver(mails, smtpSeen)
  const children: ChildProcess[] = []
  const roots: string[] = []
  const pollers: NodeJS.Timeout[] = []
  let output = ''
  let slackUrl = ''
  let mailEnv: Record<string, string> = {}

  before(async () => {
    await new Promise<void>((resolve) => slack.listen(0, '127.0.0.1', resolve))
    await new Promise<void>((resolve) => smtp.listen(0, '127.0.0.1', resolve))
    slackUrl = `http://127.0.0.1:${(slack.address() as { port: number }).port}/services/liveness`
    mailEnv = {
      NUXT_NOTIFY_SMTP_URL: `smtp://127.0.0.1:${(smtp.address() as { port: number }).port}`,
      NUXT_NOTIFY_MAIL_FROM: 'evac-layer@example.org',
      NUXT_NOTIFY_MAIL_TO: 'ops@example.org',
    }
  })
  after(async () => {
    for (const poller of pollers) clearInterval(poller)
    await Promise.all(children.map(stop))
    slack.close()
    smtp.close()
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
  })

  async function reset() {
    for (const poller of pollers) clearInterval(poller)
    await Promise.all(children.map(stop))
    slackBodies.length = 0
    mails.length = 0
    output = ''
  }

  const notices = () => slackBodies.map((body) => JSON.parse(body).text as string)
  const receiverNotices = () => notices().filter(isReceiverNotice)
  const idleNotices = (id: string) => notices().filter(isIdleNotice).filter(about(id))

  async function serve(env: Record<string, string>, dataDir: string) {
    const server = await startServer({ NUXT_ADMIN_TOKEN: '', NUXT_DATA_DIR: dataDir, NUXT_NOTIFY_ALLOW_PLAINTEXT: '1', NUXT_NOTIFY_SLACK_WEBHOOK_URL: slackUrl, ...env }, undefined, (text) => (output += text))
    children.push(server.child)
    return server
  }

  async function newDataDir(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'evac-liveness-'))
    roots.push(root)
    return join(root, 'data')
  }

  const quietSite = (dataDir: string, id: string, extra: { name?: string; facility_id?: string } = {}) => writeSite(dataDir, { id, name: extra.name ?? id, live: null, rows: [], ...extra })

  async function receivedAt(dataDir: string, id: string, at: number) {
    await writeFile(join(dataDir, 'live', `${id}.receiver.json`), JSON.stringify({ since: new Date(at).toISOString(), showing: {}, received_at: new Date(at).toISOString() }))
  }

  async function replaySite(dataDir: string, id: string) {
    await quietSite(dataDir, id)
    await writeFile(join(dataDir, 'sites', `${id}.json`), JSON.stringify({ id, municipality_id: '00004', replay: { from: '2026-10-31T16:00+09:00', to: '2026-10-31T17:00+09:00', speed: 1 } }))
  }

  function poll(base: string, id: string, everyMs = 1000): () => void {
    let etag: string | undefined
    const once = async () => {
      const answer = await fetch(`${base}/api/feed/${id}`, { headers: etag ? { 'if-none-match': etag } : {} }).catch(() => undefined)
      etag = answer?.headers.get('etag') ?? etag
      await answer?.arrayBuffer()
    }
    void once()
    const timer = setInterval(once, everyMs)
    pollers.push(timer)
    return () => clearInterval(timer)
  }

  test('a stopped receiver is one notice that lists every stopped site, reminds, stops when receiving is back and starts over when it stops again', async () => {
    await reset()
    const dataDir = await newDataDir()
    for (const id of ['recv-a', 'recv-b', 'recv-fresh', 'recv-never']) await quietSite(dataDir, id)
    await replaySite(dataDir, 'recv-replay')
    const now = Date.now()
    await receivedAt(dataDir, 'recv-a', now - 40 * MINUTE)
    await receivedAt(dataDir, 'recv-b', now - 20 * MINUTE)
    await receivedAt(dataDir, 'recv-fresh', now)
    await receivedAt(dataDir, 'recv-replay', now - 40 * MINUTE)
    await serve({ ...mailEnv, NUXT_NOTIFY_RECEIVER_STOPPED_MINUTES: '1', NUXT_NOTIFY_REMIND_MINUTES: '0.05' }, dataDir)

    await until('a receiver notice', () => receiverNotices().length >= 1)
    await until('a receiver mail', () => mails.length >= 1)
    const first = receiverNotices()[0]!
    assert.ok(about('recv-a')(first) && about('recv-b')(first), first)
    for (const id of ['recv-fresh', 'recv-never', 'recv-replay']) assert.ok(!first.includes(id), `${id} is listed: ${first}`)
    assert.ok(!first.includes('回目'))
    assert.equal(notices().filter((text) => !isReceiverNotice(text)).length, 0)
    const { headers, body } = parseMail(mails[0]!.raw)
    assert.match(decodeWords(headers.subject!), /2/)
    assert.ok(body.includes('recv-a') && body.includes('recv-b'))

    await until('a reminder', () => receiverNotices().some((text) => text.includes('2 回目')))

    for (const id of ['recv-a', 'recv-b']) await receivedAt(dataDir, id, Date.now())
    await pause(3000)
    const sent = receiverNotices().length
    await pause(TICKS_MS)
    assert.equal(receiverNotices().length, sent, 'no reminder once receiving is back')

    await receivedAt(dataDir, 'recv-a', Date.now() - 30 * MINUTE)
    await until('a notice when it stops again', () => receiverNotices().length > sent)
    const again = receiverNotices()[sent]!
    assert.ok(about('recv-a')(again) && !again.includes('recv-b') && !again.includes('回目'), again)
  })

  test('without any receive record, or with the threshold at 0, no receiver notice is sent', async () => {
    await reset()
    const dataDir = await newDataDir()
    await quietSite(dataDir, 'recv-none')
    await serve({ NUXT_NOTIFY_RECEIVER_STOPPED_MINUTES: '0.01', NUXT_NOTIFY_REMIND_MINUTES: '0' }, dataDir)

    const offDir = await newDataDir()
    await quietSite(offDir, 'recv-off')
    await receivedAt(offDir, 'recv-off', Date.now() - 60 * MINUTE)
    await serve({ NUXT_NOTIFY_RECEIVER_STOPPED_MINUTES: '0', NUXT_NOTIFY_REMIND_MINUTES: '0' }, offDir)

    await pause(TICKS_MS)
    assert.deepEqual(notices(), [])
  })

  test('a site screen that stops polling is notified, a warning it should show comes first, a poll stops the reminders and a new stop starts over', async () => {
    await reset()
    const dataDir = await newDataDir()
    await quietSite(dataDir, 'idle-calm')
    await writeSite(dataDir, { id: 'idle-alert', name: 'idle-alert' })
    await quietSite(dataDir, 'idle-never')
    await replaySite(dataDir, 'idle-replay')
    const { base } = await serve({ NUXT_NOTIFY_FEED_IDLE_MINUTES: '0.1', NUXT_NOTIFY_REMIND_MINUTES: '0.05', NUXT_NOTIFY_RECEIVER_STOPPED_MINUTES: '0' }, dataDir)
    assert.equal((await postJson(base, '/api/admin/site', { site_id: 'idle-alert', auto_publish: true })).status, 200)
    assert.equal((await postJson(base, '/api/admin/approve', { site_id: 'idle-alert', bulletin_id: 'TEST-NOTIFY-1', approved: true })).status, 200)
    const calm = await fetch(`${base}/api/feed/idle-calm`)
    assert.equal(calm.status, 200)
    const notModified = await fetch(`${base}/api/feed/idle-calm`, { headers: { 'if-none-match': calm.headers.get('etag')! } })
    assert.equal(notModified.status, 304)
    assert.equal((await (await fetch(`${base}/api/feed/idle-alert`)).json()).state, 'alert')
    await fetch(`${base}/api/feed/idle-replay`).then((answer) => answer.arrayBuffer())

    await until('idle notices', () => idleNotices('idle-calm').length >= 1 && idleNotices('idle-alert').length >= 1)
    const alert = idleNotices('idle-alert')[0]!
    assert.match(alert, /^【EVAC LAYER・警報中】/)
    assert.ok(alert.includes('TEST-NOTIFY-1'), alert)
    const calmNotice = idleNotices('idle-calm')[0]!
    assert.ok(!calmNotice.includes('警報中') && calmNotice.includes('平常'), calmNotice)
    assert.equal(idleNotices('idle-never').length, 0)
    assert.equal(idleNotices('idle-replay').length, 0)

    const stopPolling = poll(base, 'idle-alert')
    await until('a reminder for the site that stays idle', () => idleNotices('idle-calm').some((text) => text.includes('2 回目')))
    await pause(3000)
    const sent = idleNotices('idle-alert').length
    await pause(TICKS_MS)
    assert.equal(idleNotices('idle-alert').length, sent, 'no reminder while the site polls (with If-None-Match)')

    stopPolling()
    await until('a notice when it stops again', () => idleNotices('idle-alert').length > sent)
    assert.ok(!idleNotices('idle-alert')[sent]!.includes('回目'))
    assert.equal(idleNotices('idle-never').length, 0)
    assert.equal(idleNotices('idle-replay').length, 0)
  })

  test('after a restart, a site that polled before it is notified only once the threshold has passed since the start', async () => {
    await reset()
    const dataDir = await newDataDir()
    await quietSite(dataDir, 'idle-restart')
    const env = { NUXT_NOTIFY_FEED_IDLE_MINUTES: '0.1', NUXT_NOTIFY_REMIND_MINUTES: '0', NUXT_NOTIFY_RECEIVER_STOPPED_MINUTES: '0' }
    let { base, child } = await serve(env, dataDir)
    await fetch(`${base}/api/feed/idle-restart`).then((answer) => answer.arrayBuffer())
    const seenFile = join(dataDir, 'live', 'idle-restart.feed-seen.json')
    await until('the last poll on disk', () => existsSync(seenFile))
    const lastPoll = JSON.parse(await readFile(seenFile, 'utf8')).last_request_at as string
    await stop(child)
    await pause(TICKS_MS)
    await reset()

    const started = Date.now()
    ;({ base, child } = await serve(env, dataDir))
    await pause(3000)
    assert.equal(idleNotices('idle-restart').length, 0, 'not within the threshold after the start')
    await until('a notice once the threshold has passed', () => idleNotices('idle-restart').length >= 1)
    assert.ok(Date.now() - started >= 5500)
    assert.ok(idleNotices('idle-restart')[0]!.includes(lastPoll), 'the last poll from before the restart is named')
  })

  test('deleting a site removes its last poll, a site registered again under the id starts with none, and facilities read neither', async () => {
    await reset()
    const dataDir = await newDataDir()
    await quietSite(dataDir, 'shared-gate', { name: 'A の駅', facility_id: 'alpha-fac' })
    const sha256 = (token: string) => createHash('sha256').update(token).digest('hex')
    const record = (token: string, facility_id: string) => ({ id: randomUUID().slice(0, 8), label: facility_id, facility_id, sha256: sha256(token), created_at: '2026-11-01T00:00:00Z' })
    await writeFile(join(dataDir, 'tokens.json'), JSON.stringify({ version: '0.1', tokens: [record(FACILITY_A, 'alpha-fac'), record(FACILITY_B, 'beta-fac')] }), { mode: 0o600 })
    const { base } = await serve({ NUXT_ADMIN_TOKEN: OPERATOR, NUXT_NOTIFY_FEED_IDLE_MINUTES: '0.2', NUXT_NOTIFY_REMIND_MINUTES: '0', NUXT_NOTIFY_RECEIVER_STOPPED_MINUTES: '0' }, dataDir)
    const as = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' })

    await fetch(`${base}/api/feed/shared-gate`).then((answer) => answer.arrayBuffer())
    const seenFile = join(dataDir, 'live', 'shared-gate.feed-seen.json')
    await until('the last poll on disk', () => existsSync(seenFile))
    for (const path of ['/api/admin/sites', '/api/admin/sites/shared-gate', '/api/admin/catalog?site=shared-gate']) {
      const answer = await fetch(`${base}${path}`, { headers: as(FACILITY_A) })
      assert.equal(answer.status, 200, path)
      const body = await answer.text()
      for (const leak of ['last_request_at', 'feed-seen', 'feed_idle', 'notify', 'receiver_stopped']) assert.ok(!body.includes(leak), `${path} carries ${leak}`)
    }

    assert.equal((await fetch(`${base}/api/admin/sites/shared-gate`, { method: 'DELETE', headers: as(OPERATOR) })).status, 204)
    assert.ok(!existsSync(seenFile), 'deleting the site removes its last poll')
    const registered = await fetch(`${base}/api/admin/sites/shared-gate`, { method: 'PUT', headers: as(FACILITY_B), body: JSON.stringify({ lat: 35, lng: 139, municipality_id: '00004', name: 'B の駅' }) })
    assert.equal(registered.status, 201)
    await quietSite(dataDir, 'shared-gate', { name: 'B の駅', facility_id: 'beta-fac' })
    await pause(12000 + TICKS_MS)
    assert.equal(idleNotices('shared-gate').length, 0, 'the new site never polled')
    assert.ok(!existsSync(seenFile))
  })
})
