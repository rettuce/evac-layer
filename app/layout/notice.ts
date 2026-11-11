import type { PendingReason } from './pending'

export interface NoticeFacts {
  site: { id: string; name?: string; municipality_id: string; municipality_name?: string }
  bulletin: { id: string; title?: string; issued_at?: string; level?: number | null }
  reason: PendingReason
  outcome?: string
  auto_publish: boolean
  showing: { bulletin_id: string; title?: string } | null | 'unknown'
  admin_url?: string
  count: number
  first_seen_at: string
  previous_reason?: PendingReason
}

export type Lang = 'ja' | 'en'

const MAX_FIELD_LENGTH = 200

const REASONS: Record<PendingReason, Record<Lang, string>> = {
  unapproved: {
    ja: 'この電文の承認がなく、クラスの承認でも通りません',
    en: 'Neither an approval of this bulletin nor a class approval lets it through',
  },
  'changed-after-approval': {
    ja: '承認のあとで画面が変わったため、もう一度の承認が要ります',
    en: 'The screens changed after they were approved and need approving again',
  },
  'auto-publish-off': {
    ja: '承認済みですが、この施設の自動配信がオフです',
    en: 'Approved, but auto publish is off for this site',
  },
  'screens-missing': {
    ja: '電文の画面のファイルがありません',
    en: 'The bulletin has no screen files',
  },
  'screens-unreadable': {
    ja: '電文の画面のファイルが読めません',
    en: 'The screen files of the bulletin cannot be read',
  },
  'check-failed': {
    ja: '画面が検査を通らなかったため、受信の処理が画面に出していません',
    en: 'The screens did not pass the checks, so the receiver did not put the bulletin on screen',
  },
}

const LABELS = {
  ja: {
    site: '施設', municipality: '市町村', bulletin: '電文', issued: '発表', level: '警戒レベル', reason: '理由', outcome: '検査の結果',
    autoPublishOff: '自動配信: オフ', showing: 'いま画面に出ているもの', nothing: 'なし', unknown: '不明', unreadableFeed: '不明（フィードを読めません）', admin: '管理画面',
  },
  en: {
    site: 'Site', municipality: 'Municipality', bulletin: 'Bulletin', issued: 'Issued', level: 'Warning level', reason: 'Reason', outcome: 'check outcome',
    autoPublishOff: 'Auto publish: off', showing: 'On screen now', nothing: 'nothing', unknown: 'unknown', unreadableFeed: 'unknown (the feed cannot be read)', admin: 'Admin',
  },
} satisfies Record<Lang, Record<string, string>>

// Strings a facility registers, and strings from a bulletin, are folded to NFKC first, so full-width and compatibility
// forms read as what they look like, and must not add lines, reorder what follows them or hide characters. They are cut
// between code points, never inside a surrogate pair.
export function plain(value: string): string {
  const flat = value.normalize('NFKC').replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').replace(/\p{Cf}/gu, '').trim()
  const points = Array.from(flat)
  return points.length > MAX_FIELD_LENGTH ? `${points.slice(0, MAX_FIELD_LENGTH).join('')}…` : flat
}

const HOST_NAME = /(?<![A-Za-z0-9-])(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}(?![A-Za-z0-9-])/g

export type Quote = (value: string | undefined, fallback: string) => string

// Mail has no inline code: a URL or a host name is shown broken instead, which catches the common forms only.
export const mailQuote: Quote = (value, fallback) =>
  plain(value ?? '').replace(/:\/\//g, '[:]//').replace(HOST_NAME, (host) => host.replace(/\./g, '[.]')) || fallback

// Slack reads <…> as a mention or a link and &…; as an entity, and links nothing inside inline code.
const escapeSlack = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const slackQuote: Quote = (value, fallback) => {
  const shown = plain(value ?? '').replace(/`/g, '').trim()
  return shown ? `\`${escapeSlack(shown)}\`` : fallback
}

export function minutesSince(firstSeenAt: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(firstSeenAt)) / 60000))
}

export function namedWith(quote: Quote, unknown: string): (name: string | undefined, id: string) => string {
  return (name, id) => {
    const shownName = quote(name, '')
    return shownName ? `${shownName} (${quote(id, unknown)})` : quote(id, unknown)
  }
}

