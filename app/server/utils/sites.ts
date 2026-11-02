import { join } from 'node:path'

export interface SiteReplay {
  municipality?: string
  from?: string
  to?: string
  speed?: number
}

export interface SiteFile {
  id: string
  municipality_id: string
  name?: string
  replay?: SiteReplay
}

export async function readSites(): Promise<SiteFile[]> {
  const dir = join(dataDir(), 'sites')
  const files = (await listDir(dir)).filter((f) => f.endsWith('.json'))
  const sites = await Promise.all(files.map((f) => readJsonIfExists<SiteFile>(join(dir, f))))
  return sites.filter((site): site is SiteFile => site !== undefined)
}

export async function readSite(id: string): Promise<SiteFile | undefined> {
  return (await readSites()).find((site) => site.id === id)
}
