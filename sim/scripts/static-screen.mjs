// Writes the JSON the static /screen (GitHub Pages) reads instead of /api/replay and /api/live-layout:
// one file per query the simulator makes, under app/public/static/. Run against a dev server that has
// the replay data; the bulletins of the EVAC window are approved first (loopback admin API).
//
//   node sim/scripts/static-screen.mjs [http://127.0.0.1:3153]
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const BASE = process.argv[2] ?? process.env.VITE_SCREEN_ORIGIN ?? 'http://127.0.0.1:3153'
const OUT = fileURLToPath(new URL('../../app/public/static/', import.meta.url))
const MUNICIPALITY = '05210'
const SITE_ID = '05210-demo-honjo-station'
const SPEED = '1'
const WINDOWS = {
  calm: { from: '2026-10-15T00:00+09:00', to: '2026-10-15T06:00+09:00' },
  evac: { from: '2026-10-21T18:10+09:00', to: '2026-10-21T19:40+09:00' },
}
const SHAPES = ['pillar', '9x16', '32x9']

// The same key the app builds in static mode (app/app/composables/staticScreen.ts).
export const staticKey = (params) => params.toString().replace(/[^A-Za-z0-9.-]+/g, '_')

const adminHeaders = { 'content-type': 'application/json', Origin: BASE, 'Sec-Fetch-Site': 'same-origin' }

async function post(path, body) {
  const response = await fetch(`${BASE}${path}`, { method: 'POST', headers: adminHeaders, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`${path} answered ${response.status}`)
}

async function getJson(path) {
  const response = await fetch(`${BASE}${path}`)
  if (!response.ok) throw new Error(`${path} answered ${response.status}`)
  return response.json()
}

async function save(kind, params, data) {
  const dir = `${OUT}${kind}/`
  await mkdir(dir, { recursive: true })
  const file = `${dir}${staticKey(params)}.json`
  await writeFile(file, JSON.stringify(data))
  console.log(`STATIC ${kind}/${staticKey(params)}.json`)
}

await post('/api/admin/site', { site_id: SITE_ID, auto_publish: true })
for (const window of Object.values(WINDOWS)) {
  const params = new URLSearchParams({ municipality: MUNICIPALITY, speed: SPEED, from: window.from, to: window.to })
  const replay = await getJson(`/api/replay?${params}`)
  // A static page starts the replay at its own load: elapsed 0 at the first bulletin of the window.
  await save('replay', params, { ...replay, elapsedMs: 0, index: replay.rows.length ? 0 : -1 })
  for (const row of replay.rows.filter((r) => r.screen)) {
    await post('/api/admin/approve', { municipality: MUNICIPALITY, bulletin_id: row.bulletin_id, approved: true })
    for (const shape of SHAPES) {
      const layoutParams = new URLSearchParams({ municipality: MUNICIPALITY, bulletin: row.bulletin_id, shape, site: SITE_ID })
      await save('live-layout', layoutParams, await getJson(`/api/live-layout?${layoutParams}`))
    }
  }
}