function headline(facts: NoticeFacts, now: number, lang: Lang): string {
  const minutes = minutesSince(facts.first_seen_at, now)
  if (facts.previous_reason && facts.count > 1) {
    const change = `${facts.previous_reason} → ${facts.reason}`
    return lang === 'ja'
      ? `【EVAC LAYER】理由が変わりました（通知 ${facts.count} 回目・最初の検知から ${minutes} 分）: ${change}`
      : `[EVAC LAYER] The reason changed (notice ${facts.count}, first seen ${minutes} min ago): ${change}`
  }
  if (lang === 'ja') {
    return facts.count === 1
      ? '【EVAC LAYER】警報が出ていますが、画面に出ていません'
      : `【EVAC LAYER】再通知（通知 ${facts.count} 回目・最初の検知から ${minutes} 分）: 警報がまだ画面に出ていません`
  }
  return facts.count === 1
    ? '[EVAC LAYER] A warning is out but not on screen'
    : `[EVAC LAYER] Reminder (notice ${facts.count}, first seen ${minutes} min ago): the warning is still not on screen`
}

function block(facts: NoticeFacts, now: number, lang: Lang, quote: Quote, link: (url: string) => string): string[] {
  const label = LABELS[lang]
  const named = namedWith(quote, label.unknown)
  const showing =
    facts.showing === 'unknown' ? label.unreadableFeed : facts.showing === null ? label.nothing : named(facts.showing.title, facts.showing.bulletin_id)
  const outcome = facts.outcome ? ` (${label.outcome}: ${quote(facts.outcome, label.unknown)})` : ''
  return [
    headline(facts, now, lang),
    `${label.site}: ${named(facts.site.name, facts.site.id)}`,
    `${label.municipality}: ${named(facts.site.municipality_name, facts.site.municipality_id)}`,
    `${label.bulletin}: ${named(facts.bulletin.title, facts.bulletin.id)}`,
    `${label.issued}: ${quote(facts.bulletin.issued_at, label.unknown)}`,
    `${label.level}: ${typeof facts.bulletin.level === 'number' ? facts.bulletin.level : label.unknown}`,
    `${label.reason}: ${facts.reason} — ${REASONS[facts.reason][lang]}${outcome}`,
    ...(facts.auto_publish || facts.reason === 'auto-publish-off' ? [] : [label.autoPublishOff]),
    `${label.showing}: ${showing}`,
    ...(facts.admin_url ? [`${label.admin}: ${link(facts.admin_url)}`] : []),
  ]
}

export type NoticeBlock = (lang: Lang, quote: Quote, link: (url: string) => string) => string[]

export interface SlackMessage {
  text: string
  parse: 'none'
  unfurl_links: false
  unfurl_media: false
}

export interface MailMessage {
  subject: string
  text: string
}

export interface OutgoingNotice {
  slack: SlackMessage
  mail: MailMessage
}

function bilingual(block: NoticeBlock, quote: Quote, link: (url: string) => string): string {
  return [...block('ja', quote, link), '', ...block('en', quote, link)].join('\n')
}

export function slackOf(block: NoticeBlock): SlackMessage {
  return { text: bilingual(block, slackQuote, (url) => `<${escapeSlack(plain(url))}>`), parse: 'none', unfurl_links: false, unfurl_media: false }
}

export function mailOf(subject: string, block: NoticeBlock): MailMessage {
  return { subject, text: bilingual(block, mailQuote, plain) }
}

export function slackMessage(facts: NoticeFacts, now: number): SlackMessage {
  return slackOf((lang, quote, link) => block(facts, now, lang, quote, link))
}

export function mailMessage(facts: NoticeFacts, now: number): MailMessage {
  const reminder = facts.count === 1 ? '' : ` — 通知 ${facts.count} 回目 / notice ${facts.count}`
  const subject = `[EVAC LAYER] 警報が画面に出ていません / Warning not on screen: ${mailQuote(facts.site.name, mailQuote(facts.site.id, ''))} (${mailQuote(facts.site.id, '')})${reminder}`
  return mailOf(subject, (lang, quote, link) => block(facts, now, lang, quote, link))
}

export function pendingMessage(facts: NoticeFacts, now: number): OutgoingNotice {
  return { slack: slackMessage(facts, now), mail: mailMessage(facts, now) }
}
