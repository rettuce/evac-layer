import { mkdir, rename, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { join } from 'node:path'
import { createTransport } from 'nodemailer'
import type { Approvals } from '~~/layout/gate'
import { type NoticeFacts, type SlackMessage, mailMessage, slackMessage } from '~~/layout/notice'
import { type IndexRow, type PendingReason, type ScreensRead, pendingReason, pendingSubject } from '~~/layout/pending'
import type { LayoutSnapshot } from './approvals'

export type NotifyChannel = 'slack' | 'mail'

const SLACK_TIMEOUT_MS = 10000
const SMTP_TIMEOUT_MS = 15000
const DEFAULT_REMIND_MINUTES = 15

export interface NotifySettings {
  channels: NotifyChannel[]
  slackUrl?: URL
  mail?: { smtpUrl: string; from: string; to: string[] }
  adminUrl?: string
  remindMs: number
  warnings: string[]
}

const text = (value: unknown) => (value === undefined || value === null ? '' : String(value).trim())

function parsedUrl(value: string): URL | undefined {
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}

// Warnings name the setting, never its value: the values carry the Slack webhook secret and the SMTP credentials.
export function notifySettings(): NotifySettings {
  const config = useRuntimeConfig()
  const warnings: string[] = []
  const channels: NotifyChannel[] = []
  const settings: NotifySettings = { channels, remindMs: DEFAULT_REMIND_MINUTES * 60000, warnings }

  const slack = text(config.notifySlackWebhookUrl)
  if (slack) {
    const url = parsedUrl(slack)
    const allowHttp = text(config.notifyAllowHttp) === '1'
    if (url && (url.protocol === 'https:' || (allowHttp && url.protocol === 'http:'))) {
      settings.slackUrl = url
      channels.push('slack')
    } else warnings.push('slack is off: NUXT_NOTIFY_SLACK_WEBHOOK_URL must be an https URL')
  }

  const mail = { smtpUrl: text(config.notifySmtpUrl), from: text(config.notifyMailFrom), to: text(config.notifyMailTo).split(',').map((to) => to.trim()).filter(Boolean) }
  if (mail.smtpUrl || mail.from || mail.to.length) {
    const protocol = parsedUrl(mail.smtpUrl)?.protocol
    if (!mail.smtpUrl || !mail.from || !mail.to.length) warnings.push('mail is off: set NUXT_NOTIFY_SMTP_URL, NUXT_NOTIFY_MAIL_FROM and NUXT_NOTIFY_MAIL_TO together')
    else if (protocol !== 'smtp:' && protocol !== 'smtps:') warnings.push('mail is off: NUXT_NOTIFY_SMTP_URL must start with smtp:// or smtps://')
    else {
      settings.mail = mail
      channels.push('mail')
    }
  }

  const base = text(config.notifyAdminBaseUrl)
  if (base) {
    const protocol = parsedUrl(base)?.protocol
    if (protocol === 'https:' || protocol === 'http:') settings.adminUrl = `${base.replace(/\/+$/, '')}/admin`
    else warnings.push('the admin link is left out: NUXT_NOTIFY_ADMIN_BASE_URL must be an http(s) URL')
  }

  const remind = text(config.notifyRemindMinutes)
  if (remind) {
    const minutes = Number(remind)
    if (Number.isFinite(minutes) && minutes >= 0) settings.remindMs = minutes * 60000
    else warnings.push(`NUXT_NOTIFY_REMIND_MINUTES must be a number of minutes, 0 or more; using ${DEFAULT_REMIND_MINUTES}`)
  }
  return settings
}

function failure(code: string): Error {
  return Object.assign(new Error(code), { code })
}

export function failureCode(error: unknown): string {
  return (error as { code?: unknown })?.code ? String((error as { code: unknown }).code) : 'error'
}

function postSlack(url: URL, message: SlackMessage): Promise<void> {
  const body = JSON.stringify(message)
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise((resolve, reject) => {
    const req = send(
      url,
      {
        method: 'POST',
        timeout: SLACK_TIMEOUT_MS,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'EVAC-LAYER-notify/0.1' },
      },
      (res) => {
        res.resume()
        res.on('end', () => {
          const status = res.statusCode ?? 0
          if (status >= 200 && status < 300) resolve()
          else reject(failure(`HTTP_${status}`))
        })
      },
    )
    req.on('timeout', () => req.destroy(failure('ETIMEDOUT')))
    req.on('error', reject)
    req.end(body)
  })
}

let mailer: { url: string; transport: ReturnType<typeof createTransport> } | undefined

function mailTransport(url: string) {
  if (mailer?.url !== url) {
    mailer?.transport.close()
    mailer = { url, transport: createTransport({ url, connectionTimeout: SMTP_TIMEOUT_MS, greetingTimeout: SMTP_TIMEOUT_MS, socketTimeout: SMTP_TIMEOUT_MS }) }
  }
  return mailer.transport
}

