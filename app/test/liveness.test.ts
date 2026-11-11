import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { entriesReason, feedActivity, listNoticeDue, notedRequest, recordOutdated, resumesWithin, stoppedReceivers, stoppedTogether, withoutSite } from '../layout/liveness.ts'
import { type FeedIdleFacts, type ReceiverStoppedFacts, feedIdleMessage, receiverStoppedMessage } from '../layout/livenessNotice.ts'
import { REASON_CHANGE_MIN_MS } from '../layout/noticeSchedule.ts'

const MINUTE = 60000
const NOW = Date.parse('2026-11-11T03:00:00.000Z')
const HOSTILE_NAME = '駅<!channel> <https://example.com|x>\n承認済み & ok\r\nBcc: victim@example.org'
const iso = (ms: number) => new Date(ms).toISOString()

describe('which receivers have stopped', () => {
  test('a site whose last successful receive is older than the threshold is listed, oldest first', () => {
    const { stopped } = stoppedReceivers(
      [
        { site: 'fresh', received_at: iso(NOW - 2 * MINUTE) },
        { site: 'late', received_at: iso(NOW - 40 * MINUTE) },
        { site: 'later', received_at: iso(NOW - 90 * MINUTE) },
      ],
      NOW,
      30 * MINUTE,
    )
    assert.deepEqual(stopped.map((entry) => entry.site), ['later', 'late'])
  })

  test('a site without a record is left out silently; one that cannot be read or lies in the future is left out and named', () => {
    const scan = stoppedReceivers(
      [
        { site: 'never', received_at: undefined },
        { site: 'garbled', received_at: 'yesterday' },
        { site: 'number', received_at: 12 },
        { site: 'ahead', received_at: iso(NOW + 60 * MINUTE) },
      ],
      NOW,
      15 * MINUTE,
    )
    assert.deepEqual(scan, { stopped: [], unreadable: ['garbled', 'number'], future: ['ahead'] })
  })
})

describe('whether a site screen keeps polling', () => {
  const THRESHOLD = 5 * MINUTE

  test('requests closer than the threshold make one run; a longer gap starts a new one', () => {
    let run = notedRequest(undefined, NOW, THRESHOLD)
    run = notedRequest(run, NOW + MINUTE, THRESHOLD)
    assert.deepEqual(run, { firstMs: NOW, lastMs: NOW + MINUTE })
    assert.deepEqual(notedRequest(run, NOW + MINUTE + THRESHOLD, THRESHOLD), { firstMs: NOW + MINUTE + THRESHOLD, lastMs: NOW + MINUTE + THRESHOLD })
  })

  test('a site never requested, or requested for less than the threshold, is not watched', () => {
    assert.equal(feedActivity(undefined, NOW, THRESHOLD), undefined)
    assert.equal(feedActivity({ firstMs: NOW - 20 * MINUTE, lastMs: NOW - 20 * MINUTE }, NOW, THRESHOLD), undefined, 'one request by hand')
    assert.equal(feedActivity({ firstMs: NOW - 20 * MINUTE, lastMs: NOW - 16 * MINUTE }, NOW, THRESHOLD), undefined)
  })

  test('a run of the threshold or longer is active while it goes on and idle once it has stopped for the threshold', () => {
    const run = { firstMs: NOW - 30 * MINUTE, lastMs: NOW - THRESHOLD }
    assert.equal(feedActivity(run, NOW, THRESHOLD), 'idle')
    assert.equal(feedActivity(run, NOW - 1, THRESHOLD), 'active')
    assert.equal(feedActivity({ firstMs: NOW - MINUTE, lastMs: NOW }, NOW, THRESHOLD), 'active')
  })

  test('most of three or more watched sites stopping in one check is called out', () => {
    assert.equal(stoppedTogether(2, 3), true)
    assert.equal(stoppedTogether(2, 4), false)
    assert.equal(stoppedTogether(3, 4), true)
    assert.equal(stoppedTogether(2, 2), false)
  })
})

