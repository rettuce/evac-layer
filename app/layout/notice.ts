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

type Lang = 'ja' | 'en'

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

// Strings a facility registers, and strings from a bulletin, must not add lines, reorder what follows them or hide
// characters. They are cut between code points, never inside a surrogate pair.
function plain(value: string): string {
  const flat = value.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').replace(/\p{Cf}/gu, '')
  const points = Array.from(flat)
  return points.length > MAX_FIELD_LENGTH ? `${points.slice(0, MAX_FIELD_LENGTH).join('')}…` : flat
}

// A URL a facility registered is shown broken, so that Slack does not make it a link.
export function oneLine(value: string): string {
  return plain(value).replace(/:\/\//g, '[:]//')
}

// Slack reads <…> as a mention or a link and &…; as an entity; escaped, they are shown as typed.
const escapeSlack = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function slackEscape(value: string): string {
  return escapeSlack(oneLine(value))
}

function minutesSince(firstSeenAt: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(firstSeenAt)) / 60000))
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

function block(facts: NoticeFacts, now: number, lang: Lang, quote: (value: string) => string, link: (url: string) => string): string[] {
  const label = LABELS[lang]
  const named = (name: string | undefined, id: string) => (name ? `${quote(name)} (${quote(id)})` : quote(id))
  const showing =
    facts.showing === 'unknown' ? label.unreadableFeed : facts.showing === null ? label.nothing : named(facts.showing.title, facts.showing.bulletin_id)
  const outcome = facts.outcome ? ` (${label.outcome}: ${quote(facts.outcome)})` : ''
  return [
    headline(facts, now, lang),
    `${label.site}: ${named(facts.site.name, facts.site.id)}`,
    `${label.municipality}: ${named(facts.site.municipality_name, facts.site.municipality_id)}`,
    `${label.bulletin}: ${named(facts.bulletin.title, facts.bulletin.id)}`,
    `${label.issued}: ${facts.bulletin.issued_at ? quote(facts.bulletin.issued_at) : label.unknown}`,
    `${label.level}: ${typeof facts.bulletin.level === 'number' ? facts.bulletin.level : label.unknown}`,
    `${label.reason}: ${facts.reason} — ${REASONS[facts.reason][lang]}${outcome}`,
    ...(facts.auto_publish || facts.reason === 'auto-publish-off' ? [] : [label.autoPublishOff]),
    `${label.showing}: ${showing}`,
    ...(facts.admin_url ? [`${label.admin}: ${link(facts.admin_url)}`] : []),
  ]
}

function noticeText(facts: NoticeFacts, now: number, quote: (value: string) => string, link: (url: string) => string): string {
  return [...block(facts, now, 'ja', quote, link), '', ...block(facts, now, 'en', quote, link)].join('\n')
}

export interface SlackMessage {
  text: string
  parse: 'none'
  unfurl_links: false
  unfurl_media: false
}

export function slackMessage(facts: NoticeFacts, now: number): SlackMessage {
  return { text: noticeText(facts, now, slackEscape, (url) => `<${escapeSlack(plain(url))}>`), parse: 'none', unfurl_links: false, unfurl_media: false }
}

export function mailMessage(facts: NoticeFacts, now: number): { subject: string; text: string } {
  const reminder = facts.count === 1 ? '' : ` — 通知 ${facts.count} 回目 / notice ${facts.count}`
  const subject = `[EVAC LAYER] 警報が画面に出ていません / Warning not on screen: ${oneLine(facts.site.name ?? facts.site.id)} (${oneLine(facts.site.id)})${reminder}`
  return { subject, text: noticeText(facts, now, oneLine, plain) }
}