export function closeNotifyMail(): void {
  mailer?.transport.close()
  mailer = undefined
}

export async function sendNotice(settings: NotifySettings, channel: NotifyChannel, facts: NoticeFacts, now: number): Promise<void> {
  if (channel === 'slack') return postSlack(settings.slackUrl!, slackMessage(facts, now))
  const { smtpUrl, from, to } = settings.mail!
  const { subject, text: body } = mailMessage(facts, now)
  await mailTransport(smtpUrl).sendMail({ from, to, subject, text: body })
}

export interface NotifyRecord {
  site_id: string
  bulletin_id: string
  digest: string
  reason: PendingReason
  first_seen_at: string
  resolved_at?: string
  channels: Partial<Record<NotifyChannel, { count: number; last_sent_at: string }>>
}

export function notifyRecordFile(site: string): string {
  return join(dataDir(), 'live', `${site}.notify.json`)
}

export function noticeKey(bulletin: string, digest: string): string {
  return `${bulletin}\n${digest}`
}

export async function readNotifyRecord(site: string): Promise<NotifyRecord | undefined> {
  const record = await readJsonIfExists<NotifyRecord>(notifyRecordFile(site)).catch(() => undefined)
  return record?.site_id === site && typeof record.bulletin_id === 'string' && record.channels ? record : undefined
}

let partialCounter = 0

// Under the site's lock, and only while the site is the one `generation` was read from: a site deleted, or deleted and
// registered again, keeps no record of what was sent for the earlier one.
export function changeNotifyRecord(site: string, generation: number, change: (record: NotifyRecord | undefined) => NotifyRecord | undefined): Promise<NotifyRecord | undefined> {
  return withSiteLock(site, async () => {
    if (siteGeneration(site) !== generation || !(await readSite(site).catch(() => undefined))) return undefined
    const next = change(await readNotifyRecord(site))
    if (!next) return undefined
    const file = notifyRecordFile(site)
    await mkdir(join(dataDir(), 'live'), { recursive: true })
    const partial = `${file}.${process.pid}.${++partialCounter}.tmp`
    await writeFile(partial, `${JSON.stringify(next, null, 2)}\n`)
    await rename(partial, file)
    return next
  })
}

export interface Pending {
  bulletin_id: string
  digest: string
  reason: PendingReason
  facts: Omit<NoticeFacts, 'count' | 'first_seen_at'>
}

async function showingNow(site: string, rows: IndexRow[]): Promise<NoticeFacts['showing']> {
  try {
    const feed = await currentFeed(site)
    if (!feed?.bulletin_id) return null
    const title = rows.find((row) => row.bulletin_id === feed.bulletin_id)?.raw_title
    return { bulletin_id: feed.bulletin_id, ...(title ? { title } : {}) }
  } catch {
    return 'unknown'
  }
}

export async function findPending(site: SiteFile, approvals: Approvals, now: number, adminUrl?: string): Promise<Pending | undefined> {
  if (site.replay) return undefined
  const index = await readLayoutIndex(site.id)
  const rows: IndexRow[] = index?.entries ?? []
  const subject = pendingSubject({ replay: false, live: await readLiveState(site.id), rows, now })
  if (!subject) return undefined
  const row = rows.find((entry) => entry.bulletin_id === subject.bulletin_id)
  let snapshot: LayoutSnapshot | undefined
  let screens: ScreensRead
  try {
    snapshot = await readLayoutSnapshot(site.id, subject.bulletin_id)
    screens = snapshot ? { kind: 'read', digest: snapshot.digest, cls: snapshot.cls } : { kind: 'missing' }
  } catch {
    screens = { kind: 'unreadable' }
  }
  const reason = pendingReason({ approvals, site: site.id, subject, screens, rowStatus: row?.status })
  if (!reason) return undefined
  const alert = snapshot ? (JSON.parse(snapshot.files[0]!.body) as { alert?: { level?: number | null; issued_at?: string } }).alert : undefined
  return {
    bulletin_id: subject.bulletin_id,
    digest: screens.kind === 'read' ? screens.digest : screens.kind,
    reason,
    facts: {
      site: { id: site.id, municipality_id: site.municipality_id, ...(site.name ? { name: site.name } : {}), ...(index?.name ? { municipality_name: index.name } : {}) },
      bulletin: { id: subject.bulletin_id, title: row?.raw_title, issued_at: row?.issued_at ?? alert?.issued_at, level: alert?.level ?? row?.display_level ?? row?.municipality_level },
      reason,
      ...(subject.failed?.outcome ? { outcome: subject.failed.outcome } : {}),
      auto_publish: Boolean(approvals.sites[site.id]?.auto_publish),
      showing: await showingNow(site.id, rows),
      ...(adminUrl ? { admin_url: adminUrl } : {}),
    },
  }
}
