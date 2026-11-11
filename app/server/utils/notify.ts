import { mkdir, rename, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { join } from 'node:path'
import { createTransport } from 'nodemailer'
import type { Approvals } from '~~/layout/gate'
import { type NoticeFacts, type SlackMessage, mailMessage, slackMessage } from '~~/layout/notice'
import { type IndexRow, type PendingReason, type ScreensRead, pendingReason, pendingSubject } from '~~/layout/pending'
import { type SmtpTransportOptions, smtpTransportOptions } from '~~/layout/smtpOptions'
import type { LayoutSnapshot } from './approvals'

export type NotifyChannel = 'slack' | 'mail'

const SLACK_IDLE_TIMEOUT_MS = 10000
const SLACK_DEADLINE_MS = 20000
const SMTP_TIMEOUT_MS = 15000
const DEFAULT_REMIND_MINUTES = 15

export interface NotifySettings {
  channels: NotifyChannel[]
  slackUrl?: URL
  mail?: { options: SmtpTransportOptions; from: string; to: string[] }
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

const SMTP_PROBLEMS = {
  'not-a-url': 'mail is off: NUXT_NOTIFY_SMTP_URL is not a URL',
  protocol: 'mail is off: NUXT_NOTIFY_SMTP_URL must start with smtp:// or smtps://',
  query: 'mail is off: NUXT_NOTIFY_SMTP_URL must not carry a query (it could turn TLS checks off)',
} as const

// Warnings name the setting, never its value: the values carry the Slack webhook secret and the SMTP credentials.
export function notifySettings(): NotifySettings {
  const config = useRuntimeConfig()
  const warnings: string[] = []
  const channels: NotifyChannel[] = []
  const settings: NotifySettings = { channels, remindMs: DEFAULT_REMIND_MINUTES * 60000, warnings }
  const allowPlaintext = text(config.notifyAllowPlaintext) === '1'

  const slack = text(config.notifySlackWebhookUrl)
  if (slack) {
    const url = parsedUrl(slack)
    if (url && (url.protocol === 'https:' || (allowPlaintext && url.protocol === 'http:'))) {
      settings.slackUrl = url
      channels.push('slack')
    } else warnings.push('slack is off: NUXT_NOTIFY_SLACK_WEBHOOK_URL must be an https URL')
  }

  const smtpUrl = text(config.notifySmtpUrl)
  const from = text(config.notifyMailFrom)
  const to = text(config.notifyMailTo).split(',').map((address) => address.trim()).filter(Boolean)
  if (smtpUrl || from || to.length) {
    const smtp = smtpUrl ? smtpTransportOptions(smtpUrl, allowPlaintext) : undefined
    if (!smtpUrl || !from || !to.length) warnings.push('mail is off: set NUXT_NOTIFY_SMTP_URL, NUXT_NOTIFY_MAIL_FROM and NUXT_NOTIFY_MAIL_TO together')
    else if (!smtp!.ok) warnings.push(SMTP_PROBLEMS[smtp!.problem])
    else {
      settings.mail = { options: smtp!.options, from, to }
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
        timeout: SLACK_IDLE_TIMEOUT_MS,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'EVAC-LAYER-notify/0.1' },
      },
      (res) => {
        res.resume()
        res.on('end', () => {
          const status = res.statusCode ?? 0
          if (status >= 200 && status < 300) resolve()
          else reject(failure(`HTTP_${status}`))
        })
        res.on('error', reject)
      },
    )
    const deadline = setTimeout(() => req.destroy(failure('ETIMEDOUT')), SLACK_DEADLINE_MS)
    req.on('close', () => clearTimeout(deadline))
    req.on('timeout', () => req.destroy(failure('ETIMEDOUT')))
    req.on('error', reject)
    req.end(body)
  })
}

let mailer: { options: SmtpTransportOptions; transport: ReturnType<typeof createTransport> } | undefined

function mailTransport(options: SmtpTransportOptions) {
  if (mailer?.options !== options) {
    mailer?.transport.close()
    mailer = { options, transport: createTransport({ ...options, connectionTimeout: SMTP_TIMEOUT_MS, greetingTimeout: SMTP_TIMEOUT_MS, socketTimeout: SMTP_TIMEOUT_MS }) }
  }
  return mailer.transport
}

export function closeNotifyMail(): void {
  mailer?.transport.close()
  mailer = undefined
}

export async function sendNotice(settings: NotifySettings, channel: NotifyChannel, facts: NoticeFacts, now: number): Promise<void> {
  if (channel === 'slack') return postSlack(settings.slackUrl!, slackMessage(facts, now))
  const { options, from, to } = settings.mail!
  const { subject, text: body } = mailMessage(facts, now)
  await mailTransport(options).sendMail({ from, to, subject, text: body })
}

