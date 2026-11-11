import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { SERVER_ENTRY, postJson, startServer } from './helpers.ts'
import { type SmtpMessage, decodeWords, filesUnder, parseMail, pause, smtpReceiver, stop, until, writeSite } from './notify-helpers.ts'

const MINUTE = 60000
const TICKS_MS = 7000
const OPERATOR = 'operator-token-0123456789abcdef'
const FACILITY_A = 'facility-a-token-0123456789abcdef'
const FACILITY_B = 'facility-b-token-0123456789abcdef'
const RECORD_WORDS = ['last_request_at', 'first_request_at', 'feed-seen', 'feed-idle', 'receivers.json', 'FEED_IDLE', 'RECEIVER_STOPPED']

const skip = !existsSync(SERVER_ENTRY) && 'run `pnpm -F app build` first'

const isReceiverNotice = (text: string) => /受信が(まだ)?止まっています/.test(text)
const isIdleNotice = (text: string) => /フィードを取りに来ていません/.test(text)
const about = (id: string) => (text: string) => text.includes(`(\`${id}\`)`)

describe('notices that something has stopped', { skip }, () => {
  const slackBodies: string[] = []
  const mails: SmtpMessage[] = []
  const slack = createHttpServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      slackBodies.push(body)
      res.writeHead(200).end('ok')
    })
  })
  const smtp = smtpReceiver(mails, { connections: 0, commands: [] })
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
  const idleNotices = () => notices().filter(isIdleNotice)

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

  async function receivedAt(dataDir: string, id: string, at: number | string) {
    const stamp = typeof at === 'string' ? at : new Date(at).toISOString()
    await writeFile(join(dataDir, 'live', `${id}.receiver.json`), JSON.stringify({ since: stamp, showing: {}, received_at: stamp }))
  }

  async function replaySite(dataDir: string, id: string) {
    await quietSite(dataDir, id)
    await writeFile(join(dataDir, 'sites', `${id}.json`), JSON.stringify({ id, municipality_id: '00004', replay: { from: '2026-10-31T16:00+09:00', to: '2026-10-31T17:00+09:00', speed: 1 } }))
  }

  function poll(base: string, path: string, everyMs = 1000): () => void {
    let etag: string | undefined
    const once = async () => {
      const answer = await fetch(`${base}${path}`, { headers: etag ? { 'if-none-match': etag } : {} }).catch(() => undefined)
      etag = answer?.headers.get('etag') ?? etag
      await answer?.arrayBuffer()
    }
    void once()
    const timer = setInterval(once, everyMs)
    pollers.push(timer)
    return () => clearInterval(timer)
  }

  const feedOf = (id: string) => `/api/feed/${id}`
  const screenOf = (id: string) => `/api/replay?site=${id}`

  test('a stopped receiver is one notice that lists every stopped site, reminds, stops when receiving is back and starts over when it stops again', async () => {
    await reset()
    const dataDir = await newDataDir()
    for (const id of ['recv-a', 'recv-b', 'recv-fresh', 'recv-never', 'recv-broken', 'recv-ahead']) await quietSite(dataDir, id)
    await replaySite(dataDir, 'recv-replay')
    const now = Date.now()
    await receivedAt(dataDir, 'recv-a', now - 40 * MINUTE)
    await receivedAt(dataDir, 'recv-b', now - 20 * MINUTE)
    await receivedAt(dataDir, 'recv-fresh', now)
    await receivedAt(dataDir, 'recv-replay', now - 40 * MINUTE)
    await receivedAt(dataDir, 'recv-ahead', now + 60 * MINUTE)
    await writeFile(join(dataDir, 'live', 'recv-broken.receiver.json'), '{"received_at": ')
    await serve({ ...mailEnv, NUXT_NOTIFY_RECEIVER_STOPPED_MINUTES: '1', NUXT_NOTIFY_REMIND_MINUTES: '0.05', NUXT_NOTIFY_FEED_IDLE_MINUTES: '0' }, dataDir)

    await until('a receiver notice', () => receiverNotices().length >= 1)
    await until('a receiver mail', () => mails.length >= 1)
    const first = receiverNotices()[0]!
    assert.ok(about('recv-a')(first) && about('recv-b')(first), first)
    for (const id of ['recv-fresh', 'recv-never', 'recv-replay', 'recv-broken', 'recv-ahead']) assert.ok(!first.includes(id), `${id} is listed: ${first}`)
    assert.ok(!first.includes('回目'))
    assert.equal(notices().filter((text) => !isReceiverNotice(text)).length, 0)
    const { headers, body } = parseMail(mails[0]!.raw)
    assert.match(decodeWords(headers.subject!), /2 施設/)
    assert.ok(body.includes('recv-a') && body.includes('recv-b'))
    assert.match(output, /recv-broken/)
    assert.match(output, /recv-ahead/)

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

  test('screens that stop polling are one notice, a warning to show comes first, sites polled once, never, by replay or with a failing feed are left out, and a new stop starts over', async () => {
    await reset()
    const dataDir = await newDataDir()
    for (const id of ['idle-calm', 'idle-once', 'idle-never']) await quietSite(dataDir, id)
    await writeSite(dataDir, { id: 'idle-alert', name: 'idle-alert' })
    await writeSite(dataDir, { id: 'idle-failing', name: 'idle-failing' })
    await writeFile(join(dataDir, 'live', 'idle-failing.json'), '{"bulletin_id": ')
    await replaySite(dataDir, 'idle-replay')
    const { base } = await serve({ NUXT_NOTIFY_FEED_IDLE_MINUTES: '0.1', NUXT_NOTIFY_REMIND_MINUTES: '0.05', NUXT_NOTIFY_RECEIVER_STOPPED_MINUTES: '0' }, dataDir)
    assert.equal((await postJson(base, '/api/admin/site', { site_id: 'idle-alert', auto_publish: true })).status, 200)
    assert.equal((await postJson(base, '/api/admin/approve', { site_id: 'idle-alert', bulletin_id: 'TEST-NOTIFY-1', approved: true })).status, 200)
    assert.equal((await (await fetch(`${base}${feedOf('idle-alert')}`)).json()).state, 'alert')
    assert.equal((await fetch(`${base}${feedOf('idle-failing')}`)).status, 500)
    await fetch(`${base}${feedOf('idle-once')}`).then((answer) => answer.arrayBuffer())
    const stopCalm = poll(base, feedOf('idle-calm'))
    const stopAlert = poll(base, feedOf('idle-alert'))
    poll(base, feedOf('idle-failing'))
    const stopReplay = poll(base, feedOf('idle-replay'))
    await pause(8000)
    stopCalm()
    stopAlert()
    stopReplay()

    await until('an idle notice', () => idleNotices().length >= 1)
    await pause(1000)
    assert.equal(idleNotices().length, 1, 'one notice for both sites')
    const first = idleNotices()[0]!
    assert.match(first, /^【EVAC LAYER・警報中】/)
    const listed = first.split('\n\n')[0]!.split('\n').filter((line) => line.startsWith('- '))
    assert.ok(about('idle-alert')(listed[0]!) && listed[0]!.includes('TEST-NOTIFY-1'), first)
    assert.ok(about('idle-calm')(listed[1]!) && listed[1]!.includes('平常'), first)
    assert.equal(listed.length, 2)
    for (const id of ['idle-once', 'idle-never', 'idle-replay', 'idle-failing']) assert.ok(!first.includes(id), `${id} is listed: ${first}`)
    assert.match(first.split('\n')[0]!, /同時に/, 'two of the three watched sites (the failing one still polls) stopped together')

    await until('a reminder', () => idleNotices().some((text) => text.includes('2 回目')))
    const backCalm = poll(base, feedOf('idle-calm'))
    const backAlert = poll(base, feedOf('idle-alert'))
    await pause(3000)
    const sent = idleNotices().length
    await pause(TICKS_MS)
    assert.equal(idleNotices().length, sent, 'no reminder while the sites poll (with If-None-Match)')

    backAlert()
    backCalm()
    await until('a notice when they stop again', () => idleNotices().length > sent)
    const again = idleNotices()[sent]!
    assert.ok(about('idle-calm')(again) && about('idle-alert')(again) && !again.includes('回目'), again)
  })

  test('a screen polling the way the bundled /screen does is watched, and three sites stopping at once name the server side', async () => {
    await reset()
    const dataDir = await newDataDir()
    for (const id of ['screen-a', 'screen-b', 'screen-c']) await quietSite(dataDir, id)
    const { base } = await serve({ NUXT_NOTIFY_FEED_IDLE_MINUTES: '0.1', NUXT_NOTIFY_REMIND_MINUTES: '0', NUXT_NOTIFY_RECEIVER_STOPPED_MINUTES: '0' }, dataDir)
    await fetch(`${base}/api/replay?site=screen-c&t=0`).then((answer) => answer.arrayBuffer())
    const stops = [poll(base, screenOf('screen-a')), poll(base, screenOf('screen-b')), poll(base, feedOf('screen-c'))]
    await pause(8000)
    for (const stopPolling of stops) stopPolling()
    await until('an idle notice', () => idleNotices().length >= 1)
    await pause(1000)
    assert.equal(idleNotices().length, 1)
    const notice = idleNotices()[0]!
    for (const id of ['screen-a', 'screen-b', 'screen-c']) assert.ok(about(id)(notice), `${id}: ${notice}`)
    assert.match(notice.split('\n')[0]!, /多くの施設が同時に止まっています.*サーバー側の経路/)
  })

  test('a site that should now show a warning is told at once (not sooner than a minute) and comes first', async () => {
    await reset()
    const dataDir = await newDataDir()
    await quietSite(dataDir, 'turn-calm')
    await writeSite(dataDir, { id: 'turn-alert', name: 'turn-alert' })
    const { base } = await serve({ NUXT_NOTIFY_FEED_IDLE_MINUTES: '0.1', NUXT_NOTIFY_REMIND_MINUTES: '0', NUXT_NOTIFY_RECEIVER_STOPPED_MINUTES: '0' }, dataDir)
    const stops = [poll(base, feedOf('turn-calm')), poll(base, feedOf('turn-alert'))]
    await pause(8000)
    for (const stopPolling of stops) stopPolling()
    await until('an idle notice', () => idleNotices().length >= 1)
    const first = idleNotices()[0]!
    assert.ok(!first.includes('警報中'), first)
    const firstAt = Date.now()

    assert.equal((await postJson(base, '/api/admin/site', { site_id: 'turn-alert', auto_publish: true })).status, 200)
    assert.equal((await postJson(base, '/api/admin/approve', { site_id: 'turn-alert', bulletin_id: 'TEST-NOTIFY-1', approved: true })).status, 200)
    await until('a notice that a site should now show a warning', () => idleNotices().length >= 2, 120000)
    assert.ok(Date.now() - firstAt >= 55000, 'not sooner than a minute after the last notice')
    const turned = idleNotices()[1]!
    assert.match(turned, /^【EVAC LAYER・警報中】/)
    assert.ok(about('turn-alert')(turned.split('\n')[1]!), turned)
    assert.equal(idleNotices().length, 2)
  })

  test('after a restart, a site is notified only once the threshold has passed since the start, and a notice sent before is not sent again', async () => {
    await reset()
    const dataDir = await newDataDir()
    await quietSite(dataDir, 'idle-restart')
    const seenFile = join(dataDir, 'live', 'idle-restart.feed-seen.json')
    const env = { NUXT_NOTIFY_FEED_IDLE_MINUTES: '0.2', NUXT_NOTIFY_REMIND_MINUTES: '60', NUXT_NOTIFY_RECEIVER_STOPPED_MINUTES: '0' }
    let { base, child } = await serve(env, dataDir)
    const stopPolling = poll(base, feedOf('idle-restart'))
    await pause(14000)
    stopPolling()
    const span = async () => {
      const stored = JSON.parse(await readFile(seenFile, 'utf8').catch(() => '{}'))
      return Date.parse(stored.last_request_at) - Date.parse(stored.first_request_at)
    }
    let stored = 0
    await until('the last request on disk', () => {
      void span().then((ms) => (stored = ms))
      return stored >= 12000
    }, 11000)
    const lastRequest = JSON.parse(await readFile(seenFile, 'utf8')).last_request_at as string
    await stop(child)
    assert.equal(idleNotices().length, 0)
    await pause(TICKS_MS)

    const started = Date.now()
    ;({ base, child } = await serve(env, dataDir))
    await pause(8000)
    assert.equal(idleNotices().length, 0, 'not within the threshold after the start')
    await until('a notice once the threshold has passed', () => idleNotices().length >= 1)
    assert.ok(Date.now() - started >= 11000)
    assert.ok(idleNotices()[0]!.includes(lastRequest), 'the last request from before the restart is named')

    await stop(child)
    ;({ base, child } = await serve(env, dataDir))
    await pause(12000 + TICKS_MS)
    assert.equal(idleNotices().length, 1, 'a restart does not send the first notice again')
  })

  test('deleting a site removes its requests, a site registered again under the id starts with none, and neither facilities nor delivery files read them', async () => {
    await reset()
    const dataDir = await newDataDir()
    const distDir = join(dataDir, '..', 'dist')
    await mkdir(distDir, { recursive: true })
    await quietSite(dataDir, 'shared-gate', { name: 'A の駅', facility_id: 'alpha-fac' })
    const sha256 = (token: string) => createHash('sha256').update(token).digest('hex')
    const record = (token: string, facility_id: string) => ({ id: randomUUID().slice(0, 8), label: facility_id, facility_id, sha256: sha256(token), created_at: '2026-11-01T00:00:00Z' })
    await writeFile(join(dataDir, 'tokens.json'), JSON.stringify({ version: '0.1', tokens: [record(FACILITY_A, 'alpha-fac'), record(FACILITY_B, 'beta-fac')] }), { mode: 0o600 })
    const { base } = await serve({ NUXT_ADMIN_TOKEN: OPERATOR, NUXT_DIST_DIR: distDir, NUXT_NOTIFY_FEED_IDLE_MINUTES: '0.2', NUXT_NOTIFY_REMIND_MINUTES: '0', NUXT_NOTIFY_RECEIVER_STOPPED_MINUTES: '0' }, dataDir)
    const as = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' })

    const stopPolling = poll(base, feedOf('shared-gate'))
    const seenFile = join(dataDir, 'live', 'shared-gate.feed-seen.json')
    await until('the requests on disk', () => existsSync(seenFile))
    for (const path of ['/api/admin/sites', '/api/admin/sites/shared-gate', '/api/admin/catalog?site=shared-gate', feedOf('shared-gate'), screenOf('shared-gate')]) {
      const answer = await fetch(`${base}${path}`, { headers: as(FACILITY_A) })
      assert.equal(answer.status, 200, path)
      const body = await answer.text()
      for (const leak of [...RECORD_WORDS, 'notify']) assert.ok(!body.includes(leak), `${path} carries ${leak}`)
    }
    for (const file of await filesUnder(distDir)) for (const leak of RECORD_WORDS) assert.ok(!file.includes(leak), `dist carries ${leak}`)
    assert.equal((await fetch(`${base}/delivery/shared-gate/x/16x9.json`)).status === 200, false)

    assert.equal((await fetch(`${base}/api/admin/sites/shared-gate`, { method: 'DELETE', headers: as(OPERATOR) })).status, 204)
    stopPolling()
    assert.ok(!existsSync(seenFile), 'deleting the site removes its requests')
    const registered = await fetch(`${base}/api/admin/sites/shared-gate`, { method: 'PUT', headers: as(FACILITY_B), body: JSON.stringify({ lat: 35, lng: 139, municipality_id: '00004', name: 'B の駅' }) })
    assert.equal(registered.status, 201)
    await quietSite(dataDir, 'shared-gate', { name: 'B の駅', facility_id: 'beta-fac' })
    await pause(12000 + TICKS_MS)
    assert.equal(idleNotices().length, 0, 'the new site never polled')
    assert.ok(!existsSync(seenFile))
  })
})
