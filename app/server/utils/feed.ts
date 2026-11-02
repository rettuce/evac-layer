import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { alertFeed, ambientFeed, type Feed, type FeedAsset, type FeedSite } from '~~/layout/feed'
import { layoutKey, liveLayoutGate } from '~~/layout/gate'
import { DEFAULT_REPLAY_SPEED, currentBulletinAt, rowsInWindow, type ReplayWindow } from '~~/layout/replay'
import { PANEL_SHAPES, isShape } from '~~/layout/shapes'
import type { EvacScreen, Shape } from '~~/layout/types'

const ALL_SHAPES = PANEL_SHAPES

export function distDir(): string {
  const config = useRuntimeConfig()
  return config.distDir || join(config.repoRoot, 'dist')
}

export function deliveryAssetUrl(site: string, bulletin: string, file: string): string {
  return `/delivery/${encodeURIComponent(site)}/${encodeURIComponent(bulletin)}/${file}`
}

async function shapesWithLayout(municipality: string, bulletin: string): Promise<Shape[]> {
  const files = await listDir(join(dataDir(), 'layouts', municipality, bulletin))
  return ALL_SHAPES.filter((shape) => files.includes(`${shape}.json`))
}

async function readScreens(municipality: string, bulletin: string): Promise<Partial<Record<Shape, EvacScreen>>> {
  const layouts: Partial<Record<Shape, EvacScreen>> = {}
  for (const shape of await shapesWithLayout(municipality, bulletin)) {
    const screen = await readJsonIfExists<EvacScreen>(join(dataDir(), 'layouts', municipality, bulletin, `${shape}.json`))
    if (screen) layouts[shape] = screen
  }
  return layouts
}

async function readAssets(site: string, bulletin: string): Promise<Partial<Record<Shape, FeedAsset>>> {
  const files = await listDir(join(distDir(), site, bulletin))
  const assets: Partial<Record<Shape, FeedAsset>> = {}
  for (const shape of ALL_SHAPES) {
    if (files.includes(`${shape}.png`) && files.includes(`${shape}.html`)) {
      assets[shape] = { png: deliveryAssetUrl(site, bulletin, `${shape}.png`), html: deliveryAssetUrl(site, bulletin, `${shape}.html`) }
    }
  }
  return assets
}

export async function isDeliverable(site: string, bulletin: string): Promise<boolean> {
  const siteFile = await readSite(site)
  if (!siteFile) return false
  const municipality = siteFile.replay?.municipality ?? siteFile.municipality_id
  return liveLayoutGate(await readApprovals(), site, municipality, bulletin) === 'ok'
}

export async function currentFeed(siteId: string): Promise<Feed | undefined> {
  const site = await readSite(siteId)
  if (!site) return undefined
  const feedSite: FeedSite = { id: site.id, municipality_id: site.municipality_id, ...(site.name ? { name: site.name } : {}) }
  const municipality = site.replay?.municipality ?? site.municipality_id
  const replay = await loadReplayIndex(municipality)
  if (!replay) return ambientFeed(feedSite)

  const window: ReplayWindow = { from: site.replay?.from, to: site.replay?.to }
  const speed = site.replay?.speed ?? DEFAULT_REPLAY_SPEED
  const rows = rowsInWindow(replay.rows, window)
  const approvals = await readApprovals()
  const gated = rows.filter((row) => row.screen && liveLayoutGate(approvals, site.id, municipality, row.bulletin_id) === 'ok')
  const withLayouts = await Promise.all(gated.map(async (row) => ((await shapesWithLayout(municipality, row.bulletin_id)).length ? row.bulletin_id : undefined)))
  const available = new Set(withLayouts.filter((id) => id !== undefined))

  const elapsedMs = Date.now() - sharedReplayOrigin(municipality, speed, window, false)
  const bulletin = currentBulletinAt(rows, elapsedMs, speed, (id) => available.has(id))
  if (!bulletin) return ambientFeed(feedSite)
  const approvedAt = approvals.layouts[layoutKey(municipality, bulletin)]!.updated_at
  return alertFeed(feedSite, await readScreens(municipality, bulletin), await readAssets(site.id, bulletin), approvedAt)
}

export function feedEtag(body: string): string {
  return `"${createHash('sha256').update(body).digest('hex').slice(0, 32)}"`
}

export function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false
  return ifNoneMatch.split(',').some((tag) => {
    const trimmed = tag.trim()
    return trimmed === '*' || trimmed.replace(/^W\//, '') === etag
  })
}

export function isDeliveryFile(file: string): boolean {
  const match = /^([0-9x]+)\.(png|html|json)$/.exec(file)
  return match !== null && isShape(match[1])
}
