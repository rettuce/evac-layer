import type { AdminPrincipal } from '../utils/adminPolicy'
import type { AuditContext } from '../utils/audit'

declare module 'h3' {
  interface H3EventContext {
    admin?: AdminPrincipal
  }
}

export default defineEventHandler(async (event) => {
  if (!event.path.startsWith('/api/admin/')) return
  const decision = adminPrincipal(
    {
      method: event.method,
      clientAddress: clientAddressFor(event.node.req.socket.remoteAddress, getHeader(event, 'x-forwarded-for'), import.meta.dev),
      host: getHeader(event, 'host'),
      origin: getHeader(event, 'origin'),
      secFetchSite: getHeader(event, 'sec-fetch-site'),
      contentType: getHeader(event, 'content-type'),
      authorization: getHeader(event, 'authorization'),
    },
    useRuntimeConfig().adminToken,
    await readTokenLedger(),
  )
  if (decision === 401) throw createError({ status: 401, statusText: 'Unauthorized' })
  if (decision === 403) {
    throw createError({ status: 403, statusText: 'Forbidden', message: 'admin API is local-only unless NUXT_ADMIN_TOKEN is set' })
  }
  const path = event.path.split('?')[0]!
  if (changesState(event.method)) {
    const audit: AuditContext = { principal: decision }
    event.context.audit = audit
    const body = await readBody(event)
    audit.site_id = siteIdOf(path, body)
    audit.actor = actorOf(body, { id: getHeader(event, 'x-evaclayer-actor-id'), name: getHeader(event, 'x-evaclayer-actor-name') })
  }
  if (decision.kind === 'facility' && !facilityRouteAllowed(event.method, path)) {
    throw createError({ status: 403, statusText: 'Forbidden', message: 'this path is for the operator credential only', data: { code: 'operator-only' } })
  }
  event.context.admin = decision
})
