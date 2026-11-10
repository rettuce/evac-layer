// A refused request never reaches afterResponse (the error handler answers it), so failures are taken from the
// error hook. recordAudit writes each request at most once.
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('afterResponse', (event) => recordAudit(event, event.node.res.statusCode))
  nitroApp.hooks.hook('error', (error, { event }) => {
    if (event) return recordAudit(event, (error as { statusCode?: number }).statusCode ?? 500)
  })
})
