import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { alertFeed, ambientFeed, type Feed, type FeedAsset, type FeedSite } from '~~/layout/feed'
import { type ApprovedBy, type Approvals, classKey, layoutKey, liveLayoutGateWith } from '~~/layout/gate'
import { DEFAULT_REPLAY_SPEED, currentBulletinAt, rowsInWindow, type ReplayWindow } from '~~/layout/replay'
import { SHAPES, isShape } from '~~/layout/shapes'
import type { EvacScreen, Shape } from '~~/layout/types'

const ALL_SHAPES = Object.keys(SHAPES) as Shape[]

export function distDir(): string {
  const config = useRuntimeConfig()
  return config.distDir || join(config.repoRoot, 'dist')
}

export function deliveryAssetUrl(site: string, bulletin: string, file: string): string {
  return `/delivery/${encodeURIComponent(site)}/${encodeURIComponent(bulletin)}/${file}`
}

async function shapesWithLayout(site: string, bulletin: string): Promise<Shape[]> {
  const files = await listDir(siteLayoutsDir(site, bulletin))
  return ALL_SHAPES.filter((shape) => files.includes(`${shape}.json`))
}

async function readScreens(site: string, bulletin: string): Promise<Partial<Record<Shape, EvacScreen>>> {
  const layouts: Partial<Record<Shape, EvacScreen>> = {}
  for (const shape of await shapesWithLayout(site, bulletin)) {
    const screen = await readJsonIfExists<EvacScreen>(siteLayoutsDir(site, bulletin, `${shape}.json`))
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

export async function approvalOf(approvals: Approvals, site: string, bulletin: string): Promise<{ by: ApprovedBy; updated_at?: string; approved_from?: string }> {
  const digest = await currentLayoutDigest(site, bulletin)
  if (digest === undefined) return { by: null }
  const cls = await currentClassOf(site, bulletin)
  const { gate, by } = liveLayoutGateWith(approvals, site, bulletin, digest, cls)
  if (gate !== 'ok') return { by: null }
  if (by === 'bulletin') return { by, updated_at: approvals.layouts[layoutKey(site, bulletin)]!.updated_at }
  const record = approvals.classes![classKey(site, cls!.key)]!
  return { by, updated_at: record.updated_at, approved_from: record.approved_from }
}

async function deliverableWith(approvals: Approvals, site: string, bulletin: string): Promise<boolean> {
  return (await approvalOf(approvals, site, bulletin)).by !== null
}

export async function isDeliverable(site: string, bulletin: string): Promise<boolean> {
  return (await readSite(site)) !== undefined && deliverableWith(await readApprovals(), site, bulletin)
}

export function replayWindowOf(site: SiteFile): { window: ReplayWindow; speed: number } {
  return { window: { from: site.replay?.from, to: site.replay?.to }, speed: site.replay?.speed ?? DEFAULT_REPLAY_SPEED }
}

async function replayedBulletin(site: SiteFile, approvals: Approvals): Promise<string | undefined> {
  const replay = await loadReplayIndex(site)
  if (!replay) return undefined
  const { window, speed } = replayWindowOf(site)
  const rows = rowsInWindow(replay.rows, window)
  const deliverable = await Promise.all(
    rows.filter((row) => row.screen).map(async (row) => ((await deliverableWith(approvals, site.id, row.bulletin_id)) ? row.bulletin_id : undefined)),
  )
  const available = new Set(deliverable.filter((id) => id !== undefined))
  const elapsedMs = Date.now() - sharedReplayOrigin(site.id, speed, window, false)
  return currentBulletinAt(rows, elapsedMs, speed, (id) => available.has(id))
}

async function liveBulletin(site: SiteFile, approvals: Approvals): Promise<string | undefined> {
  const bulletin = (await readLiveState(site.id))?.bulletin_id
  return bulletin && (await deliverableWith(approvals, site.id, bulletin)) ? bulletin : undefined
}

export async function currentFeed(siteId: string): Promise<Feed | undefined> {
  const site = await readSite(siteId)
  if (!site) return undefined
  const feedSite: FeedSite = { id: site.id, municipality_id: site.municipality_id, ...(site.name ? { name: site.name } : {}) }
  const approvals = await readApprovals()
  const bulletin = site.replay ? await replayedBulletin(site, approvals) : await liveBulletin(site, approvals)
  if (!bulletin) return ambientFeed(feedSite)
  const { updated_at: approvedAt } = await approvalOf(approvals, site.id, bulletin)
  return alertFeed(feedSite, await readScreens(site.id, bulletin), await readAssets(site.id, bulletin), approvedAt!)
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
