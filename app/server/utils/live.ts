import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface LiveState {
  bulletin_id: string | null
  updated_at: string
}

export function liveStateFile(site: string): string {
  return join(dataDir(), 'live', `${site}.json`)
}

export async function readLiveState(site: string): Promise<LiveState | undefined> {
  return readJsonIfExists<LiveState>(liveStateFile(site))
}

export async function writeLiveState(site: string, bulletinId: string | null): Promise<LiveState> {
  const state: LiveState = { bulletin_id: bulletinId, updated_at: new Date().toISOString() }
  const file = liveStateFile(site)
  await mkdir(join(dataDir(), 'live'), { recursive: true })
  const partial = `${file}.${process.pid}.tmp`
  await writeFile(partial, `${JSON.stringify(state, null, 2)}\n`)
  await rename(partial, file)
  return state
}
