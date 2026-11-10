import { join } from 'node:path'
import type { AdminPrincipal, FacilityToken } from '../utils/adminPolicy'

declare module 'h3' {
  interface H3EventContext {
    admin?: AdminPrincipal
  }
}

interface TokensFile {
  version: '0.1'
  tokens: FacilityToken[]
}

// Read on every request so that a token revoked with the CLI stops working at once, without a restart.
async function facilityTokens(): Promise<FacilityToken[]> {
  return (await readJsonIfExists<TokensFile>(join(dataDir(), 'tokens.json')))?.tokens ?? []
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
    await facilityTokens(),
  )
  if (decision === 401) throw createError({ status: 401, statusText: 'Unauthorized' })
  if (decision === 403) {
    throw createError({ status: 403, statusText: 'Forbidden', message: 'admin API is local-only unless NUXT_ADMIN_TOKEN is set' })
  }
  if (decision.kind === 'facility' && !facilityRouteAllowed(event.method, event.path.split('?')[0]!)) {
    throw createError({ status: 403, statusText: 'Forbidden', message: 'this path is for the operator credential only', data: { code: 'operator-only' } })
  }
  event.context.admin = decision
})
