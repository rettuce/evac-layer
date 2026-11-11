import { type Lang, type OutgoingNotice, type Quote, mailOf, mailQuote, minutesSince, namedWith, slackOf } from './notice.ts'

export interface NoticeSite {
  id: string
  name?: string
  municipality_id: string
  municipality_name?: string
}

export interface ReceiverStoppedFacts {
  sites: (NoticeSite & { received_at: string })[]
  threshold_minutes: number
  count: number
  first_seen_at: string
  admin_url?: string
}

export type ExpectedScreen = { state: 'alert'; bulletin_id: string; level?: number; hazard?: string } | { state: 'ambient' } | 'unknown'

export type ExpectedState = 'alert' | 'ambient' | 'unknown'

export function expectedState(expected: ExpectedScreen): ExpectedState {
  return expected === 'unknown' ? 'unknown' : expected.state
}

export interface FeedIdleFacts {
  site: NoticeSite
  last_request_at: string
  expected: ExpectedScreen
  count: number
  first_seen_at: string
  previous_expected?: ExpectedState
  admin_url?: string
}

const LABELS = {
  ja: {
    site: '施設', municipality: '市町村', lastReceived: '最後に受信できた時刻', lastRequest: '最後にフィードを取りに来た時刻', since: '止まってからの時間',
    expected: 'いま出すべきもの', alert: '警報の画面', ambient: '平常の画面', bulletin: '電文', level: '警戒レベル', unknown: '不明', admin: '管理画面',
    minutes: (n: number) => `${n} 分`,
  },
  en: {
    site: 'Site', municipality: 'Municipality', lastReceived: 'Last received', lastRequest: 'Last feed request', since: 'Stopped for',
    expected: 'Should show now', alert: 'the warning screens', ambient: 'the ambient screen', bulletin: 'bulletin', level: 'warning level', unknown: 'unknown', admin: 'Admin',
    minutes: (n: number) => `${n} min`,
  },
}

const ALERT_PREFIX: Record<Lang, string> = { ja: '【EVAC LAYER・警報中】', en: '[EVAC LAYER — WARNING OUT]' }
const PREFIX: Record<Lang, string> = { ja: '【EVAC LAYER】', en: '[EVAC LAYER]' }

function reminderHead(count: number, minutes: number, lang: Lang): string {
  return lang === 'ja' ? `再通知（通知 ${count} 回目・最初の検知から ${minutes} 分）: ` : `Reminder (notice ${count}, first seen ${minutes} min ago): `
}

function receiverHeadline(facts: ReceiverStoppedFacts, now: number, lang: Lang): string {
  const n = facts.sites.length
  const minutes = minutesSince(facts.first_seen_at, now)
  if (lang === 'ja') {
    const what = `気象庁の電文の受信が${facts.count === 1 ? '' : 'まだ'}止まっています（${n} 施設・${facts.threshold_minutes} 分以上、受信に成功していません）`
    return `${PREFIX.ja}${facts.count === 1 ? '' : reminderHead(facts.count, minutes, lang)}${what}`
  }
  const what = `receiving JMA bulletins has ${facts.count === 1 ? '' : 'still '}stopped (${n} site${n === 1 ? '' : 's'}, no successful receive for ${facts.threshold_minutes} min or more)`
  return `${PREFIX.en} ${facts.count === 1 ? `${what[0]!.toUpperCase()}${what.slice(1)}` : `${reminderHead(facts.count, minutes, lang)}${what}`}`
}

function receiverBlock(facts: ReceiverStoppedFacts, now: number, lang: Lang, quote: Quote, link: (url: string) => string): string[] {
  const label = LABELS[lang]
  const named = namedWith(quote, label.unknown)
  return [
    receiverHeadline(facts, now, lang),
    ...facts.sites.map((site) =>
      `- ${label.site}: ${named(site.name, site.id)} / ${label.municipality}: ${named(site.municipality_name, site.municipality_id)} / ${label.lastReceived}: ${quote(site.received_at, label.unknown)} (${label.minutes(minutesSince(site.received_at, now))})`,
    ),
    lang === 'ja'
      ? '新しい警報が出ても、これらの施設の画面は変わりません。受信（pnpm -F agents receive）が動いているか確かめてください。'
      : 'A new warning will not change the screens of these sites. Check that the receiver (pnpm -F agents receive) is running.',
    ...(facts.admin_url ? [`${label.admin}: ${link(facts.admin_url)}`] : []),
  ]
}

