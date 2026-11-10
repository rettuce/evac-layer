export default defineNitroPlugin(() => {
  if (import.meta.prerender) return
  migrateLegacyApprovalKeys().then(
    (migrated) => {
      if (migrated) console.warn(`[approvals] ${migrated} approval key(s) of the form <municipality>/<bulletin> rewritten to <site>/<bulletin>`)
    },
    (error: Error) => console.warn(`[approvals] old approval keys not migrated: ${error.message}`),
  )
})
