import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type LiveState, nextLiveState } from '~~/layout/liveState'

export type { LiveState }

export function liveStateFile(site: string): string {
  return join(dataDir(), 'live', `${site}.json`)
}

export async function readLiveState(site: string): Promise<LiveState | undefined> {
  return readJsonIfExists<LiveState>(liveStateFile(site))
}

export async function writeLiveState(site: string, bulletinId: string | null): Promise<LiveState> {
  const state = nextLiveState(await readLiveState(site), bulletinId, new Date().toISOString())
  const file = liveStateFile(site)
  await mkdir(join(dataDir(), 'live'), { recursive: true })
  const partial = `${file}.${process.pid}.tmp`
  await writeFile(partial, `${JSON.stringify(state, null, 2)}\n`)
  await rename(partial, file)
  return state
}
