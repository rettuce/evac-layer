import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { Approvals } from '../layout/gate.ts'
import { type NoticeFacts, mailMessage, slackMessage } from '../layout/notice.ts'
import { REASON_CHANGE_MIN_MS, noticeDue } from '../layout/noticeSchedule.ts'
import { CHECK_FAILED_WINDOW_MS, type IndexRow, type ScreensRead, pendingReason, pendingSubject } from '../layout/pending.ts'
import { smtpTransportOptions } from '../layout/smtpOptions.ts'

const SITE = 'notify-site'
const MUNICIPALITY = '00004'
const BULLETIN = 'TEST-NOTIFY-1'
const TITLE = '津波警報・注意報・予報a'
const AT = '2026-11-10T00:00:00.000Z'
const HOSTILE_NAME = '駅<!channel> <https://example.com|x>\n承認済み & ok\r\nBcc: victim@example.org'
const RLO = String.fromCodePoint(0x202e)
const ZWSP = String.fromCodePoint(0x200b)
const MINUTE = 60000

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
    const { text } = slackMessage(facts({ count: 3, showing: { bulletin_id: 'OLDER', title: '前の警報' } }), NOW + 30 * MINUTE)
    assert.match(text, /3 回目/)
    assert.match(text, /30 分/)
    assert.match(text, /notice 3/)
    assert.match(text, /30 min/)
    assert.ok(text.includes('OLDER'))
    assert.match(mailMessage(facts({ count: 3 }), NOW).subject, /3/)
  })

  test('a notice sent because the reason changed names the reason before and after', () => {
    const changed = facts({ count: 2, reason: 'auto-publish-off', previous_reason: 'unapproved' })
    for (const { text } of [slackMessage(changed, NOW), mailMessage(changed, NOW)]) {
      assert.ok(text.includes('unapproved → auto-publish-off'), text)
      assert.match(text, /理由が変わりました/)
      assert.match(text, /reason changed/i)
    }
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

  test('a URL in a registered name is shown broken, so Slack does not link it; the admin URL stays a link', () => {
    const named = facts({ site: { id: SITE, name: '駅 https://example.com/x と http://evil.example/y', municipality_id: MUNICIPALITY }, admin_url: 'https://ops.example.org/admin' })
    const { text } = slackMessage(named, NOW)
    const links = text.match(/https?:\/\/\S+/g) ?? []
    assert.deepEqual(links.map((link) => link.replace(/>$/, '')), ['https://ops.example.org/admin', 'https://ops.example.org/admin'])
    assert.ok(text.includes('example.com/x'), 'the rest of the name is kept')
    const mail = mailMessage(named, NOW)
    assert.deepEqual(mail.text.match(/https?:\/\/\S+/g), ['https://ops.example.org/admin', 'https://ops.example.org/admin'])
    assert.ok(!/https?:\/\//.test(mail.subject))
  })

  test('direction and zero-width characters are removed and a long name is cut between characters', () => {
    const name = `駅${RLO}evil${ZWSP}name`
    for (const out of [slackMessage(facts({ site: { id: SITE, name, municipality_id: MUNICIPALITY } }), NOW).text, mailMessage(facts({ site: { id: SITE, name, municipality_id: MUNICIPALITY } }), NOW).subject]) {
      assert.ok(!out.includes(RLO) && !out.includes(ZWSP))
      assert.ok(out.includes('駅evilname'))
    }
    for (let length = 195; length < 205; length++) {
      const long = `${'a'.repeat(length)}${'😀'.repeat(20)}`
      const { text } = slackMessage(facts({ site: { id: SITE, name: long, municipality_id: MUNICIPALITY } }), NOW)
      assert.ok(text.isWellFormed(), `cut at ${length}`)
    }
  })
})

describe('when a channel sends', () => {
  const REMIND = 15 * MINUTE

  test('the first notice at once, and a reminder each interval', () => {
    assert.deepEqual(noticeDue({ sent: undefined, reason: 'unapproved', now: NOW, remindMs: 0 }), { count: 1 })
    const sent = { count: 1, lastSentMs: NOW, reason: 'unapproved' as const }
    assert.equal(noticeDue({ sent, reason: 'unapproved', now: NOW + REMIND - 1, remindMs: REMIND }), undefined)
    assert.deepEqual(noticeDue({ sent, reason: 'unapproved', now: NOW + REMIND, remindMs: REMIND }), { count: 2 })
    assert.equal(noticeDue({ sent, reason: 'unapproved', now: NOW + 10 * REMIND, remindMs: 0 }), undefined, '0 sends no reminder')
  })

  test('a changed reason at once, but not sooner than the minimum after the last notice, and not when it changed back', () => {
    const sent = { count: 1, lastSentMs: NOW, reason: 'unapproved' as const }
    assert.equal(noticeDue({ sent, reason: 'auto-publish-off', now: NOW + REASON_CHANGE_MIN_MS - 1, remindMs: 0 }), undefined)
    assert.deepEqual(noticeDue({ sent, reason: 'auto-publish-off', now: NOW + REASON_CHANGE_MIN_MS, remindMs: 0 }), { count: 2, previous_reason: 'unapproved' })
    assert.equal(noticeDue({ sent, reason: 'unapproved', now: NOW + 5 * REASON_CHANGE_MIN_MS, remindMs: 0 }), undefined)
    assert.ok(REASON_CHANGE_MIN_MS >= MINUTE)
  })

  test('a last time that cannot be read or lies in the future sends rather than staying silent', () => {
    assert.deepEqual(noticeDue({ sent: { count: 2, lastSentMs: Number.NaN, reason: 'unapproved' }, reason: 'unapproved', now: NOW, remindMs: REMIND }), { count: 3 })
    assert.deepEqual(noticeDue({ sent: { count: 2, lastSentMs: NOW + 3600000, reason: 'unapproved' }, reason: 'unapproved', now: NOW, remindMs: REMIND }), { count: 3 })
    assert.deepEqual(noticeDue({ sent: { count: 2, lastSentMs: undefined, reason: 'unapproved' }, reason: 'unapproved', now: NOW, remindMs: REMIND }), { count: 3 })
  })
})

describe('SMTP transport options', () => {
  const options = (url: string, allowPlaintext = false) => {
    const setting = smtpTransportOptions(url, allowPlaintext)
    assert.ok(setting.ok, `${url} is refused: ${setting.ok ? '' : setting.problem}`)
    return setting.options
  }

  test('credentials, or a server off this machine, need STARTTLS', () => {
    for (const url of ['smtp://user:pass@127.0.0.1:2525', 'smtp://user@localhost', 'smtp://mail.example.org:587', 'smtp://10.0.0.5', 'smtp://127.1']) {
      const set = options(url)
      assert.equal(set.requireTLS, true, url)
      assert.equal(set.secure, false, url)
    }
  })

  test('a relay on this machine without credentials may stay in plaintext', () => {
    for (const url of ['smtp://127.0.0.1:25', 'smtp://localhost:25', 'smtp://LOCALHOST', 'smtp://[::1]:25', 'smtp://127.0.0.53']) assert.equal(options(url).requireTLS, false, url)
  })

  test('smtps is TLS from the start, and certificates are always checked', () => {
    const set = options('smtps://user:pass@mail.example.org')
    assert.equal(set.secure, true)
    for (const url of ['smtps://mail.example.org', 'smtp://127.0.0.1', 'smtp://u:p@mail.example.org']) assert.deepEqual(options(url).tls, { rejectUnauthorized: true })
  })

  test('a URL with a query is refused, because nodemailer lets its query loosen TLS', () => {
    for (const url of ['smtp://mail.example.org?tls.rejectUnauthorized=false', 'smtp://u:p@mail.example.org/?ignoreTLS=true', 'smtps://mail.example.org?secure=false']) {
      const setting = smtpTransportOptions(url, false)
      assert.equal(setting.ok, false, url)
      assert.equal(setting.ok ? '' : setting.problem, 'query')
    }
    const other = smtpTransportOptions('http://mail.example.org', false)
    assert.equal(other.ok ? '' : other.problem, 'protocol')
  })

  test('the test switch lets credentials go in plaintext', () => {
    assert.equal(options('smtp://user:pass@127.0.0.1:2525', true).requireTLS, false)
  })
})