describe('when a list notice is due', () => {
  const REMIND = 15 * MINUTE
  const sent = (reason: string) => ({ count: 1, lastSentMs: NOW, reason })

  test('the first notice at once, then a reminder each interval', () => {
    assert.deepEqual(listNoticeDue({ sent: undefined, entries: [{ site: 'a' }], now: NOW, remindMs: REMIND }), { count: 1 })
    assert.equal(listNoticeDue({ sent: sent('a'), entries: [{ site: 'a' }], now: NOW + REMIND - 1, remindMs: REMIND }), undefined)
    assert.deepEqual(listNoticeDue({ sent: sent('a'), entries: [{ site: 'a' }], now: NOW + REMIND, remindMs: REMIND }), { count: 2 })
    assert.equal(listNoticeDue({ sent: sent('a'), entries: [{ site: 'a' }], now: NOW + 10 * REMIND, remindMs: 0 }), undefined)
  })

  test('a site that joins, or one that should now show a warning, is told at once but not sooner than the minimum', () => {
    const joined = [{ site: 'a' }, { site: 'b' }]
    assert.equal(listNoticeDue({ sent: sent('a'), entries: joined, now: NOW + REASON_CHANGE_MIN_MS - 1, remindMs: 0 }), undefined)
    assert.deepEqual(listNoticeDue({ sent: sent('a'), entries: joined, now: NOW + REASON_CHANGE_MIN_MS, remindMs: 0 }), { count: 2 })
    assert.deepEqual(listNoticeDue({ sent: sent('a b'), entries: [{ site: 'a', alert: true }, { site: 'b' }], now: NOW + REASON_CHANGE_MIN_MS, remindMs: 0 }), { count: 2 })
  })

  test('a site that leaves the list, or no longer should show a warning, is not told', () => {
    assert.equal(listNoticeDue({ sent: sent('a b!'), entries: [{ site: 'b' }], now: NOW + 5 * REASON_CHANGE_MIN_MS, remindMs: 0 }), undefined)
  })

  test('the reason names the sites, and a deleted site can be taken out of it', () => {
    const reason = entriesReason([{ site: 'a', alert: true }, { site: 'b' }])
    assert.equal(reason, 'a! b')
    assert.equal(withoutSite(reason, 'a'), 'b')
    assert.deepEqual(listNoticeDue({ sent: sent(withoutSite(reason, 'a')), entries: [{ site: 'a' }, { site: 'b' }], now: NOW + REASON_CHANGE_MIN_MS, remindMs: 0 }), { count: 2 })
  })

  test('a record whose last notice is three reminder intervals old (an hour without reminders) is over', () => {
    assert.equal(recordOutdated(NOW - 3 * REMIND, NOW, REMIND), false)
    assert.equal(recordOutdated(NOW - 3 * REMIND - 1, NOW, REMIND), true)
    assert.equal(recordOutdated(NOW - 60 * MINUTE - 1, NOW, 0), true)
    assert.equal(recordOutdated(NOW - 59 * MINUTE, NOW, 0), false)
  })

  test('a state that comes back within a reminder interval (15 minutes without reminders) is the same state', () => {
    assert.equal(resumesWithin(NOW - REMIND, NOW, REMIND), true)
    assert.equal(resumesWithin(NOW - REMIND - 1, NOW, REMIND), false)
    assert.equal(resumesWithin(NOW - 15 * MINUTE, NOW, 0), true)
    assert.equal(resumesWithin(NOW - 15 * MINUTE - 1, NOW, 0), false)
  })
})

const receiverFacts = (over: Partial<ReceiverStoppedFacts> = {}): ReceiverStoppedFacts => ({
  sites: [
    { id: 'site-a', name: HOSTILE_NAME, municipality_id: '00004', municipality_name: '通知市', received_at: iso(NOW - 40 * MINUTE) },
    { id: 'site-b', municipality_id: '00005', received_at: iso(NOW - 20 * MINUTE) },
  ],
  threshold_ms: 30 * MINUTE,
  count: 1,
  first_seen_at: iso(NOW),
  ...over,
})

describe('receiver notice text', () => {
  test('one notice lists every stopped site with its municipality and last receive, in Japanese and English', () => {
    const { slack, mail } = receiverStoppedMessage(receiverFacts({ admin_url: 'https://ops.example.org/admin' }), NOW)
    for (const text of [slack.text, mail.text]) {
      for (const part of ['site-a', 'site-b', '通知市', '00004', '00005', iso(NOW - 40 * MINUTE), '40 分前', '40 min ago', '30 分以上', 'https://ops.example.org/admin']) assert.ok(text.includes(part), `${part}: ${text}`)
    }
    assert.match(mail.subject, /2 施設/)
    assert.ok(!/[\r\n]/.test(mail.subject))
  })

  test('minutes are whole, and less than one reads as such', () => {
    const { slack } = receiverStoppedMessage(receiverFacts({ threshold_ms: 0.05 * MINUTE, sites: [{ id: 'site-a', municipality_id: '00004', received_at: iso(NOW - 0.5 * MINUTE) }] }), NOW)
    assert.ok(slack.text.includes('1 分未満以上') && slack.text.includes('1 分未満前') && slack.text.includes('less than 1 min'), slack.text)
    assert.ok(!/\d\.\d+ ?(分|min)/.test(slack.text), slack.text)
  })

  test('a reminder says which notice it is', () => {
    const { slack, mail } = receiverStoppedMessage(receiverFacts({ count: 3 }), NOW + 30 * MINUTE)
    assert.match(slack.text, /3 回目/)
    assert.match(slack.text, /notice 3/)
    assert.match(mail.subject, /3 回目/)
  })

  test('names a facility registered cannot mention, link or add lines', () => {
    const { slack, mail } = receiverStoppedMessage(receiverFacts(), NOW)
    assert.ok(!slack.text.includes('<!channel>'))
    assert.ok(slack.text.includes('&lt;!channel&gt;'))
    assert.ok(!/\n(承認済み|Bcc)/.test(slack.text))
    assert.ok(!/\n(承認済み|Bcc)/.test(mail.text))
    assert.ok(mail.text.includes('example[.]com'))
    assert.deepEqual([slack.parse, slack.unfurl_links, slack.unfurl_media], ['none', false, false])
  })
})

