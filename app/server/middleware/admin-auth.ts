export default defineEventHandler((event) => {
  if (!event.path.startsWith('/api/admin/')) return
  const decision = adminAccess(
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
  )
  if (decision === 401) throw createError({ status: 401, statusText: 'Unauthorized' })
  if (decision === 403) {
    throw createError({ status: 403, statusText: 'Forbidden', message: 'admin API is local-only unless NUXT_ADMIN_TOKEN is set' })
  }
})
