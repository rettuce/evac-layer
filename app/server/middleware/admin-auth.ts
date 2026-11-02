import { timingSafeEqual } from 'node:crypto'

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
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
  if (!LOOPBACK.has(event.node.req.socket.remoteAddress ?? '')) {
    throw createError({ status: 403, statusText: 'Forbidden', message: 'admin API is loopback-only unless NUXT_ADMIN_TOKEN is set' })
  }
})
