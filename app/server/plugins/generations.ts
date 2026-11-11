// A server killed outright leaves its job records open and maybe their children running; a server stopped
// normally stops its children, so none of them writes after it is gone.
export default defineNitroPlugin((nitroApp) => {
  void reapAllStale().catch((error: Error) => console.warn(`[generate] startup check failed: ${error.message}`))
  nitroApp.hooks.hook('close', () => stopAllChildren())
})
