import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, existsSync } from 'node:fs'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, afterEach, before, describe, test } from 'node:test'
import { SERVER_ENTRY, postJson, startServer } from './helpers.ts'
import { type SmtpMessage, decodeWords, filesUnder, parseMail, pause, smtpReceiver, stop, until, writeSite } from './notify-helpers.ts'

const SITE = 'notify-site'
const BULLETIN = 'TEST-NOTIFY-1'
const TITLE = '津波警報・注意報・予報a'
const HOSTILE_NAME = '駅<!channel> <https://example.com|x>\n承認済み & ok\r\nBcc: victim@example.org'
const SLACK_SECRET = 'slack-secret-path-7f3a'
const SMTP_USER = 'smtp-user-9c1d'
const SMTP_PASS = 'smtp-pass-4e8b'
const SECRETS = [SLACK_SECRET, SMTP_USER, SMTP_PASS]
const TICKS_MS = 7000
const OPERATOR = 'operator-token-0123456789abcdef'
const FACILITY_A = 'facility-a-token-0123456789abcdef'
const FACILITY_B = 'facility-b-token-0123456789abcdef'

const skip = !existsSync(SERVER_ENTRY) && 'run `pnpm -F app build` first'

type SlackMode = 'ok' | 'fail-once' | 'fail-always' | 'lock-records'

