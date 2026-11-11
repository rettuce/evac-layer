import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { type Server, createServer as createTcpServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import type { Approvals } from '../layout/gate.ts'
import { type NoticeFacts, mailMessage, slackMessage } from '../layout/notice.ts'
import { CHECK_FAILED_WINDOW_MS, type IndexRow, type ScreensRead, pendingReason, pendingSubject } from '../layout/pending.ts'
import { APP_DIR, SERVER_ENTRY, postJson, startServer } from './helpers.ts'

const SITE = 'notify-site'
const MUNICIPALITY = '00004'
const BULLETIN = 'TEST-NOTIFY-1'
const TITLE = '津波警報・注意報・予報a'
const AT = '2026-11-10T00:00:00.000Z'
const HOSTILE_NAME = '駅<!channel> <https://example.com|x>\n承認済み & ok\r\nBcc: victim@example.org'
const SLACK_SECRET = 'slack-secret-path-7f3a'
const SMTP_USER = 'smtp-user-9c1d'
const SMTP_PASS = 'smtp-pass-4e8b'
const WAIT_MS = 20000
const TICKS_MS = 7000

const skip = !existsSync(SERVER_ENTRY) && 'run `pnpm -F app build` first'

function approvalsWith(over: Partial<Approvals> = {}): Approvals {
  return { version: '0.1', layouts: {}, sites: { [SITE]: { auto_publish: true, updated_at: AT } }, classes: {}, ...over }
}

const CLASS = 'tsunami/evac-now/3'
const screens: ScreensRead = { kind: 'read', digest: 'sha256:files', cls: { key: CLASS, digest: 'sha256:class', checked: true, headline: true } }
const live = (bulletin: string | null) => ({ bulletin_id: bulletin, fallback_bulletin_id: null, updated_at: AT })
const row = (over: Partial<IndexRow>): IndexRow => ({ issued_at: '2026-11-09T10:00:00+09:00', bulletin_id: BULLETIN, raw_title: TITLE, municipality_level: 3, screen: true, ...over })
const NOW = Date.parse('2026-11-09T12:00:00+09:00')

describe('which state is waiting for an operator', () => {
  const reason = (approvals: Approvals, read: ScreensRead = screens, rowStatus?: string) =>
    pendingReason({ approvals, site: SITE, subject: { bulletin_id: BULLETIN }, screens: read, rowStatus })

  test('a real bulletin in the live state that the gate does not let out is pending, with the gate reason', () => {
    assert.equal(reason(approvalsWith()), 'unapproved')
    assert.equal(reason(approvalsWith({ layouts: { [`${SITE}/${BULLETIN}`]: { approved: true, updated_at: AT, digest: 'sha256:before' } } })), 'changed-after-approval')
    const approvedOff = approvalsWith({ layouts: { [`${SITE}/${BULLETIN}`]: { approved: true, updated_at: AT, digest: 'sha256:files' } }, sites: { [SITE]: { auto_publish: false, updated_at: AT } } })
    assert.equal(reason(approvedOff), 'auto-publish-off')
    assert.equal(reason(approvalsWith({ sites: { [SITE]: { auto_publish: false, updated_at: AT } } })), 'unapproved')
  })

  test('an approved bulletin, or one its class approval lets through, is not pending', () => {
    assert.equal(reason(approvalsWith({ layouts: { [`${SITE}/${BULLETIN}`]: { approved: true, updated_at: AT, digest: 'sha256:files' } } })), undefined)
    const byClass = approvalsWith({ classes: { [`${SITE}/${CLASS}`]: { approved: true, updated_at: AT, digest: 'sha256:class', approved_from: 'OTHER' } } })
    assert.equal(reason(byClass), undefined)
    const noEvidence: ScreensRead = { ...screens, cls: { ...screens.cls, headline: false } } as ScreensRead
    assert.equal(reason(byClass, noEvidence), 'unapproved', 'a class approval without the headline evidence does not let it through')
  })

  test('drills, tests and synthetic bulletins are never pending', () => {
    const drill: ScreensRead = { ...screens, cls: { ...screens.cls, key: `${CLASS}/drill` } } as ScreensRead
    assert.equal(reason(approvalsWith(), drill), undefined)
    assert.equal(reason(approvalsWith(), { kind: 'missing' }, 'test'), undefined)
    assert.equal(pendingSubject({ replay: false, live: live('SYN-tsunami-evac-now-3'), rows: [], now: NOW }), undefined)
  })

  test('screens that are missing or cannot be read are pending with their own reasons', () => {
    assert.equal(reason(approvalsWith(), { kind: 'missing' }), 'screens-missing')
    assert.equal(reason(approvalsWith(), { kind: 'unreadable' }), 'screens-unreadable')
  })

  test('a site with replay, or with nothing in its live state, has nothing pending', () => {
    assert.equal(pendingSubject({ replay: true, live: live(BULLETIN), rows: [row({})], now: NOW }), undefined)
    assert.equal(pendingSubject({ replay: false, live: undefined, rows: [], now: NOW }), undefined)
    assert.equal(pendingSubject({ replay: false, live: live(null), rows: [], now: NOW }), undefined)
    assert.deepEqual(pendingSubject({ replay: false, live: live(BULLETIN), rows: [row({})], now: NOW }), { bulletin_id: BULLETIN })
  })

  test('a newer bulletin whose screens did not pass the checks is pending as check-failed', () => {
    const failed = row({ bulletin_id: 'NEWER', issued_at: '2026-11-09T11:00:00+09:00', screen: false, template: 'evac-now', outcome: 'fail' })
    const subject = pendingSubject({ replay: false, live: live(BULLETIN), rows: [row({}), failed], now: NOW })
    assert.equal(subject?.bulletin_id, 'NEWER')
    assert.equal(pendingReason({ approvals: approvalsWith(), site: SITE, subject: subject!, screens }), 'check-failed')
    assert.equal(pendingSubject({ replay: false, live: undefined, rows: [failed], now: NOW })?.bulletin_id, 'NEWER', 'the first warning of a quiet site')

    const older = { ...failed, issued_at: '2026-11-09T09:00:00+09:00' }
    assert.equal(pendingSubject({ replay: false, live: live(BULLETIN), rows: [row({}), older], now: NOW })?.bulletin_id, BULLETIN)
    assert.equal(pendingSubject({ replay: false, live: undefined, rows: [failed], now: Date.parse(failed.issued_at) + CHECK_FAILED_WINDOW_MS + 1 }), undefined, 'records composed long ago')
    assert.equal(pendingSubject({ replay: false, live: undefined, rows: [{ ...failed, status: 'drill' }], now: NOW }), undefined)
    assert.equal(pendingSubject({ replay: false, live: undefined, rows: [{ ...failed, synthetic: true }], now: NOW }), undefined)
    assert.equal(pendingSubject({ replay: false, live: undefined, rows: [{ ...failed, template: undefined, outcome: undefined }], now: NOW }), undefined, 'a bulletin that needs no screen')
  })
})

const facts = (over: Partial<NoticeFacts> = {}): NoticeFacts => ({
  site: { id: SITE, name: HOSTILE_NAME, municipality_id: MUNICIPALITY, municipality_name: '通知市' },
  bulletin: { id: BULLETIN, title: TITLE, issued_at: '2026-11-09T10:00:00+09:00', level: 3 },
  reason: 'unapproved',
  auto_publish: true,
  showing: null,
  count: 1,
  first_seen_at: new Date(NOW).toISOString(),
  ...over,
})

describe('notice text', () => {
  test('names the site, the bulletin and the reason in Japanese and English', () => {
    const { text } = slackMessage(facts({ admin_url: 'https://ops.example.org/admin' }), NOW)
    for (const part of [SITE, BULLETIN, TITLE, 'unapproved', '通知市', MUNICIPALITY, 'https://ops.example.org/admin', 'Site', '施設', 'なし', 'nothing']) assert.ok(text.includes(part), part)
  })

  test('a reminder says which notice it is and how long since the state was first seen', () => {
    const { text } = slackMessage(facts({ count: 3, showing: { bulletin_id: 'OLDER', title: '前の警報' } }), NOW + 30 * 60 * 1000)
    assert.match(text, /3 回目/)
    assert.match(text, /30 分/)
    assert.match(text, /notice 3/)
    assert.match(text, /30 min/)
    assert.ok(text.includes('OLDER'))
    assert.match(mailMessage(facts({ count: 3 }), NOW).subject, /3/)
  })

  test('strings a facility registered cannot mention, link or add lines in Slack, or break the mail subject', () => {
    const { text } = slackMessage(facts(), NOW)
    assert.ok(!text.includes('<!channel>'))
    assert.ok(!text.includes('<https://example.com|x>'))
    assert.ok(text.includes('&lt;!channel&gt;'))
    assert.ok(text.includes('&amp; ok'))
    assert.ok(!/\n(承認済み|Bcc)/.test(text), 'the name stays on its own line')
    const { subject, text: body } = mailMessage(facts(), NOW)
    assert.ok(!/[\r\n]/.test(subject))
    assert.ok(!/\n(承認済み|Bcc)/.test(body))
  })
})

interface SmtpMessage { from: string; to: string[]; auth?: string; raw: string }

function smtpReceiver(messages: SmtpMessage[], connections: { count: number }): Server {
  return createTcpServer((socket) => {
    connections.count++
    let buffer = ''
    let data: string | undefined
    let message: SmtpMessage = { from: '', to: [], raw: '' }
    let auth: string | undefined
    let awaitingAuth = false
    const reply = (line: string) => socket.write(`${line}\r\n`)
    reply('220 test ESMTP')
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('latin1')
      for (;;) {
        if (data !== undefined) {
          const end = buffer.indexOf('\r\n.\r\n')
          if (end < 0) return
          messages.push({ ...message, ...(auth ? { auth } : {}), raw: Buffer.from(buffer.slice(0, end).replace(/^\.\./gm, '.'), 'latin1').toString('utf8') })
          buffer = buffer.slice(end + 5)
          data = undefined
          message = { from: '', to: [], raw: '' }
          reply('250 OK queued')
          continue
        }
        const end = buffer.indexOf('\r\n')
        if (end < 0) return
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        const verb = line.split(' ')[0]!.toUpperCase()
        if (awaitingAuth) {
          auth = line
          awaitingAuth = false
          reply('235 accepted')
        } else if (verb === 'EHLO') reply('250-test\r\n250 AUTH PLAIN LOGIN')
        else if (verb === 'HELO' || verb === 'RSET' || verb === 'NOOP') reply('250 OK')
        else if (verb === 'AUTH') {
          const [, , initial] = line.split(' ')
          if (initial) {
            auth = initial
            reply('235 accepted')
          } else {
            awaitingAuth = true
            reply('334 ')
          }
        } else if (verb === 'MAIL') {
          message.from = /<([^>]*)>/.exec(line)?.[1] ?? ''
          reply('250 OK')
        } else if (verb === 'RCPT') {
          message.to.push(/<([^>]*)>/.exec(line)?.[1] ?? '')
          reply('250 OK')
        } else if (verb === 'DATA') {
          data = ''
          reply('354 go ahead')
        } else if (verb === 'QUIT') {
          reply('221 bye')
          socket.end()
          return
        } else reply('502 not implemented')
      }
    })
    socket.on('error', () => undefined)
  })
}

