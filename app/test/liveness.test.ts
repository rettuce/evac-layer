import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { feedActivity, receiversNoticeDue, stoppedReceivers } from '../layout/liveness.ts'
import { type FeedIdleFacts, type ReceiverStoppedFacts, feedIdleMessage, receiverStoppedMessage } from '../layout/livenessNotice.ts'
import { REASON_CHANGE_MIN_MS } from '../layout/noticeSchedule.ts'

const MINUTE = 60000
const NOW = Date.parse('2026-11-11T03:00:00.000Z')
const HOSTILE_NAME = '駅<!channel> <https://example.com|x>\n承認済み & ok\r\nBcc: victim@example.org'
const iso = (ms: number) => new Date(ms).toISOString()

describe('which receivers have stopped', () => {
  test('a site whose last successful receive is older than the threshold is listed, oldest first', () => {
    const stopped = stoppedReceivers(
      [
        { site: 'fresh', received_at: iso(NOW - 2 * MINUTE) },
        { site: 'late', received_at: iso(NOW - 20 * MINUTE) },
        { site: 'later', received_at: iso(NOW - 60 * MINUTE) },
      ],
      NOW,
      15 * MINUTE,
    )
    assert.deepEqual(stopped.map((entry) => entry.site), ['later', 'late'])
    assert.equal(stopped[0]!.received_at, iso(NOW - 60 * MINUTE))
  })

  test('a site without a record, with a record that cannot be read, or with one in the future is not listed', () => {
    const stopped = stoppedReceivers(
      [
        { site: 'never', received_at: undefined },
        { site: 'garbled', received_at: 'yesterday' },
        { site: 'number', received_at: 12 },
        { site: 'ahead', received_at: iso(NOW + 60 * MINUTE) },
      ],
      NOW,
      15 * MINUTE,
    )
    assert.deepEqual(stopped, [])
  })
})

describe('whether a site screen still polls its feed', () => {
  const THRESHOLD = 5 * MINUTE
  const started = NOW - 60 * MINUTE

  test('a site that never polled is not watched', () => {
    assert.equal(feedActivity({ lastSeenMs: undefined, startedMs: started, now: NOW, thresholdMs: THRESHOLD }), undefined)
  })

  test('a poll within the threshold is active, an older one is idle', () => {
    assert.equal(feedActivity({ lastSeenMs: NOW - THRESHOLD + 1, startedMs: started, now: NOW, thresholdMs: THRESHOLD }), 'active')
    assert.equal(feedActivity({ lastSeenMs: NOW - THRESHOLD, startedMs: started, now: NOW, thresholdMs: THRESHOLD }), 'idle')
  })

  test('right after a start, a poll from before it is neither active nor idle until the threshold has passed since the start', () => {
    const justStarted = NOW - 2 * MINUTE
    assert.equal(feedActivity({ lastSeenMs: NOW - 60 * MINUTE, startedMs: justStarted, now: NOW, thresholdMs: THRESHOLD }), 'unsure')
    assert.equal(feedActivity({ lastSeenMs: NOW - 60 * MINUTE, startedMs: justStarted, now: justStarted + THRESHOLD, thresholdMs: THRESHOLD }), 'idle')
  })
})

describe('when the receiver notice is due', () => {
  const REMIND = 15 * MINUTE
  const sent = { count: 1, lastSentMs: NOW, reason: 'site-a' }

  test('the first notice at once, then a reminder each interval', () => {
    assert.deepEqual(receiversNoticeDue({ sent: undefined, sites: ['site-a'], now: NOW, remindMs: REMIND }), { count: 1 })
    assert.equal(receiversNoticeDue({ sent, sites: ['site-a'], now: NOW + REMIND - 1, remindMs: REMIND }), undefined)
    assert.deepEqual(receiversNoticeDue({ sent, sites: ['site-a'], now: NOW + REMIND, remindMs: REMIND }), { count: 2 })
    assert.equal(receiversNoticeDue({ sent, sites: ['site-a'], now: NOW + 10 * REMIND, remindMs: 0 }), undefined)
  })

  test('another site that stops is notified at once, but not sooner than the minimum; one that comes back is not', () => {
    assert.equal(receiversNoticeDue({ sent, sites: ['site-a', 'site-b'], now: NOW + REASON_CHANGE_MIN_MS - 1, remindMs: 0 }), undefined)
    assert.deepEqual(receiversNoticeDue({ sent, sites: ['site-a', 'site-b'], now: NOW + REASON_CHANGE_MIN_MS, remindMs: 0 }), { count: 2 })
    const both = { ...sent, reason: 'site-a site-b' }
    assert.equal(receiversNoticeDue({ sent: both, sites: ['site-b'], now: NOW + 5 * REASON_CHANGE_MIN_MS, remindMs: 0 }), undefined)
  })
})

const receiverFacts = (over: Partial<ReceiverStoppedFacts> = {}): ReceiverStoppedFacts => ({
  sites: [
    { id: 'site-a', name: HOSTILE_NAME, municipality_id: '00004', municipality_name: '通知市', received_at: iso(NOW - 40 * MINUTE) },
    { id: 'site-b', municipality_id: '00005', received_at: iso(NOW - 20 * MINUTE) },
  ],
  threshold_minutes: 15,
  count: 1,
  first_seen_at: iso(NOW),
  ...over,
})