export interface NotifyRecord {
  site_id: string
  bulletin_id: string
  digest: string
  reason: PendingReason
  first_seen_at: string
  resolved_at?: string
  channels: Partial<Record<NotifyChannel, { count: number; last_sent_at?: string; reason?: PendingReason }>>
}

export function notifyRecordFile(site: string): string {
  return join(dataDir(), 'live', `${site}.notify.json`)
}

export async function readNotifyRecord(site: string): Promise<NotifyRecord | undefined> {
  const record = await readJsonIfExists<NotifyRecord>(notifyRecordFile(site)).catch(() => undefined)
  return record?.site_id === site && typeof record.bulletin_id === 'string' && typeof record.digest === 'string' && record.channels ? record : undefined
}

let partialCounter = 0

// Under the site's lock, and only while the site is the one `generation` was read from: a site deleted, or deleted and
// registered again, gets no record of what was sent for the earlier one. False when the site is no longer that one.
export function writeNotifyRecord(site: string, generation: number, record: NotifyRecord): Promise<boolean> {
  return withSiteLock(site, async () => {
    if (siteGeneration(site) !== generation || !(await readSite(site).catch(() => undefined))) return false
    const file = notifyRecordFile(site)
    await mkdir(join(dataDir(), 'live'), { recursive: true })
    const partial = `${file}.${process.pid}.${++partialCounter}.tmp`
    await writeFile(partial, `${JSON.stringify(record, null, 2)}\n`)
    await rename(partial, file)
    return true
  })
}

export interface Pending {
  bulletin_id: string
  digest: string
  reason: PendingReason
  rows: IndexRow[]
  facts: Omit<NoticeFacts, 'count' | 'first_seen_at' | 'showing' | 'previous_reason'>
}

export async function showingNow(site: SiteFile, approvals: Approvals, rows: IndexRow[]): Promise<NoticeFacts['showing']> {
  try {
    const bulletin = await liveBulletin(site, approvals)
    if (!bulletin) return null
    const title = rows.find((row) => row.bulletin_id === bulletin)?.raw_title
    return { bulletin_id: bulletin, ...(title ? { title } : {}) }
  } catch {
    return 'unknown'
  }
}

async function indexRows(site: string): Promise<{ rows: IndexRow[]; name?: string }> {
  try {
    const index = await readLayoutIndex(site)
    if (!index) return { rows: [] }
    if (!Array.isArray(index.entries)) throw new Error('index.json has no entries')
    return { rows: index.entries.filter((row) => row && typeof row === 'object'), ...(typeof index.name === 'string' ? { name: index.name } : {}) }
  } catch {
    return { rows: [] }
  }
}

function alertOf(snapshot: LayoutSnapshot | undefined): { level?: number | null; issued_at?: string } | undefined {
  try {
    return snapshot ? (JSON.parse(snapshot.files[0]!.body) as { alert?: { level?: number | null; issued_at?: string } }).alert : undefined
  } catch {
    return undefined
  }
}

// A broken index or broken screens are themselves a reason the warning is not on screen; only a live state that cannot
// be read leaves the bulletin unknown, and that throws.
export async function findPending(site: SiteFile, approvals: Approvals, now: number, adminUrl?: string): Promise<Pending | undefined> {
  if (site.replay) return undefined
  const { rows, name } = await indexRows(site.id)
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
  const alert = alertOf(snapshot)
  const level = [alert?.level, row?.display_level, row?.municipality_level].find((value) => typeof value === 'number')
  const issuedAt = [row?.issued_at, alert?.issued_at].find((value) => typeof value === 'string')
  return {
    bulletin_id: subject.bulletin_id,
    digest: screens.kind === 'read' ? screens.digest : screens.kind,
    reason,
    rows,
    facts: {
      site: { id: site.id, municipality_id: site.municipality_id, ...(site.name ? { name: site.name } : {}), ...(name ? { municipality_name: name } : {}) },
      bulletin: { id: subject.bulletin_id, ...(typeof row?.raw_title === 'string' ? { title: row.raw_title } : {}), ...(issuedAt ? { issued_at: issuedAt } : {}), level: level ?? null },
      reason,
      ...(typeof subject.failed?.outcome === 'string' ? { outcome: subject.failed.outcome } : {}),
      auto_publish: Boolean(approvals.sites[site.id]?.auto_publish),
      ...(adminUrl ? { admin_url: adminUrl } : {}),
    },
  }
}