function decodeWords(value: string): string {
  const unfolded = value.replace(/\r\n[ \t]/g, ' ').replace(/\?=\s+=\?/g, '?==?')
  return unfolded.replace(/(=\?utf-8\?[bq]\?[^?]*\?=)+/gi, (words) => {
    const bytes = [...words.matchAll(/=\?utf-8\?([bq])\?([^?]*)\?=/gi)].map(([, kind, text]) =>
      kind!.toLowerCase() === 'b'
        ? Buffer.from(text!, 'base64')
        : Buffer.from(text!.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))), 'latin1'),
    )
    return Buffer.concat(bytes).toString('utf8')
  })
}

function parseMail(raw: string): { headers: Record<string, string>; body: string } {
  const split = raw.indexOf('\r\n\r\n')
  const headers: Record<string, string> = {}
  for (const line of raw.slice(0, split).replace(/\r\n[ \t]/g, ' ').split('\r\n')) {
    const colon = line.indexOf(':')
    headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim()
  }
  const encoded = raw.slice(split + 4)
  const encoding = headers['content-transfer-encoding']?.toLowerCase()
  const body =
    encoding === 'base64'
      ? Buffer.from(encoded.replace(/\s+/g, ''), 'base64').toString('utf8')
      : encoding === 'quoted-printable'
        ? Buffer.from(encoded.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))), 'latin1').toString('utf8')
        : Buffer.from(encoded, 'latin1').toString('utf8')
  return { headers, body }
}

