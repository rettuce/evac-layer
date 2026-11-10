import { createHash, timingSafeEqual } from 'node:crypto'

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

export interface FacilityToken {
  id: string
  label: string
  facility_id: string
  sha256: string
  created_at: string
  expires_at?: string
}

export type AdminPrincipal = { kind: 'operator' } | { kind: 'facility'; facility_id: string; label: string }

export type AdminDecision = AdminPrincipal | 401 | 403

// 'broken' is a ledger that exists but cannot be trusted: it must not read as "no facility tokens", which
// would hand loopback the operator's rights.
export type TokenLedger = readonly FacilityToken[] | 'broken'

const SHA256_HEX = /^[0-9a-f]{64}$/i

const FACILITY_ROUTES: readonly { method: string; path: RegExp }[] = [
  { method: 'GET', path: /^\/api\/admin\/catalog$/ },
  { method: 'POST', path: /^\/api\/admin\/approve$/ },
  { method: 'POST', path: /^\/api\/admin\/site$/ },
  { method: 'GET', path: /^\/api\/admin\/preview-layout$/ },
  { method: 'GET', path: /^\/api\/admin\/subscriptions$/ },
  { method: 'POST', path: /^\/api\/admin\/subscriptions$/ },
  { method: 'DELETE', path: /^\/api\/admin\/subscriptions\/[^/]+$/ },
]

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

export function tokenSha256(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function isFacilityToken(value: unknown): value is FacilityToken {
  if (typeof value !== 'object' || value === null) return false
  const t = value as Record<string, unknown>
  return (
    typeof t.id === 'string' &&
    typeof t.label === 'string' &&
    typeof t.facility_id === 'string' &&
    typeof t.sha256 === 'string' &&
    SHA256_HEX.test(t.sha256) &&
    (t.expires_at === undefined || typeof t.expires_at === 'string')
  )
}

// `doc` is the parsed data/tokens.json, undefined when there is no such file.
export function tokenLedgerFrom(doc: unknown): TokenLedger {
  if (doc === undefined) return []
  const tokens = typeof doc === 'object' && doc !== null ? (doc as { tokens?: unknown }).tokens : undefined
  return Array.isArray(tokens) && tokens.every(isFacilityToken) ? tokens : 'broken'
}

function facilityTokenFor(given: string, tokens: readonly FacilityToken[], now: number): FacilityToken | undefined {
  const digest = Buffer.from(tokenSha256(given), 'hex')
  const match = tokens.find((t) => timingSafeEqual(Buffer.from(t.sha256, 'hex'), digest))
  if (!match) return undefined
  return match.expires_at === undefined || Date.parse(match.expires_at) > now ? match : undefined
}

// A path added later stays closed to facilities until it is listed here with a rule of its own.
export function facilityRouteAllowed(method: string, pathname: string): boolean {
  return FACILITY_ROUTES.some((route) => route.method === method && route.path.test(pathname))
}

// Behind a reverse proxy every client looks like loopback, so such deployments must set a token. A facility
// token switches loopback off too: a request from this machine must not outrank the facilities' credentials.
export function adminPrincipal(req: AdminRequest, operatorToken: string, ledger: TokenLedger, now = Date.now()): AdminDecision {
  const authorization = req.authorization ?? ''
  if (operatorToken && sameToken(authorization.replace(/^Bearer\s+/i, ''), operatorToken)) return { kind: 'operator' }
  if (ledger === 'broken') return 401
  const bearer = /^Bearer\s+(\S+)\s*$/i.exec(authorization)?.[1]
  if (bearer) {
    const facility = facilityTokenFor(bearer, ledger, now)
    if (facility) return { kind: 'facility', facility_id: facility.facility_id, label: facility.label }
  }
  if (operatorToken || ledger.length) return 401
  return LOOPBACK_ADDRESSES.has(req.clientAddress) && isLocalBrowserSafe(req) ? { kind: 'operator' } : 403
}
