// A server killed outright leaves its job records open and maybe their children running; a server stopped
// normally stops its children, so none of them writes after it is gone.
export default defineNitroPlugin((nitroApp) => {
  void (async () => {
    await removeStaleWorkDirs()
    await reapAllStale()
    await reapExportChildren()
    await liveOrphans()
  })().catch((error: Error) => console.warn(`[agents] startup check failed: ${error.message}`))
  nitroApp.hooks.hook('close', () => stopAllChildren())
})
