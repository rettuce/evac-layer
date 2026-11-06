// Approves every screen bulletin of a site and turns its auto publish on through the admin API of a running
// app, so a fresh checkout shows alerts on /screen. Writes data/approvals.json (outside git) via the server.
//   pnpm -F app demo:approve [site id]      EVAC_URL (default http://127.0.0.1:3150), NUXT_ADMIN_TOKEN if set
const BASE = process.env.EVAC_URL ?? 'http://127.0.0.1:3150'
const SITE = process.argv[2] ?? '05210-demo-honjo-station'
const headers = {
  'content-type': 'application/json',
  ...(process.env.NUXT_ADMIN_TOKEN ? { authorization: `Bearer ${process.env.NUXT_ADMIN_TOKEN}` } : {}),
}

async function call(path, body) {
  const response = await fetch(`${BASE}${path}`, body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers })
  if (!response.ok) throw new Error(`${path} answered ${response.status}: ${await response.text()}`)
  return response.json()
}

const catalog = await call('/api/admin/catalog')
const layouts = catalog.layouts.find((entry) => entry.site_id === SITE)
if (!layouts) throw new Error(`no layouts for site ${SITE} at ${BASE}`)
const bulletins = layouts.entries.filter((entry) => entry.screen).map((entry) => entry.bulletin_id)
for (const bulletin_id of bulletins) await call('/api/admin/approve', { site_id: SITE, bulletin_id, approved: true })
await call('/api/admin/site', { site_id: SITE, auto_publish: true })
console.log(`approved ${bulletins.length} bulletins of ${SITE} and turned its auto publish on (${BASE})`)
console.log(`open ${BASE}/screen?site=${SITE}&mode=live&reset`)
