import { join } from 'node:path'
import type { ReplayIndex, ReplayRow, ReplayWindow } from '~~/layout/replay'

export interface LayoutIndexFile {
  municipality: string
  name: string
  site?: string
  writer_note?: string
  entries: ReplayRow[]
}

interface AgentsReplayFixture {
  municipality: string
  entries: { issued_at: string; bulletin_id: string; wmo_code: string; municipality_level: number | null; alert: { raw_title: string } }[]
}

const replayOrigins = new Map<string, number>()

export function sharedReplayOrigin(site: string, speed: number, window: ReplayWindow, reset: boolean): number {
  const key = `${site}:${speed}:${window.from ?? ''}:${window.to ?? ''}`
  if (reset || !replayOrigins.has(key)) replayOrigins.set(key, Date.now())
  return replayOrigins.get(key)!
}

export async function readLayoutIndex(site: string): Promise<LayoutIndexFile | undefined> {
  return readJsonIfExists<LayoutIndexFile>(siteLayoutsDir(site, 'index.json'))
}

// The agents test fixtures stand in for a missing index only on a development server: in production
// a test file must never decide what a screen shows.
async function devFixtureIndex(municipality: string): Promise<ReplayIndex | undefined> {
  if (!import.meta.dev) return undefined
  const fixtureDir = join(useRuntimeConfig().repoRoot, 'agents', 'test', 'fixtures')
  const fixtureName = (await listDir(fixtureDir)).find((f) => f.startsWith(`replay-${municipality}-`) && f.endsWith('.json'))
  const fixture = fixtureName && (await readJsonIfExists<AgentsReplayFixture>(join(fixtureDir, fixtureName)))
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

export async function loadReplayIndex(site: SiteFile): Promise<ReplayIndex | undefined> {
  const index = await readLayoutIndex(site.id)
  if (index) return { municipality: index.municipality, name: index.name, rows: index.entries }
  return devFixtureIndex(site.replay?.municipality ?? site.municipality_id)
}