async function makeData(root: string): Promise<string> {
  const dataDir = join(root, 'data')
  const layoutDir = join(dataDir, 'layouts', SITE, BULLETIN)
  await mkdir(layoutDir, { recursive: true })
  await mkdir(join(dataDir, 'sites'))
  await mkdir(join(dataDir, 'live'))
  const fixture = JSON.parse(await readFile(join(APP_DIR, 'fixtures', 'wajima-tsunami.json'), 'utf8'))
  await writeFile(join(layoutDir, '16x9.json'), JSON.stringify({ ...fixture, alert: { ...fixture.alert, bulletin_id: BULLETIN } }))
  await writeFile(
    join(dataDir, 'layouts', SITE, 'index.json'),
    JSON.stringify({ municipality: MUNICIPALITY, name: '通知市', site: SITE, entries: [row({ template: 'evac-now', display_level: 3, outcome: 'pass' })] }),
  )
  await writeFile(join(dataDir, 'sites', `${SITE}.json`), JSON.stringify({ id: SITE, municipality_id: MUNICIPALITY, name: HOSTILE_NAME }))
  await writeFile(join(dataDir, 'live', `${SITE}.json`), JSON.stringify(live(BULLETIN)))
  return dataDir
}

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })
  return Promise.all(entries.filter((entry) => entry.isFile()).map((entry) => readFile(join(entry.parentPath, entry.name), 'utf8')))
}