const calm = { id: 'calm-site', name: HOSTILE_NAME, municipality_id: '00004', municipality_name: '通知市', last_request_at: iso(NOW - 12 * MINUTE), expected: { state: 'ambient' as const } }
const warning = { id: 'alert-site', municipality_id: '00005', last_request_at: iso(NOW - 8 * MINUTE), expected: { state: 'alert' as const, bulletin_id: 'TEST-IDLE-1', level: 4 } }
const idleFacts = (over: Partial<FeedIdleFacts> = {}): FeedIdleFacts => ({ sites: [calm], together: false, threshold_ms: 5 * MINUTE, count: 1, first_seen_at: iso(NOW), ...over })

describe('feed idle notice text', () => {
  test('one notice lists each site with its last request, how long ago and what it should show, in Japanese and English', () => {
    const { slack, mail } = feedIdleMessage(idleFacts({ admin_url: 'https://ops.example.org/admin' }), NOW)
    for (const text of [slack.text, mail.text]) {
      for (const part of ['calm-site', '通知市', iso(NOW - 12 * MINUTE), '12 分前', '12 min ago', '平常', 'ambient', 'https://ops.example.org/admin']) assert.ok(text.includes(part), `${part}: ${text}`)
    }
    assert.match(mail.subject, /1 施設/)
    assert.ok(!/[\r\n]/.test(mail.subject))
    assert.ok(!slack.text.includes('警報中'))
  })

  test('a site that should show a warning comes first, and the notice says so at its very start and in the mail subject', () => {
    const { slack, mail } = feedIdleMessage(idleFacts({ sites: [calm, warning] }), NOW)
    assert.match(slack.text, /^【EVAC LAYER・警報中】/)
    assert.match(mail.text, /^【EVAC LAYER・警報中】/)
    assert.match(mail.subject, /^\[EVAC LAYER\] 警報中/)
    const lines = slack.text.split('\n')
    assert.ok(lines[1]!.includes('alert-site') && lines[1]!.includes('TEST-IDLE-1'), lines[1])
    assert.ok(lines[2]!.includes('calm-site'), lines[2])
    assert.match(feedIdleMessage(idleFacts({ sites: [calm, warning], count: 2 }), NOW).slack.text, /^【EVAC LAYER・警報中】再通知（通知 2 回目/)
  })

  test('sites that stopped together put the server side first', () => {
    const { slack } = feedIdleMessage(idleFacts({ together: true, sites: [calm, warning] }), NOW)
    assert.match(slack.text.split('\n')[0]!, /^【EVAC LAYER・警報中】多くの施設が同時に止まっています.*逆プロキシ/)
    assert.ok(!feedIdleMessage(idleFacts(), NOW).slack.text.includes('同時に'))
  })

  test('what a site should show may be unknown', () => {
    const { slack } = feedIdleMessage(idleFacts({ sites: [{ ...calm, expected: 'unknown' }] }), NOW)
    assert.match(slack.text, /いま出すべきもの: 不明/)
    assert.match(slack.text, /Should show: unknown/)
  })

  test('names a facility registered cannot mention, link or add lines', () => {
    const { slack, mail } = feedIdleMessage(idleFacts(), NOW)
    assert.ok(!slack.text.includes('<!channel>'))
    assert.ok(slack.text.includes('&lt;!channel&gt;'))
    assert.ok(!/\n(承認済み|Bcc)/.test(slack.text))
    assert.ok(!/\n(承認済み|Bcc)/.test(mail.text))
    assert.ok(mail.text.includes('example[.]com'))
  })
})
