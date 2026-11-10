const SWEEP_INTERVAL_MS = 5000

export default defineNitroPlugin((nitroApp) => {
  let sweeping = false

  async function sweep() {
    if (sweeping) return
    sweeping = true
    try {
      await exportShownBulletins()
    } catch (error) {
      console.warn(`[export] sweep failed: ${(error as Error).message}`)
    } finally {
      sweeping = false
    }
  }

  const timer = setInterval(sweep, SWEEP_INTERVAL_MS)
  nitroApp.hooks.hook('close', () => clearInterval(timer))
})