export function receiverStoppedMessage(facts: ReceiverStoppedFacts, now: number): OutgoingNotice {
  const reminder = facts.count === 1 ? '' : ` — 通知 ${facts.count} 回目 / notice ${facts.count}`
  const subject = `[EVAC LAYER] 受信が止まっています / Receiving stopped: ${facts.sites.length} 施設 / ${facts.sites.length} site${facts.sites.length === 1 ? '' : 's'}${reminder}`
  const block = (lang: Lang, quote: Quote, link: (url: string) => string) => receiverBlock(facts, now, lang, quote, link)
  return { slack: slackOf(block), mail: mailOf(subject, block) }
}

function idleHeadline(facts: FeedIdleFacts, now: number, lang: Lang): string {
  const prefix = expectedState(facts.expected) === 'alert' ? ALERT_PREFIX[lang] : PREFIX[lang]
  const firstSeen = minutesSince(facts.first_seen_at, now)
  const idle = minutesSince(facts.last_request_at, now)
  if (facts.previous_expected && facts.count > 1) {
    const change = `${facts.previous_expected} → ${expectedState(facts.expected)}`
    return lang === 'ja'
      ? `${prefix}施設の画面がフィードを取りに来ていないまま、出すべきものが変わりました（通知 ${facts.count} 回目・最初の検知から ${firstSeen} 分）: ${change}`
      : `${prefix} The site screen has stopped requesting its feed, and what it should show changed (notice ${facts.count}, first seen ${firstSeen} min ago): ${change}`
  }
  if (lang === 'ja') {
    return facts.count === 1
      ? `${prefix}施設の画面がフィードを取りに来ていません（${idle} 分）`
      : `${prefix}${reminderHead(facts.count, firstSeen, lang)}施設の画面がまだフィードを取りに来ていません`
  }
  return facts.count === 1
    ? `${prefix} The site screen has stopped requesting its feed (${idle} min)`
    : `${prefix} ${reminderHead(facts.count, firstSeen, lang)}the site screen still does not request its feed`
}

function expectedText(expected: ExpectedScreen, lang: Lang, quote: Quote): string {
  const label = LABELS[lang]
  if (expected === 'unknown') return label.unknown
  if (expected.state === 'ambient') return lang === 'ja' ? `${label.ambient}（警報なし） / ambient` : `${label.ambient} (no warning) / ambient`
  const level = typeof expected.level === 'number' ? `, ${label.level} ${expected.level}` : ''
  return `${label.alert} (${label.bulletin} ${quote(expected.bulletin_id, label.unknown)}${level}) / alert`
}

function idleBlock(facts: FeedIdleFacts, now: number, lang: Lang, quote: Quote, link: (url: string) => string): string[] {
  const label = LABELS[lang]
  const named = namedWith(quote, label.unknown)
  return [
    idleHeadline(facts, now, lang),
    `${label.expected}: ${expectedText(facts.expected, lang, quote)}`,
    `${label.site}: ${named(facts.site.name, facts.site.id)}`,
    `${label.municipality}: ${named(facts.site.municipality_name, facts.site.municipality_id)}`,
    `${label.lastRequest}: ${quote(facts.last_request_at, label.unknown)}`,
    `${label.since}: ${label.minutes(minutesSince(facts.last_request_at, now))}`,
    lang === 'ja'
      ? 'サーバーが正しい画面を用意しても、施設では古い画面か、何も出ていない状態が続きます。施設の回線と画面の機器を確かめてください。'
      : 'Whatever the server prepares, the site keeps an old screen or none. Check the site\'s network and its screen device.',
    ...(facts.admin_url ? [`${label.admin}: ${link(facts.admin_url)}`] : []),
  ]
}

export function feedIdleMessage(facts: FeedIdleFacts, now: number): OutgoingNotice {
  const alert = expectedState(facts.expected) === 'alert'
  const reminder = facts.count === 1 ? '' : ` — 通知 ${facts.count} 回目 / notice ${facts.count}`
  const what = alert ? '警報中: 施設の画面がフィードを取りに来ていません / Warning out: site screen not requesting its feed' : '施設の画面がフィードを取りに来ていません / Site screen not requesting its feed'
  const subject = `[EVAC LAYER] ${what}: ${mailQuote(facts.site.name, mailQuote(facts.site.id, ''))} (${mailQuote(facts.site.id, '')})${reminder}`
  const block = (lang: Lang, quote: Quote, link: (url: string) => string) => idleBlock(facts, now, lang, quote, link)
  return { slack: slackOf(block), mail: mailOf(subject, block) }
}
