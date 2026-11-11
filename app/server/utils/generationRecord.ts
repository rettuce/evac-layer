import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isSyntheticBulletinId } from '~~/layout/gate'
import type { Actor } from './audit'

export type GenerationStatus = 'queued' | 'running' | 'done' | 'failed'

export interface GenerationClass {
  class: string
  bulletin_id?: string
  synthetic: boolean
  outcome: string
  reason?: string
  preview_error?: string
}

export interface Generation {
  generation_id: string
  site_id: string
  status: GenerationStatus
  created_at: string
  started_at?: string
  finished_at?: string
  started_by: { token_label: string; actor?: Actor }
  error?: string
  classes: GenerationClass[]
}

// `digests` holds each class's layout digest when the job started, which `unchanged` compares against.
export interface StoredGeneration extends Generation {
  digests?: Record<string, string>
}

export interface SiteGenerations {
  site_id: string
  latest?: StoredGeneration
  previous?: StoredGeneration
  last_success_started_at?: string
}

interface AgentsGenerationRow {
  class: string
  outcome: string
  bulletin_id?: string
  reasons?: string[]
}

export const SERVER_RESTARTED = 'server restarted'

export function generationRecordFile(site: string): string {
  return join(dataDir(), 'live', `${site}.generation.json`)
}

// Jobs live only in the process that queued them, so a record still queued or running without a job behind it
// was left by a server that stopped.
function settled(record: StoredGeneration | undefined, isActive: (id: string) => boolean): StoredGeneration | undefined {
  if (!record || (record.status !== 'queued' && record.status !== 'running') || isActive(record.generation_id)) return record
  return { ...record, status: 'failed', error: SERVER_RESTARTED }
}

export async function readGenerationFile(site: string, isActive: (id: string) => boolean): Promise<SiteGenerations> {
  const stored = await readJsonIfExists<SiteGenerations>(generationRecordFile(site))
  if (!stored || stored.site_id !== site) return { site_id: site }
  return { ...stored, latest: settled(stored.latest, isActive), previous: settled(stored.previous, isActive) }
}

async function writeGenerationFile(file: SiteGenerations): Promise<void> {
  const path = generationRecordFile(file.site_id)
  await mkdir(join(dataDir(), 'live'), { recursive: true })
  await writeFile(`${path}.tmp`, `${JSON.stringify(file, null, 2)}\n`)
  await rename(`${path}.tmp`, path)
}

export function publicGeneration({ digests: _digests, ...generation }: StoredGeneration): Generation {
  return generation
}

export function findGeneration(file: SiteGenerations, id: string): StoredGeneration | undefined {
  return [file.latest, file.previous].find((record) => record?.generation_id === id)
}

// Call these under the site's lock.
export async function pushGeneration(site: string, record: StoredGeneration, isActive: (id: string) => boolean): Promise<void> {
  const file = await readGenerationFile(site, isActive)
  await writeGenerationFile({ ...file, latest: record, previous: file.latest })
}

export async function updateGeneration(site: string, id: string, change: (record: StoredGeneration) => StoredGeneration, isActive: (id: string) => boolean): Promise<void> {
  const file = await readGenerationFile(site, isActive)
  const slot = file.latest?.generation_id === id ? 'latest' : file.previous?.generation_id === id ? 'previous' : undefined
  if (!slot) return
  const record = change(file[slot]!)
  const succeeded = record.status === 'done' && record.started_at
  await writeGenerationFile({ ...file, [slot]: record, ...(succeeded ? { last_success_started_at: record.started_at } : {}) })
}

// generation.json is written by the agents; one older than the job is what an earlier run left.
export async function generatedClasses(site: string, since: string): Promise<GenerationClass[] | undefined> {
  const file = await readJsonIfExists<{ generated_at?: string; classes?: AgentsGenerationRow[] }>(siteLayoutsDir(site, 'generation.json')).catch(() => undefined)
  if (!Array.isArray(file?.classes) || !file.generated_at || !(Date.parse(file.generated_at) >= Date.parse(since))) return undefined
  return file.classes.map((row) => ({
    class: String(row.class),
    ...(row.bulletin_id ? { bulletin_id: String(row.bulletin_id) } : {}),
    synthetic: isSyntheticBulletinId(row.bulletin_id),
    outcome: String(row.outcome),
    ...(row.reasons?.length ? { reason: row.reasons.join('; ') } : {}),
  }))
}
