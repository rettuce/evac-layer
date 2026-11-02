export const LAYOUT_STORE_PREFIXES = ['/api/live-layout?', '/api/admin/preview-layout?'] as const

// Guidance screens must never show a document from another origin; production accepts only the layout store.
export function isTrustedLayoutSrc(value: unknown, dev: boolean): value is string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return false
  return dev || LAYOUT_STORE_PREFIXES.some((prefix) => value.startsWith(prefix))
}
