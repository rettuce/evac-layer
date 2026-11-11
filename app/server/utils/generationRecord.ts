import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isSyntheticBulletinId } from '~~/layout/gate'
import type { Actor } from './audit'
import type { ChildMark } from './orphans'

export type GenerationStatus = 'queued' | 'running' | 'done' | 'failed'
export type GenerationErrorCode = 'generate-failed' | 'timed-out' | 'no-result' | 'server-restarted' | 'internal-error'
export type PreviewErrorCode = 'preview-failed' | 'timed-out' | 'screens-changed'

export const ERROR_TEXT: Record<GenerationErrorCode, string> = {
  'generate-failed': 'the generate command ended with an error; the operator finds its output in the server log',
  'timed-out': 'the job ran past its time limit',
  'no-result': 'the generate command wrote no result for this job',
  'server-restarted': 'server restarted',
  'internal-error': 'the job stopped on an error; the operator finds it in the server log',
}

export interface GenerationClass {
  class: string
  bulletin_id?: string
  synthetic: boolean
  outcome: string
  reason?: string
  preview_error?: PreviewErrorCode
}

export interface Generation {
  generation_id: string
  site_id: string
  status: GenerationStatus
  created_at: string
  started_at?: string
  finished_at?: string
  started_by: { token_label: string; actor?: Actor }
  error_code?: GenerationErrorCode
  error?: string
  classes: GenerationClass[]
}

export interface Place {
  municipality_id: string
  lat: number | null
  lng: number | null
  facing_deg: number | null
}

export interface StoredGeneration extends Generation {
  digests?: Record<string, { bulletin_id: string; digest: string }>
  place?: Place
  child?: ChildMark
}

export interface JobResult {
  generation_id: string
  started_at: string
  place: Place
  composable?: string[]
  rows: { class: string; bulletin_id?: string; outcome: string }[]
}

export interface SiteGenerations {
  site_id: string
  latest?: StoredGeneration
  previous?: StoredGeneration
  last_result?: JobResult
  last_success?: JobResult
}

interface AgentsGenerationRow {
  class?: unknown
  outcome?: unknown
  bulletin_id?: unknown
  reasons?: unknown
}

