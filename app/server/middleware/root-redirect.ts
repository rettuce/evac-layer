// The app has no landing page: an operator who opens the bare origin lands on the approvals. Static
// generation (GitHub Pages) still writes its own `/`.
export default defineEventHandler((event) => {
  if (import.meta.prerender || getRequestURL(event).pathname !== '/') return
  return sendRedirect(event, '/admin', 302)
})
