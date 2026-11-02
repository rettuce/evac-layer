export interface Approvals {
  version: '0.1'
  layouts: Record<string, { approved: boolean; updated_at: string }>
  sites: Record<string, { auto_publish: boolean; updated_at: string }>
}

export function layoutKey(municipality: string, bulletinId: string): string {
  return `${municipality}/${bulletinId}`
}

export type LiveLayoutGate = 'ok' | 'auto-publish-off' | 'unapproved'

// Screens only ever show layouts an operator approved, and only at sites with auto publish on.
export function liveLayoutGate(approvals: Approvals, site: string | undefined, municipality: string, bulletinId: string): LiveLayoutGate {
  if (!site || !approvals.sites[site]?.auto_publish) return 'auto-publish-off'
  if (!approvals.layouts[layoutKey(municipality, bulletinId)]?.approved) return 'unapproved'
  return 'ok'
}