async function until(what: string, ready: () => boolean) {
  const deadline = Date.now() + WAIT_MS
  while (!ready() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100))
  assert.ok(ready(), `timed out waiting for ${what}`)
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function stop(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    child.once('exit', () => resolve())
    child.kill()
  })
}

describe('operator notices', { skip }, () => {
  const slackBodies: string[] = []
  const slackPaths: string[] = []
  let slackFailures = 0
  const mails: SmtpMessage[] = []
  const smtpConnections = { count: 0 }
  const slack = createHttpServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      slackPaths.push(req.url ?? '')
      if (slackFailures > 0) {
        slackFailures--
        res.writeHead(500).end('busy')
        return
      }
      slackBodies.push(body)
      res.writeHead(200).end('ok')
    })
  })
  const smtp = smtpReceiver(mails, smtpConnections)
  const children: ChildProcess[] = []
  const roots: string[] = []
  let output = ''
  let env: Record<string, string> = {}

  before(async () => {
    await new Promise<void>((resolve) => slack.listen(0, '127.0.0.1', resolve))
    await new Promise<void>((resolve) => smtp.listen(0, '127.0.0.1', resolve))
    env = {
      NUXT_ADMIN_TOKEN: '',
      NUXT_NOTIFY_SLACK_WEBHOOK_URL: `http://127.0.0.1:${(slack.address() as { port: number }).port}/services/${SLACK_SECRET}`,
      NUXT_NOTIFY_ALLOW_HTTP: '1',
      NUXT_NOTIFY_SMTP_URL: `smtp://${SMTP_USER}:${SMTP_PASS}@127.0.0.1:${(smtp.address() as { port: number }).port}`,
      NUXT_NOTIFY_MAIL_FROM: 'evac-layer@example.org',
      NUXT_NOTIFY_MAIL_TO: 'ops1@example.org, ops2@example.org',
      NUXT_NOTIFY_ADMIN_BASE_URL: 'https://ops.example.org/',
    }
  })
  after(async () => {
    await Promise.all(children.map(stop))
    slack.close()
    smtp.close()
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
  })

  async function serve(extra: Record<string, string>, dataDir: string) {
    const server = await startServer({ ...env, NUXT_DATA_DIR: dataDir, ...extra }, undefined, (text) => (output += text))
    children.push(server.child)
    return server
  }

  async function newData(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'evac-notify-'))
    roots.push(root)
    return makeData(root)
  }

  test('sends one notice per channel, keeps the addresses out of logs, files and answers, and does not send again after a restart', async () => {
    slackBodies.length = 0
    mails.length = 0
    slackFailures = 1
    const dataDir = await newData()
    let { base, child } = await serve({ NUXT_NOTIFY_REMIND_MINUTES: '0' }, dataDir)
    assert.match(output, /\[notify\] channels: slack, mail/)

    await until('a Slack notice', () => slackBodies.length >= 1)
    await until('a mail notice', () => mails.length >= 1)
    assert.equal(slackPaths.at(-1), `/services/${SLACK_SECRET}`)
    const payload = JSON.parse(slackBodies[0]!)
    for (const part of [SITE, BULLETIN, TITLE, 'unapproved', 'https://ops.example.org/admin']) assert.ok(payload.text.includes(part), part)
    assert.ok(!payload.text.includes('<!channel>'))
    assert.ok(!payload.text.includes('<https://example.com|x>'))
    assert.ok(!/\n(承認済み|Bcc)/.test(payload.text))

    const mail = mails[0]!
    assert.deepEqual(mail.to.sort(), ['ops1@example.org', 'ops2@example.org'])
    assert.equal(mail.from, 'evac-layer@example.org')
    const { headers, body } = parseMail(mail.raw)
    assert.equal(headers.bcc, undefined)
    const subject = decodeWords(headers.subject!)
    assert.ok(subject.includes(SITE), subject)
    assert.ok(!/[\r\n]/.test(subject))
    for (const part of [SITE, BULLETIN, 'unapproved', 'Site']) assert.ok(body.includes(part), part)
    assert.ok(!/\n(承認済み|Bcc)/.test(body))
    assert.ok(Buffer.from(mail.auth ?? '', 'base64').toString('utf8').includes(SMTP_USER), 'the credentials in the SMTP URL are used')

    await pause(TICKS_MS)
    assert.equal(slackBodies.length, 1)
    assert.equal(mails.length, 1)

    await stop(child)
    ;({ base, child } = await serve({ NUXT_NOTIFY_REMIND_MINUTES: '0' }, dataDir))
    await pause(TICKS_MS)
    assert.equal(slackBodies.length, 1, 'a restart does not send the notice again')
    assert.equal(mails.length, 1)

    const answers = await Promise.all([`/api/admin/sites/${SITE}`, '/api/admin/sites', `/api/feed/${SITE}`, '/api/admin/subscriptions', '/admin'].map(async (path) => (await fetch(`${base}${path}`)).text()))
    const files = await filesUnder(dataDir)
    for (const secret of [SLACK_SECRET, SMTP_USER, SMTP_PASS]) {
      assert.ok(!output.includes(secret), `the log carries ${secret}`)
      assert.ok(!files.some((file) => file.includes(secret)), `data/ carries ${secret}`)
      assert.ok(!answers.some((answer) => answer.includes(secret)), `an answer carries ${secret}`)
    }

    const record = join(dataDir, 'live', `${SITE}.notify.json`)
    assert.ok(existsSync(record))
    assert.equal((await fetch(`${base}/api/admin/sites/${SITE}`, { method: 'DELETE' })).status, 204)
    assert.ok(!existsSync(record), 'deleting the site removes what was sent for it')
  })

  test('reminds at the interval while the bulletin waits, and stops once it is approved', async () => {
    slackBodies.length = 0
    mails.length = 0
    const dataDir = await newData()
    const { base } = await serve({ NUXT_NOTIFY_REMIND_MINUTES: '0.05' }, dataDir)

    await until('a reminder on Slack', () => slackBodies.length >= 2)
    await until('a reminder by mail', () => mails.length >= 2)
    const reminder = JSON.parse(slackBodies[1]!).text as string
    assert.match(reminder, /2 回目/)
    assert.match(reminder, /notice 2/)

    assert.equal((await postJson(base, '/api/admin/site', { site_id: SITE, auto_publish: true })).status, 200)
    assert.equal((await postJson(base, '/api/admin/approve', { site_id: SITE, bulletin_id: BULLETIN, approved: true })).status, 200)
    assert.equal((await (await fetch(`${base}/api/feed/${SITE}`)).json()).state, 'alert')
    await pause(3000)
    const sent = { slack: slackBodies.length, mail: mails.length }
    await pause(TICKS_MS)
    assert.deepEqual({ slack: slackBodies.length, mail: mails.length }, sent)
  })

  test('without a complete setting nothing is sent and nothing is connected to', async () => {
    slackBodies.length = 0
    slackPaths.length = 0
    mails.length = 0
    smtpConnections.count = 0
    output = ''
    const dataDir = await newData()
    await serve(
      { NUXT_NOTIFY_ALLOW_HTTP: '', NUXT_NOTIFY_MAIL_FROM: '', NUXT_NOTIFY_MAIL_TO: '', NUXT_NOTIFY_REMIND_MINUTES: '0.05' },
      dataDir,
    )
    await pause(TICKS_MS)
    assert.match(output, /\[notify\] channels: none/)
    assert.match(output, /slack is off/)
    assert.match(output, /mail is off/)
    assert.equal(slackPaths.length, 0)
    assert.equal(smtpConnections.count, 0)
    assert.ok(!existsSync(join(dataDir, 'live', `${SITE}.notify.json`)))
    for (const secret of [SLACK_SECRET, SMTP_USER, SMTP_PASS]) assert.ok(!output.includes(secret))
  })
})