describe('operator notices through the server', { skip }, () => {
  const slackBodies: string[] = []
  const slackRequests: string[] = []
  let slackMode: SlackMode = 'ok'
  let lockDir = ''
  const mails: SmtpMessage[] = []
  const smtpSeen = { connections: 0, commands: [] as string[] }
  const slack = createHttpServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      slackRequests.push(req.url ?? '')
      if (slackMode === 'fail-always' || slackMode === 'fail-once') {
        if (slackMode === 'fail-once') slackMode = 'ok'
        res.writeHead(500).end('busy')
        return
      }
      if (slackMode === 'lock-records') chmodSync(lockDir, 0o555)
      slackBodies.push(body)
      res.writeHead(200).end('ok')
    })
  })
  const smtp = smtpReceiver(mails, smtpSeen)
  const children: ChildProcess[] = []
  const roots: string[] = []
  let output = ''
  let slackUrl = ''
  let mailEnv: Record<string, string> = {}

  before(async () => {
    await new Promise<void>((resolve) => slack.listen(0, '127.0.0.1', resolve))
    await new Promise<void>((resolve) => smtp.listen(0, '127.0.0.1', resolve))
    slackUrl = `http://127.0.0.1:${(slack.address() as { port: number }).port}/services/${SLACK_SECRET}`
    mailEnv = {
      NUXT_NOTIFY_SMTP_URL: `smtp://${SMTP_USER}:${SMTP_PASS}@127.0.0.1:${(smtp.address() as { port: number }).port}`,
      NUXT_NOTIFY_MAIL_FROM: 'evac-layer@example.org',
      NUXT_NOTIFY_MAIL_TO: 'ops1@example.org, ops2@example.org',
    }
  })
  afterEach(() => Promise.all(children.splice(0).map(stop)))
  after(async () => {
    slack.close()
    smtp.close()
    if (lockDir) await chmod(lockDir, 0o755).catch(() => undefined)
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
  })

  function reset(mode: SlackMode = 'ok') {
    slackBodies.length = 0
    slackRequests.length = 0
    mails.length = 0
    smtpSeen.connections = 0
    smtpSeen.commands.length = 0
    slackMode = mode
    output = ''
  }

  async function serve(env: Record<string, string>, dataDir: string) {
    const server = await startServer({ NUXT_ADMIN_TOKEN: '', NUXT_DATA_DIR: dataDir, ...env }, undefined, (text) => (output += text))
    children.push(server.child)
    return server
  }

  async function newDataDir(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'evac-notify-'))
    roots.push(root)
    return join(root, 'data')
  }

  const notices = () => slackBodies.map((body) => JSON.parse(body).text as string)
  const plaintext = { NUXT_NOTIFY_SLACK_WEBHOOK_URL: '', NUXT_NOTIFY_ALLOW_PLAINTEXT: '1' }

  test('sends one notice per channel, not again after a restart, again at once when an approval is withdrawn, and keeps the addresses out of logs, files and answers', async () => {
    reset('fail-once')
    const dataDir = await newDataDir()
    await writeSite(dataDir, { id: SITE, name: HOSTILE_NAME })
    const env = { ...plaintext, ...mailEnv, NUXT_NOTIFY_SLACK_WEBHOOK_URL: slackUrl, NUXT_NOTIFY_ADMIN_BASE_URL: 'https://ops.example.org/', NUXT_NOTIFY_REMIND_MINUTES: '0' }
    let { base, child } = await serve(env, dataDir)
    assert.match(output, /\[notify\] channels: slack, mail/)

    await until('a Slack notice', () => slackBodies.length >= 1)
    await until('a mail notice', () => mails.length >= 1)
    assert.equal(slackRequests.at(-1), `/services/${SLACK_SECRET}`)
    const text = notices()[0]!
    for (const part of [SITE, BULLETIN, TITLE, 'unapproved', 'https://ops.example.org/admin']) assert.ok(text.includes(part), part)
    assert.ok(!text.includes('<!channel>'))
    assert.ok(!text.includes('<https://example.com|x>'))
    assert.ok(!/\n(承認済み|Bcc)/.test(text))

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
    assert.deepEqual([slackBodies.length, mails.length], [1, 1])

    await stop(child)
    ;({ base, child } = await serve(env, dataDir))
    await pause(TICKS_MS)
    assert.deepEqual([slackBodies.length, mails.length], [1, 1], 'a restart does not send the notice again')

    assert.equal((await postJson(base, '/api/admin/site', { site_id: SITE, auto_publish: true })).status, 200)
    assert.equal((await postJson(base, '/api/admin/approve', { site_id: SITE, bulletin_id: BULLETIN, approved: true })).status, 200)
    await pause(TICKS_MS)
    assert.deepEqual([slackBodies.length, mails.length], [1, 1])
    assert.equal((await postJson(base, '/api/admin/approve', { site_id: SITE, bulletin_id: BULLETIN, approved: false })).status, 200)
    await until('a notice after the approval was withdrawn', () => slackBodies.length >= 2 && mails.length >= 2, 8000)
    const again = notices()[1]!
    assert.ok(again.includes('unapproved') && !again.includes('回目'), 'it is a first notice of a new state')

    const answers = await Promise.all([`/api/admin/sites/${SITE}`, '/api/admin/sites', `/api/feed/${SITE}`, '/api/admin/subscriptions', '/admin'].map(async (path) => (await fetch(`${base}${path}`)).text()))
    const files = await filesUnder(dataDir)
    for (const secret of SECRETS) {
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
    reset()
    const dataDir = await newDataDir()
    await writeSite(dataDir, { id: SITE, name: '駅' })
    const { base } = await serve({ ...plaintext, ...mailEnv, NUXT_NOTIFY_SLACK_WEBHOOK_URL: slackUrl, NUXT_NOTIFY_REMIND_MINUTES: '0.05' }, dataDir)

    await until('a reminder on Slack', () => slackBodies.length >= 2)
    await until('a reminder by mail', () => mails.length >= 2)
    assert.match(notices()[1]!, /2 回目/)
    assert.match(notices()[1]!, /notice 2/)

    assert.equal((await postJson(base, '/api/admin/site', { site_id: SITE, auto_publish: true })).status, 200)
    assert.equal((await postJson(base, '/api/admin/approve', { site_id: SITE, bulletin_id: BULLETIN, approved: true })).status, 200)
    assert.equal((await (await fetch(`${base}/api/feed/${SITE}`)).json()).state, 'alert')
    await pause(3000)
    const sent = [slackBodies.length, mails.length]
    await pause(TICKS_MS)
    assert.deepEqual([slackBodies.length, mails.length], sent)
  })

  test('a notice that was sent but could not be recorded is not sent again', async () => {
    reset('lock-records')
    const dataDir = await newDataDir()
    await writeSite(dataDir, { id: SITE, name: '駅' })
    lockDir = join(dataDir, 'live')
    try {
      await serve({ ...plaintext, NUXT_NOTIFY_SLACK_WEBHOOK_URL: slackUrl, NUXT_NOTIFY_REMIND_MINUTES: '0' }, dataDir)
      await until('a Slack notice', () => slackBodies.length >= 1)
      await pause(TICKS_MS)
      assert.equal(slackBodies.length, 1)
      assert.match(output, /not recorded/)
    } finally {
      await chmod(lockDir, 0o755)
    }
  })

  test('screens or an index that cannot be read are notified, a site whose check fails does not stop the others, and a bulletin that failed its checks is notified', async () => {
    reset()
    const dataDir = await newDataDir()
    for (const id of ['broken-screens', 'broken-index', 'broken-live', 'fine-site']) await writeSite(dataDir, { id, name: id })
    await writeFile(join(dataDir, 'layouts', 'broken-screens', BULLETIN, '16x9.json'), '{"template": ')
    await writeFile(join(dataDir, 'layouts', 'broken-index', 'index.json'), '{"entries": [')
    await writeFile(join(dataDir, 'live', 'broken-live.json'), '{"bulletin_id": ')
    const failedRow = { issued_at: new Date(Date.now() - 3600000).toISOString(), bulletin_id: BULLETIN, raw_title: TITLE, municipality_level: 3, screen: false, template: 'evac-now', display_level: 3, outcome: 'fail' }
    await writeSite(dataDir, { id: 'failed-check', name: 'failed-check', live: null, rows: [failedRow] })
    await serve({ ...plaintext, NUXT_NOTIFY_SLACK_WEBHOOK_URL: slackUrl, NUXT_NOTIFY_REMIND_MINUTES: '0' }, dataDir)

    const reasonOf = (id: string) => {
      const text = notices().find((notice) => notice.includes(`(\`${id}\`)`))
      return text && /理由: (\S+)/.exec(text)?.[1]
    }
    await until('four notices', () => ['broken-screens', 'broken-index', 'fine-site', 'failed-check'].every((id) => reasonOf(id) !== undefined))
    assert.equal(reasonOf('broken-screens'), 'screens-unreadable')
    assert.equal(reasonOf('broken-index'), 'screens-unreadable')
    assert.equal(reasonOf('fine-site'), 'unapproved')
    assert.equal(reasonOf('failed-check'), 'check-failed')
    assert.match(notices().find((notice) => notice.includes('(`broken-index`)'))!, /警戒レベル: 不明/)
    assert.equal(reasonOf('broken-live'), undefined)
    assert.match(output, /broken-live/)
  })

  test('a Slack that keeps failing is tried four times, then left alone for a while', async () => {
    reset('fail-always')
    const dataDir = await newDataDir()
    await writeSite(dataDir, { id: SITE, name: '駅' })
    await serve({ ...plaintext, NUXT_NOTIFY_SLACK_WEBHOOK_URL: slackUrl, NUXT_NOTIFY_REMIND_MINUTES: '0' }, dataDir)
    await until('four attempts', () => slackRequests.length >= 4, 35000)
    await pause(TICKS_MS)
    assert.equal(slackRequests.length, 4)
    assert.match(output, /slack notice for notify-site TEST-NOTIFY-1 not sent after 4 attempts: HTTP_500/)
    assert.ok(!output.includes(SLACK_SECRET))
  })

  test('facilities read neither settings nor records, and a site registered again by another facility starts over', async () => {
    reset()
    const dataDir = await newDataDir()
    await writeSite(dataDir, { id: 'shared-hall', name: 'A の駅', facility_id: 'alpha-fac' })
    const sha256 = (token: string) => createHash('sha256').update(token).digest('hex')
    const record = (token: string, facility_id: string) => ({ id: randomUUID().slice(0, 8), label: facility_id, facility_id, sha256: sha256(token), created_at: '2026-11-01T00:00:00Z' })
    await writeFile(join(dataDir, 'tokens.json'), JSON.stringify({ version: '0.1', tokens: [record(FACILITY_A, 'alpha-fac'), record(FACILITY_B, 'beta-fac')] }), { mode: 0o600 })
    const { base } = await serve({ ...plaintext, ...mailEnv, NUXT_ADMIN_TOKEN: OPERATOR, NUXT_NOTIFY_SLACK_WEBHOOK_URL: slackUrl, NUXT_NOTIFY_REMIND_MINUTES: '0' }, dataDir)
    const as = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' })

    await until('a notice for the first owner', () => slackBodies.length >= 1)
    assert.ok(notices()[0]!.includes('A の駅'))
    for (const path of ['/api/admin/sites', '/api/admin/sites/shared-hall', '/api/admin/catalog?site=shared-hall']) {
      const answer = await fetch(`${base}${path}`, { headers: as(FACILITY_A) })
      assert.equal(answer.status, 200, path)
      const body = await answer.text()
      for (const leak of [...SECRETS, 'notify', 'first_seen_at', 'last_sent_at', 'ops1@example.org']) assert.ok(!body.includes(leak), `${path} carries ${leak}`)
    }

    assert.equal((await fetch(`${base}/api/admin/sites/shared-hall`, { method: 'DELETE', headers: as(OPERATOR) })).status, 204)
    const registered = await fetch(`${base}/api/admin/sites/shared-hall`, { method: 'PUT', headers: as(FACILITY_B), body: JSON.stringify({ lat: 35, lng: 139, municipality_id: '00004', name: 'B の駅' }) })
    assert.equal(registered.status, 201)
    await writeSite(dataDir, { id: 'shared-hall', name: 'B の駅', facility_id: 'beta-fac' })
    await until('a notice for the new owner', () => notices().some((notice) => notice.includes('B の駅')))
    await until('the mail of the same notice, before the next test counts connections', () => mails.some((mail) => parseMail(mail.raw).body.includes('B の駅')))
    const fresh = notices().find((notice) => notice.includes('B の駅'))!
    assert.ok(!fresh.includes('回目') && !fresh.includes('A の駅'), fresh)
  })

  test('without complete settings nothing is sent or connected to; plain http Slack and plaintext credentials are refused by default', async () => {
    reset()
    const dataDir = await newDataDir()
    await writeSite(dataDir, { id: SITE, name: '駅' })
    await serve({ NUXT_NOTIFY_SMTP_URL: mailEnv.NUXT_NOTIFY_SMTP_URL!, NUXT_NOTIFY_REMIND_MINUTES: '0.05' }, dataDir)
    await pause(TICKS_MS)
    assert.match(output, /\[notify\] channels: none/)
    assert.match(output, /mail is off/)
    assert.equal(smtpSeen.connections, 0)
    assert.ok(!existsSync(join(dataDir, 'live', `${SITE}.notify.json`)))

    reset()
    const secondDir = await newDataDir()
    await writeSite(secondDir, { id: SITE, name: '駅' })
    await serve({ ...mailEnv, NUXT_NOTIFY_SLACK_WEBHOOK_URL: slackUrl, NUXT_NOTIFY_REMIND_MINUTES: '0' }, secondDir)
    assert.match(output, /slack is off: NUXT_NOTIFY_SLACK_WEBHOOK_URL must be an https URL/)
    assert.match(output, /\[notify\] channels: mail\n/)
    await until('the mail server asked for STARTTLS', () => smtpSeen.commands.includes('STARTTLS'))
    await pause(3000)
    assert.equal(slackRequests.length, 0)
    assert.ok(!smtpSeen.commands.includes('AUTH'), 'no credentials in plaintext')
    assert.equal(mails.length, 0)
    for (const secret of SECRETS) assert.ok(!output.includes(secret))
  })
})
