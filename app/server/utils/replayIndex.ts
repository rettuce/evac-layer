import { join } from 'node:path'
import type { ReplayIndex, ReplayRow, ReplayWindow } from '~~/layout/replay'

interface LayoutIndexFile {
  municipality: string
  name: string
  entries: ReplayRow[]
}

interface AgentsReplayFixture {
  municipality: string
  entries: { issued_at: string; bulletin_id: string; wmo_code: string; municipality_level: number | null; alert: { raw_title: string } }[]
}

const replayOrigins = new Map<string, number>()

export function sharedReplayOrigin(municipality: string, speed: number, window: ReplayWindow, reset: boolean): number {
  const key = `${municipality}:${speed}:${window.from ?? ''}:${window.to ?? ''}`
  if (reset || !replayOrigins.has(key)) replayOrigins.set(key, Date.now())
  return replayOrigins.get(key)!
}

export async function loadReplayIndex(municipality: string): Promise<ReplayIndex | undefined> {
  const index = await readJsonIfExists<LayoutIndexFile>(join(dataDir(), 'layouts', municipality, 'index.json'))
  if (index) return { municipality, name: index.name, rows: index.entries }

  const fixtureDir = join(useRuntimeConfig().repoRoot, 'agents', 'test', 'fixtures')
  const fixtureName = (await listDir(fixtureDir)).find((f) => f.startsWith(`replay-${municipality}-`) && f.endsWith('.json'))
  if (!fixtureName) return undefined
  const fixture = await readJsonIfExists<AgentsReplayFixture>(join(fixtureDir, fixtureName))
  if (!fixture) return undefined
  return {
    municipality,
    name: municipality,
    rows: fixture.entries.map((e) => ({
      issued_at: e.issued_at,
      bulletin_id: e.bulletin_id,
      raw_title: e.alert.raw_title,
      wmo_code: e.wmo_code,
      municipality_level: e.municipality_level,
      screen: true,
    })),
  }
}
