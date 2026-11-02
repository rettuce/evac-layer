import { timingSafeEqual } from 'node:crypto'

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function hostnameOf(hostHeader: string): string {
  return hostHeader.replace(/:\d+$/, '').toLowerCase()
}

// Loopback alone is not proof of the operator: a page in their browser can POST to 127.0.0.1 (CSRF)
// or reach it under a rebound hostname, so the Host, Origin and fetch-site headers must also be local.
function isLocalBrowserSafe(event: Parameters<Parameters<typeof defineEventHandler>[0]>[0]): boolean {
  const host = getHeader(event, 'host') ?? ''
  if (!LOOPBACK_HOSTNAMES.has(hostnameOf(host))) return false
  if (getHeader(event, 'sec-fetch-site') === 'cross-site') return false
  const origin = getHeader(event, 'origin')
  if (origin && new URL(origin).host !== host) return false
  if (event.method === 'POST' && !(getHeader(event, 'content-type') ?? '').startsWith('application/json')) return false
  return true
}

// nuxi dev relays requests to the Nitro worker, so in dev the client address is only in x-forwarded-for.
function clientAddress(event: Parameters<Parameters<typeof defineEventHandler>[0]>[0]): string {
  return getRequestIP(event, { xForwardedFor: import.meta.dev }) ?? ''
}

// Behind a reverse proxy every client looks like loopback, so such deployments must set NUXT_ADMIN_TOKEN.
export default defineEventHandler((event) => {
  if (!event.path.startsWith('/api/admin/')) return
  const expected = useRuntimeConfig().adminToken
  if (expected) {
    const given = (getHeader(event, 'authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (!sameToken(given, expected)) throw createError({ status: 401, statusText: 'Unauthorized' })
    return
  }
  if (!LOOPBACK_ADDRESSES.has(clientAddress(event)) || !isLocalBrowserSafe(event)) {
    throw createError({ status: 403, statusText: 'Forbidden', message: 'admin API is local-only unless NUXT_ADMIN_TOKEN is set' })
  }
})
