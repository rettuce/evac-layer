export const LAYOUT_STORE_PREFIXES = ['/api/live-layout?', '/api/admin/preview-layout?'] as const
export const DEMO_SITES_DIR = 'demo/sites/'
export const DEMO_SITE_LAYOUT_ENDPOINT = '/api/demo-site-layout'

export function isDemoSitePath(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith(DEMO_SITES_DIR) || !value.endsWith('.json')) return false
  const segments = value.slice(DEMO_SITES_DIR.length).split('/')
  return !value.includes('\\') && segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

export type LayoutSource = { url: string; origin: 'layout-store' | 'demo-sites' | 'dev' }

export function resolveLayoutSrc(value: unknown, dev: boolean): LayoutSource | undefined {
  if (typeof value === 'string' && value.startsWith(DEMO_SITES_DIR)) {
    return { url: `${DEMO_SITE_LAYOUT_ENDPOINT}?path=${encodeURIComponent(value)}`, origin: 'demo-sites' }
  }
  if (!isTrustedLayoutSrc(value, dev)) return undefined
  return { url: value, origin: LAYOUT_STORE_PREFIXES.some((prefix) => value.startsWith(prefix)) ? 'layout-store' : 'dev' }
}

// Guidance screens must never show a document from another origin; production accepts only the layout store.
export function isTrustedLayoutSrc(value: unknown, dev: boolean): value is string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return false
  return dev || LAYOUT_STORE_PREFIXES.some((prefix) => value.startsWith(prefix))
}
