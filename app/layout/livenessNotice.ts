import { type Lang, type OutgoingNotice, type Quote, mailOf, namedWith, slackOf } from './notice.ts'

export interface NoticeSite {
  id: string
  name?: string
  municipality_id: string
  municipality_name?: string
}

export interface ReceiverStoppedFacts {
  sites: (NoticeSite & { received_at: string })[]
  threshold_ms: number
  count: number
  first_seen_at: string
  admin_url?: string
}

export type ExpectedScreen = { state: 'alert'; bulletin_id: string; level?: number } | { state: 'ambient' } | 'unknown'

export const isAlert = (expected: ExpectedScreen) => expected !== 'unknown' && expected.state === 'alert'

export interface IdleSite extends NoticeSite {
  last_request_at: string
  expected: ExpectedScreen
}

export interface FeedIdleFacts {
  sites: IdleSite[]
  together: boolean
  threshold_ms: number
  count: number
  first_seen_at: string
  admin_url?: string
}

const LABELS = {
  ja: {
    site: '施設', municipality: '市町村', lastReceived: '最後に受信できた時刻', lastRequest: '最後に来た時刻', expected: 'いま出すべきもの',
    alert: '警報の画面', ambient: '平常の画面', bulletin: '電文', level: '警戒レベル', unknown: '不明', admin: '管理画面', ago: (span: string) => `${span}前`,
  },
  en: {
    site: 'Site', municipality: 'Municipality', lastReceived: 'Last received', lastRequest: 'Last request', expected: 'Should show',
    alert: 'the warning screens', ambient: 'the ambient screen', bulletin: 'bulletin', level: 'warning level', unknown: 'unknown', admin: 'Admin', ago: (span: string) => `${span} ago`,
  },
}

const PREFIX: Record<Lang, string> = { ja: '【EVAC LAYER】', en: '[EVAC LAYER] ' }
const ALERT_PREFIX: Record<Lang, string> = { ja: '【EVAC LAYER・警報中】', en: '[EVAC LAYER — WARNING OUT] ' }

export function span(ms: number, lang: Lang): string {
  const minutes = Math.floor(Math.max(0, ms) / 60000)
  if (minutes < 1) return lang === 'ja' ? '1 分未満' : 'less than 1 min'
  return lang === 'ja' ? `${minutes} 分` : `${minutes} min`
}

const since = (at: string, now: number, lang: Lang) => span(now - Date.parse(at), lang)

function reminderHead(count: number, firstSeenAt: string, now: number, lang: Lang): string {
  return lang === 'ja' ? `再通知（通知 ${count} 回目・最初の検知から ${since(firstSeenAt, now, lang)}）: ` : `Reminder (notice ${count}, first seen ${since(firstSeenAt, now, lang)} ago): `
}

const reminderSubject = (count: number) => (count === 1 ? '' : ` — 通知 ${count} 回目 / notice ${count}`)
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function receiverHeadline(facts: ReceiverStoppedFacts, now: number, lang: Lang): string {
  const n = facts.sites.length
  const head = facts.count === 1 ? '' : reminderHead(facts.count, facts.first_seen_at, now, lang)
  return lang === 'ja'
    ? `${PREFIX.ja}${head}気象庁の電文の受信が${facts.count === 1 ? '' : 'まだ'}止まっています（${n} 施設・${span(facts.threshold_ms, lang)}以上、受信に成功していません）`
    : `${PREFIX.en}${head}${facts.count === 1 ? 'Receiving' : 'receiving'} JMA bulletins has ${facts.count === 1 ? '' : 'still '}stopped (${plural(n, 'site')}, no successful receive for ${span(facts.threshold_ms, lang)} or more)`
}

function receiverBlock(facts: ReceiverStoppedFacts, now: number, lang: Lang, quote: Quote, link: (url: string) => string): string[] {
  const label = LABELS[lang]
  const named = namedWith(quote, label.unknown)
  return [
    receiverHeadline(facts, now, lang),
    ...facts.sites.map((site) =>
      `- ${label.site}: ${named(site.name, site.id)} / ${label.municipality}: ${named(site.municipality_name, site.municipality_id)} / ${label.lastReceived}: ${quote(site.received_at, label.unknown)} (${label.ago(since(site.received_at, now, lang))})`,
    ),
    lang === 'ja'
      ? '新しい警報が出ても、これらの施設の画面は変わりません。受信（pnpm -F agents receive）が動いているか確かめてください。'
      : 'A new warning will not change the screens of these sites. Check that the receiver (pnpm -F agents receive) is running.',
    ...(facts.admin_url ? [`${label.admin}: ${link(facts.admin_url)}`] : []),
  ]
}