describe('receiver notice text', () => {
  test('one notice lists every stopped site with its municipality and last receive, in Japanese and English', () => {
    const { slack, mail } = receiverStoppedMessage(receiverFacts({ admin_url: 'https://ops.example.org/admin' }), NOW)
    for (const text of [slack.text, mail.text]) {
      for (const part of ['site-a', 'site-b', '通知市', '00004', '00005', iso(NOW - 40 * MINUTE), '40', '受信', 'receiv', 'https://ops.example.org/admin']) assert.ok(text.includes(part), `${part}: ${text}`)
    }
    assert.match(mail.subject, /2/)
    assert.ok(!/[\r\n]/.test(mail.subject))
  })

  test('a reminder says which notice it is', () => {
    const { slack, mail } = receiverStoppedMessage(receiverFacts({ count: 3 }), NOW + 30 * MINUTE)
    assert.match(slack.text, /3 回目/)
    assert.match(slack.text, /notice 3/)
    assert.match(mail.subject, /3/)
  })

  test('names a facility registered cannot mention, link or add lines', () => {
    const { slack, mail } = receiverStoppedMessage(receiverFacts(), NOW)
    assert.ok(!slack.text.includes('<!channel>'))
    assert.ok(!slack.text.includes('<https://example.com|x>'))
    assert.ok(slack.text.includes('&lt;!channel&gt;'))
    assert.ok(!/\n(承認済み|Bcc)/.test(slack.text))
    assert.ok(!/\n(承認済み|Bcc)/.test(mail.text))
    assert.ok(mail.text.includes('example[.]com'))
    assert.deepEqual([slack.parse, slack.unfurl_links, slack.unfurl_media], ['none', false, false])
  })
})

const idleFacts = (over: Partial<FeedIdleFacts> = {}): FeedIdleFacts => ({
  site: { id: 'idle-site', name: HOSTILE_NAME, municipality_id: '00004', municipality_name: '通知市' },
  last_request_at: iso(NOW - 12 * MINUTE),
  expected: { state: 'ambient' },
  count: 1,
  first_seen_at: iso(NOW),
  ...over,
})

describe('feed idle notice text', () => {
  test('names the site, when it last polled, how long ago and what it should show, in Japanese and English', () => {
    const { slack, mail } = feedIdleMessage(idleFacts({ admin_url: 'https://ops.example.org/admin' }), NOW)
    for (const text of [slack.text, mail.text]) {
      for (const part of ['idle-site', '通知市', iso(NOW - 12 * MINUTE), '12 分', '12 min', '平常', 'ambient', 'https://ops.example.org/admin']) assert.ok(text.includes(part), `${part}: ${text}`)
    }
    assert.ok(mail.subject.includes('idle-site'))
    assert.ok(!/[\r\n]/.test(mail.subject))
  })

  test('a site that should show a warning says so at the very start, in the text and the mail subject', () => {
    const expected = { state: 'alert' as const, bulletin_id: 'TEST-IDLE-1', level: 4, hazard: 'tsunami' }
    const { slack, mail } = feedIdleMessage(idleFacts({ expected }), NOW)
    assert.match(slack.text, /^【EVAC LAYER・警報中】/)
    assert.match(mail.text, /^【EVAC LAYER・警報中】/)
    assert.match(mail.subject, /^\[EVAC LAYER\] 警報中/)
    assert.ok(slack.text.includes('TEST-IDLE-1'))
    assert.ok(!feedIdleMessage(idleFacts(), NOW).slack.text.includes('警報中'))
    const reminder = feedIdleMessage(idleFacts({ expected, count: 2 }), NOW).slack.text
    assert.match(reminder, /^【EVAC LAYER・警報中】/)
    assert.match(reminder, /2 回目/)
  })

  test('a notice sent because what the site should show changed names it before and after', () => {
    const changed = idleFacts({ expected: { state: 'alert', bulletin_id: 'TEST-IDLE-1' }, previous_expected: 'ambient', count: 2 })
    const { slack } = feedIdleMessage(changed, NOW)
    assert.ok(slack.text.includes('ambient → alert'), slack.text)
  })

  test('what the site should show may be unknown', () => {
    const { slack } = feedIdleMessage(idleFacts({ expected: 'unknown' }), NOW)
    assert.match(slack.text, /不明/)
    assert.match(slack.text, /unknown/)
  })

  test('names a facility registered cannot mention, link or add lines', () => {
    const { slack, mail } = feedIdleMessage(idleFacts(), NOW)
    assert.ok(!slack.text.includes('<!channel>'))
    assert.ok(slack.text.includes('&lt;!channel&gt;'))
    assert.ok(!/\n(承認済み|Bcc)/.test(slack.text))
    assert.ok(!/\n(承認済み|Bcc)/.test(mail.text))
    assert.ok(!/[\r\n]/.test(mail.subject))
    assert.ok(mail.subject.includes('example[.]com'))
  })
})
