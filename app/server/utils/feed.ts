import { createHash } from 'node:crypto'
import type { H3Event } from 'h3'
import { join } from 'node:path'
import { alertFeed, ambientFeed, type Feed, type FeedAsset, type FeedSite } from '~~/layout/feed'
import { type ApprovedBy, type Approvals, classApprovable, classKey, layoutKey, liveLayoutGateWith } from '~~/layout/gate'
import { DEFAULT_REPLAY_SPEED, currentBulletinAt, rowsInWindow, type ReplayWindow } from '~~/layout/replay'
import { SHAPES, isShape } from '~~/layout/shapes'
import type { EvacScreen, Shape } from '~~/layout/types'
import type { LayoutSnapshot } from './approvals'
import { firstDeliverable } from '~~/layout/liveState'

const ALL_SHAPES = Object.keys(SHAPES) as Shape[]

export function distDir(): string {
  const config = useRuntimeConfig()
  return config.distDir || join(config.repoRoot, 'dist')
}

export function deliveryAssetUrl(site: string, bulletin: string, file: string): string {
  return `/delivery/${encodeURIComponent(site)}/${encodeURIComponent(bulletin)}/${file}`
}

function screensOf(snapshot: LayoutSnapshot): Partial<Record<Shape, EvacScreen>> {
  const layouts: Partial<Record<Shape, EvacScreen>> = {}
  for (const shape of ALL_SHAPES) {
    const file = snapshot.files.find((f) => f.shape === shape)
    if (file) layouts[shape] = JSON.parse(file.body) as EvacScreen
  }
  return layouts
}

// Files rendered from other layout bytes than the ones on the feed are an older screen, so they are not linked.
async function readAssets(site: string, bulletin: string, digest: string): Promise<Partial<Record<Shape, FeedAsset>>> {
  if ((await exportedDigest(site, bulletin)) !== digest) return {}
  const files = await listDir(join(distDir(), site, bulletin))
  const assets: Partial<Record<Shape, FeedAsset>> = {}
  for (const shape of ALL_SHAPES) {
    if (files.includes(`${shape}.png`) && files.includes(`${shape}.html`)) {
      assets[shape] = { png: deliveryAssetUrl(site, bulletin, `${shape}.png`), html: deliveryAssetUrl(site, bulletin, `${shape}.html`) }
    }
  }
  return assets
}

function approvalIn(approvals: Approvals, site: string, bulletin: string, snapshot: LayoutSnapshot | undefined): { by: ApprovedBy; updated_at?: string } {
  if (!snapshot) return { by: null }
  const { gate, by } = liveLayoutGateWith(approvals, site, bulletin, snapshot.digest, snapshot.cls)
  if (gate !== 'ok') return { by: null }
  if (by === 'bulletin') return { by, updated_at: approvals.layouts[layoutKey(site, bulletin)]!.updated_at }
  return { by, updated_at: approvals.classes![classKey(site, snapshot.cls.key)]!.updated_at }
}

export async function deliverableDigest(approvals: Approvals, site: string, bulletin: string): Promise<string | undefined> {
  const snapshot = await readLayoutSnapshot(site, bulletin)
  return approvalIn(approvals, site, bulletin, snapshot).by === null ? undefined : snapshot!.digest
}

async function deliverableWith(approvals: Approvals, site: string, bulletin: string): Promise<boolean> {
  return (await deliverableDigest(approvals, site, bulletin)) !== undefined
}

// A drill or test bulletin is shown only by a site that replays a recording. One posted to a live site before that was
// refused, or approved on its own and left as the live or fallback bulletin, is not delivered there.
export function onLiveSite(snapshot: LayoutSnapshot | undefined): boolean {
  return snapshot !== undefined && classApprovable(snapshot.cls.key)
}

async function liveDeliverableWith(approvals: Approvals, site: string, bulletin: string): Promise<boolean> {
  const snapshot = await readLayoutSnapshot(site, bulletin)
  return onLiveSite(snapshot) && approvalIn(approvals, site, bulletin, snapshot).by !== null
}

export async function isLiveDeliverable(site: string, bulletin: string): Promise<boolean> {
  return (await readSite(site)) !== undefined && liveDeliverableWith(await readApprovals(), site, bulletin)
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

export async function liveBulletin(site: SiteFile, approvals: Approvals): Promise<string | undefined> {
  return firstDeliverable(await readLiveState(site.id), (id) => liveDeliverableWith(approvals, site.id, id))
}

export async function currentFeed(siteId: string, found?: (site: SiteFile) => void): Promise<Feed | undefined> {
  const site = await readSite(siteId)
  if (!site) return undefined
  found?.(site)
  const receivedAt = await lastReceivedAt(site.id)
  const feed = await feedFor(site)
  return receivedAt ? { ...feed, last_received_at: receivedAt } : feed
}

async function lastReceivedAt(siteId: string): Promise<string | undefined> {
  const state = await readJsonIfExists<{ received_at?: unknown }>(join(dataDir(), 'live', `${siteId}.receiver.json`))
  return typeof state?.received_at === 'string' ? state.received_at : undefined
}

async function feedFor(site: SiteFile): Promise<Feed> {
  const feedSite: FeedSite = { id: site.id, municipality_id: site.municipality_id, ...(site.name ? { name: site.name } : {}) }
  const approvals = await readApprovals()
  const bulletin = site.replay ? await replayedBulletin(site, approvals) : await liveBulletin(site, approvals)
  if (!bulletin) return ambientFeed(feedSite)
  const snapshot = await readLayoutSnapshot(site.id, bulletin)
  const approval = approvalIn(approvals, site.id, bulletin, snapshot)
  if (!snapshot || !approval.by) return ambientFeed(feedSite)
  return alertFeed(feedSite, screensOf(snapshot), await readAssets(site.id, bulletin, snapshot.digest), approval.updated_at!)
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

export function feedResponse(event: H3Event, feed: Feed, contentLocation?: string): string | null {
  const body = JSON.stringify(feed)
  const etag = feedEtag(body)
  setResponseHeaders(event, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': contentLocation ? 'ETag, Content-Location' : 'ETag',
    'Cache-Control': 'no-cache',
    ETag: etag,
    ...(contentLocation ? { 'Content-Location': contentLocation } : {}),
  })
  if (etagMatches(getHeader(event, 'if-none-match'), etag)) {
    setResponseStatus(event, 304)
    return null
  }
  setResponseHeader(event, 'Content-Type', 'application/json; charset=utf-8')
  return body
}

export function isDeliveryFile(file: string): boolean {
  const match = /^([0-9a-z]+)\.(png|html|json)$/.exec(file)
  return match !== null && isShape(match[1])
}