export function receiverStoppedMessage(facts: ReceiverStoppedFacts, now: number): OutgoingNotice {
  const n = facts.sites.length
  const subject = `[EVAC LAYER] 受信が止まっています / Receiving stopped: ${n} 施設 / ${plural(n, 'site')}${reminderSubject(facts.count)}`
  const block = (lang: Lang, quote: Quote, link: (url: string) => string) => receiverBlock(facts, now, lang, quote, link)
  return { slack: slackOf(block), mail: mailOf(subject, block) }
}

export function idleOrder(sites: IdleSite[]): IdleSite[] {
  return [...sites].sort((a, b) => Number(isAlert(b.expected)) - Number(isAlert(a.expected)) || Date.parse(a.last_request_at) - Date.parse(b.last_request_at) || a.id.localeCompare(b.id))
}

function expectedText(expected: ExpectedScreen, lang: Lang, quote: Quote): string {
  const label = LABELS[lang]
  if (expected === 'unknown') return label.unknown
  if (expected.state === 'ambient') return `${label.ambient} (ambient)`
  const level = typeof expected.level === 'number' ? `, ${label.level} ${expected.level}` : ''
  return `${label.alert} (${label.bulletin} ${quote(expected.bulletin_id, label.unknown)}${level}) (alert)`
}

function idleBlock(facts: FeedIdleFacts, now: number, lang: Lang, quote: Quote, link: (url: string) => string): string[] {
  const label = LABELS[lang]
  const named = namedWith(quote, label.unknown)
  const sites = idleOrder(facts.sites)
  const alerts = sites.filter((site) => isAlert(site.expected)).length
  const prefix = alerts ? ALERT_PREFIX[lang] : PREFIX[lang]
  const head = facts.count === 1 ? '' : reminderHead(facts.count, facts.first_seen_at, now, lang)
  const n = sites.length
  const headline =
    lang === 'ja'
      ? `${prefix}${head}施設の画面が${facts.count === 1 ? '' : 'まだ'}フィードを取りに来ていません（${n} 施設${alerts ? `・うち ${alerts} 施設は警報の画面を出すべき状態` : ''}・${span(facts.threshold_ms, lang)}以上）`
      : `${prefix}${head}${facts.count === 1 ? 'Site' : 'site'} screens ${facts.count === 1 ? 'have' : 'still have'} stopped requesting their feeds (${plural(n, 'site')}${alerts ? `, ${alerts} of them should show a warning` : ''}, for ${span(facts.threshold_ms, lang)} or more)`
  const together =
    lang === 'ja'
      ? `${prefix}多くの施設が同時に止まっています。サーバー側の経路（逆プロキシ・証明書・回線）の障害の可能性があります。`
      : `${prefix}Many sites stopped at once: the server's side (reverse proxy, certificate, network) may be down.`
  return [
    ...(facts.together ? [together] : []),
    headline,
    ...sites.map((site) =>
      `- ${isAlert(site.expected) ? (lang === 'ja' ? '【警報】' : '[WARNING] ') : ''}${label.site}: ${named(site.name, site.id)} / ${label.municipality}: ${named(site.municipality_name, site.municipality_id)} / ${label.lastRequest}: ${quote(site.last_request_at, label.unknown)} (${label.ago(since(site.last_request_at, now, lang))}) / ${label.expected}: ${expectedText(site.expected, lang, quote)}`,
    ),
    lang === 'ja'
      ? 'サーバーが正しい画面を用意しても、これらの施設では古い画面か、何も出ていない状態が続きます。施設の回線と画面の機器を確かめてください。'
      : 'Whatever the server prepares, these sites keep an old screen or none. Check their network and screen devices.',
    ...(facts.admin_url ? [`${label.admin}: ${link(facts.admin_url)}`] : []),
  ]
}

export function feedIdleMessage(facts: FeedIdleFacts, now: number): OutgoingNotice {
  const n = facts.sites.length
  const alert = facts.sites.some((site) => isAlert(site.expected))
  const what = alert
    ? '警報中: 施設の画面がフィードを取りに来ていません / Warning out: site screens not requesting their feeds'
    : '施設の画面がフィードを取りに来ていません / Site screens not requesting their feeds'
  const subject = `[EVAC LAYER] ${what}: ${n} 施設 / ${plural(n, 'site')}${reminderSubject(facts.count)}`
  const block = (lang: Lang, quote: Quote, link: (url: string) => string) => idleBlock(facts, now, lang, quote, link)
  return { slack: slackOf(block), mail: mailOf(subject, block) }
}