const REASON_MAX_CHARS = 300
const UNSAFE_IN_REASON = [
  /[a-z][a-z0-9+.-]*:\/\/\S+/gi,
  /(?<![\w.~-])(?:~|\.{1,2})(?:[\\/][^\s\\/:;,'"]+)+[\\/]?/g,
  /(?<![\w.~-])(?:[A-Za-z]:)?(?:[\\/][^\s\\/:;,'"]+){2,}[\\/]?/g,
  /\b[A-Z][A-Z0-9_]{2,}=\S*/g,
]
const BULLETIN_ID = /^[A-Za-z0-9_-]{1,80}$/

export function placeOf(site: SiteFile): Place {
  return { municipality_id: site.municipality_id, lat: site.lat ?? null, lng: site.lng ?? null, facing_deg: site.facing_deg ?? null }
}

export function samePlace(a: Place, b: Place): boolean {
  return a.municipality_id === b.municipality_id && a.lat === b.lat && a.lng === b.lng && a.facing_deg === b.facing_deg
}

export function generationRecordFile(site: string): string {
  return join(dataDir(), 'live', `${site}.generation.json`)
}

export function isOpen(record: StoredGeneration | undefined): boolean {
  return record?.status === 'queued' || record?.status === 'running'
}

export function restarted(record: StoredGeneration): StoredGeneration {
  const { child: _child, ...rest } = record
  return { ...rest, status: 'failed', error_code: 'server-restarted', error: ERROR_TEXT['server-restarted'] }
}

// Jobs live only in the process that queued them, so a record still open without a job behind it was left by a
// server that stopped.
export async function readGenerationFile(site: string, isActive: (id: string) => boolean): Promise<SiteGenerations> {
  const stored = await readJsonIfExists<SiteGenerations>(generationRecordFile(site))
  if (!stored || stored.site_id !== site) return { site_id: site }
  const settle = (record?: StoredGeneration) => (record && isOpen(record) && !isActive(record.generation_id) ? restarted(record) : record)
  return { ...stored, latest: settle(stored.latest), previous: settle(stored.previous) }
}

export async function readRawGenerationFile(site: string): Promise<SiteGenerations> {
  const stored = await readJsonIfExists<SiteGenerations>(generationRecordFile(site))
  return stored?.site_id === site ? stored : { site_id: site }
}

export async function writeGenerationFile(file: SiteGenerations): Promise<void> {
  const path = generationRecordFile(file.site_id)
  await mkdir(join(dataDir(), 'live'), { recursive: true })
  await writeFile(`${path}.tmp`, `${JSON.stringify(file, null, 2)}\n`)
  await rename(`${path}.tmp`, path)
}

export function publicGeneration({ digests: _digests, place: _place, child: _child, ...generation }: StoredGeneration): Generation {
  return generation
}

export function findGeneration(file: SiteGenerations, id: string): StoredGeneration | undefined {
  return [file.latest, file.previous].find((record) => record?.generation_id === id)
}

export function lastFinished(file: SiteGenerations): StoredGeneration | undefined {
  return [file.latest, file.previous].find((record) => record && !isOpen(record))
}

// The writers below run under the site's lock.
export async function pushGeneration(site: string, record: StoredGeneration, isActive: (id: string) => boolean): Promise<void> {
  const file = await readGenerationFile(site, isActive)
  await writeGenerationFile({ ...file, latest: record, previous: file.latest })
}

export async function updateGeneration(site: string, id: string, change: (record: StoredGeneration) => StoredGeneration, isActive: (id: string) => boolean, results: Pick<SiteGenerations, 'last_result' | 'last_success'> = {}): Promise<void> {
  const file = await readGenerationFile(site, isActive)
  const slot = file.latest?.generation_id === id ? 'latest' : file.previous?.generation_id === id ? 'previous' : undefined
  if (!slot) return
  await writeGenerationFile({ ...file, [slot]: change(file[slot]!), ...results })
}

export function redacted(text: string, maxChars = REASON_MAX_CHARS): string {
  let safe = text
  for (const pattern of UNSAFE_IN_REASON) safe = safe.replace(pattern, '[…]')
  return safe.length > maxChars ? `${safe.slice(0, maxChars - 1)}…` : safe
}

function safeReason(reasons: unknown): string | undefined {
  if (!Array.isArray(reasons) || !reasons.length) return undefined
  return redacted(reasons.map(String).join('; '))
}

export interface GeneratedResult {
  classes: GenerationClass[]
  rows: JobResult['rows']
  composable?: string[]
}

// generation.json is written by the agents: one older than the job, of another site or of another shape is not this
// job's result.
export async function generatedResult(site: string, since: string): Promise<GeneratedResult | undefined> {
  const file = await readJsonIfExists<{ site?: unknown; generated_at?: unknown; composable?: unknown; classes?: unknown }>(siteLayoutsDir(site, 'generation.json')).catch(() => undefined)
  if (!file || file.site !== site || typeof file.generated_at !== 'string' || !(Date.parse(file.generated_at) >= Date.parse(since)) || !Array.isArray(file.classes)) return undefined
  const rows = file.classes as AgentsGenerationRow[]
  if (!rows.every((row) => typeof row?.class === 'string' && typeof row.outcome === 'string' && (row.bulletin_id === undefined || (typeof row.bulletin_id === 'string' && BULLETIN_ID.test(row.bulletin_id))))) return undefined
  return {
    classes: rows.map((row) => {
      const reason = safeReason(row.reasons)
      return {
        class: row.class as string,
        ...(row.bulletin_id ? { bulletin_id: row.bulletin_id as string } : {}),
        synthetic: isSyntheticBulletinId(row.bulletin_id),
        outcome: row.outcome as string,
        ...(reason ? { reason } : {}),
      }
    }),
    rows: rows.map((row) => ({ class: row.class as string, ...(row.bulletin_id ? { bulletin_id: row.bulletin_id as string } : {}), outcome: row.outcome as string })),
    ...(Array.isArray(file.composable) && file.composable.every((c) => typeof c === 'string') ? { composable: file.composable as string[] } : {}),
  }
}
