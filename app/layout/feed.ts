import type { EvacScreen, ScreenSource, Shape, TemplateId } from './types'

export const FEED_VERSION = '0.1'

export interface FeedSite {
  id: string
  municipality_id: string
  name?: string
}

export interface FeedAsset {
  png: string
  html: string
}

export interface Feed {
  feed_version: typeof FEED_VERSION
  site: FeedSite
  state: 'ambient' | 'alert'
  alert: { source: 'jma'; bulletin_id: string; hazard: string; level: number; issued_at: string; template: TemplateId } | null
  bulletin_id: string | null
  issued_at: string | null
  layouts: Partial<Record<Shape, EvacScreen>>
  assets: Partial<Record<Shape, FeedAsset>>
  sources: ScreenSource[]
  approved_at: string | null
}

export type FeedEvent = 'alert' | 'clear'

export function ambientFeed(site: FeedSite): Feed {
  return {
    feed_version: FEED_VERSION,
    site,
    state: 'ambient',
    alert: null,
    bulletin_id: null,
    issued_at: null,
    layouts: {},
    assets: {},
    sources: [],
    approved_at: null,
  }
}

export function alertFeed(
  site: FeedSite,
  layouts: Partial<Record<Shape, EvacScreen>>,
  assets: Partial<Record<Shape, FeedAsset>>,
  approvedAt: string,
): Feed {
  const first = Object.values(layouts)[0]
  if (!first) throw new Error('an alert feed needs at least one layout')
  const { bulletin_id, hazard, level, issued_at } = first.alert
  return {
    feed_version: FEED_VERSION,
    site,
    state: 'alert',
    alert: { source: 'jma', bulletin_id, hazard, level, issued_at, template: first.template },
    bulletin_id,
    issued_at,
    layouts,
    assets,
    sources: first.sources,
    approved_at: approvedAt,
  }
}

export function feedEvent(feed: Feed): FeedEvent {
  return feed.state === 'alert' ? 'alert' : 'clear'
}

export const WEBHOOK_RETRIES = 5
export const WEBHOOK_FIRST_RETRY_MS = 1000

export function webhookRetryDelayMs(retry: number): number {
  return WEBHOOK_FIRST_RETRY_MS * 2 ** retry
}
