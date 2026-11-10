import { join } from 'node:path'
import type { AdminPrincipal, TokenLedger } from '../utils/adminPolicy'

declare module 'h3' {
  interface H3EventContext {
    admin?: AdminPrincipal
  }
}

let reportedBroken = false

// Read on every request so that a token revoked with the CLI stops working at once, without a restart.
async function tokenLedger(): Promise<TokenLedger> {
  let ledger: TokenLedger
  try {
    ledger = tokenLedgerFrom(await readJsonIfExists<unknown>(join(dataDir(), 'tokens.json')))
  } catch {
    ledger = 'broken'
  }
  if (ledger === 'broken' && !reportedBroken) console.warn('[admin] data/tokens.json cannot be read as a token ledger: facility tokens and loopback access are off until it is fixed')
  reportedBroken = ledger === 'broken'
  return ledger
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
    await tokenLedger(),
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
