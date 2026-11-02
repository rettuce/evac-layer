import { timingSafeEqual } from 'node:crypto'

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

export interface AdminRequest {
  method: string
  clientAddress: string
  host?: string
  origin?: string
  secFetchSite?: string
  contentType?: string
  authorization?: string
}

export type AdminDecision = 'allow' | 401 | 403

// nuxi dev relays requests to the Nitro worker, so the real client is the entry the relay appended to
// x-forwarded-for (the right-most one). Only a relay on this machine is trusted to have appended it.
export function clientAddressFor(peer: string | undefined, forwardedFor: string | undefined, dev: boolean): string {
  if (!dev) return peer ?? ''
  if (peer && !LOOPBACK_ADDRESSES.has(peer)) return peer
  const appended = forwardedFor?.split(',').at(-1)?.trim()
  return appended || peer || ''
}

function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function hostnameOf(host: string): string {
  return host.replace(/:\d+$/, '').toLowerCase()
}

// Loopback alone is not proof of the operator: a page in their browser can POST to 127.0.0.1 (CSRF)
// or reach it under a rebound hostname, so the Host, Origin and fetch-site headers must also be local.
function isLocalBrowserSafe(req: AdminRequest): boolean {
  const host = req.host ?? ''
  if (!LOOPBACK_HOSTNAMES.has(hostnameOf(host))) return false
  if (req.secFetchSite === 'cross-site') return false
  if (req.origin) {
    try {
      if (new URL(req.origin).host !== host) return false
    } catch {
      return false
    }
  }
  if (req.method === 'POST' && !(req.contentType ?? '').startsWith('application/json')) return false
  return true
}

// Behind a reverse proxy every client looks like loopback, so such deployments must set a token.
export function adminAccess(req: AdminRequest, token: string): AdminDecision {
  if (token) return sameToken((req.authorization ?? '').replace(/^Bearer\s+/i, ''), token) ? 'allow' : 401
  return LOOPBACK_ADDRESSES.has(req.clientAddress) && isLocalBrowserSafe(req) ? 'allow' : 403
}
