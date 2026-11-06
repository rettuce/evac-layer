// The Lv4 bulletin of 2026-10-21 18:15 at the four demo sites (demo/sites/, cut 5c), as alert stills for the sim's
// place switch, plus the small map those sites sit on. Run against the app dev server, which lets /screen read a
// layout from any same-origin path; the layouts come from the composer with the cached Writer text, not the API:
//
//   node -e 'const w=require("./data/writer/05210/VXKOii-202610211815-e713da0e3c05.json");require("fs").writeFileSync("tmp/sr2/writer.json",JSON.stringify(w.output))'
//   pnpm -F agents compose --site "$PWD/demo/sites/<slug>/site.json" --alert <feed>/bodies/20261021/20261021091533_0_VXKO55_050000.xml \
//     --municipality 05210 --writer "$PWD/tmp/sr2/writer.json" --out-dir "$PWD/tmp/sr2/layouts/<slug>"
//   node sim/scripts/site-alerts.mjs --layouts tmp/sr2/layouts --tiles <demo>/cache/osm [--base-url http://127.0.0.1:3153]
//
// Output: sim/public/alert/yurihonjo-lv4-<slug>/<face>/<pair>.png (honjo-station is the existing yurihonjo-lv4)
// and sim/public/sites/{map.jpg,sites.json}.
import { execFile } from 'node:child_process'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs, promisify } from 'node:util'

const require = createRequire(new URL('../../app/package.json', import.meta.url))
const puppeteer = require('puppeteer-core')
const run = promisify(execFile)

const REPO = fileURLToPath(new URL('../../', import.meta.url))
const PUBLIC = path.join(REPO, 'sim/public/')
const CHROME_PATH = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BULLETIN = 'VXKOii-202610211815-e713da0e3c05'
const READY_TIMEOUT_MS = 60000
// Same instants and sizes as demo/capture/ambient_loops.mjs --alert, so these stills match the existing sets.
const PAIR_T_MS = { 'ja_easy-en': 14480, 'zh_hans-zh_hant': 16480, 'ko-th': 18480, 'vi-tl': 22480, id: 24480 }
const SHAPES = {
  '9x16': { viewport: { width: 1080, height: 1920 }, size: [747, 1328], faces: ['9x16_0', '9x16_1', '9x16_2'] },
  '32x9': { viewport: { width: 3840, height: 1080 }, size: [3000, 844], faces: ['32x9'] },
  pillar: { viewport: { width: 6616, height: 5046, deviceScaleFactor: 0.5 }, size: [2092, 1600], faces: ['pillar'] },
}
const SITES = [
  { slug: 'honjo-station', setId: 'yurihonjo-lv4', ja: '羽後本荘駅', en: 'Ugo-Honjo Sta.' },
  { slug: 'tsurumai-kaikan', setId: 'yurihonjo-lv4-tsurumai-kaikan', ja: '鶴舞会館', en: 'Tsurumai Kaikan' },
  { slug: 'yuri-hs-ground', setId: 'yurihonjo-lv4-yuri-hs-ground', ja: '由利高校', en: 'Yuri High School' },
  { slug: 'ishiwaki-park', setId: 'yurihonjo-lv4-ishiwaki-park', ja: '石脇公園', en: 'Ishiwaki Park' },
]
const DIRECTION_EN = { 北へ: 'N', 北東へ: 'NE', 東へ: 'E', 南東へ: 'SE', 南へ: 'S', 南西へ: 'SW', 西へ: 'W', 北西へ: 'NW' }
const ZOOM = 16
const TILE = 256
const MAP_WIDTH = 360
const MAP_MARGIN = 28

const { values } = parseArgs({
  options: {
    layouts: { type: 'string' },
    tiles: { type: 'string' },
    'base-url': { type: 'string', default: process.env.EVAC_URL ?? 'http://127.0.0.1:3153' },
  },
})
if (!values.layouts || !values.tiles) {
  console.error('usage: node sim/scripts/site-alerts.mjs --layouts <compose out dirs> --tiles <osm tile cache> [--base-url url]')
  process.exit(2)
}
const layoutsDir = path.resolve(values.layouts)
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'))
const layoutFile = (slug, shape) => path.join(layoutsDir, slug, `05210-${BULLETIN}-${shape}.json`)

async function renderStills(browser, site) {
  for (const [shape, { viewport, size, faces }] of Object.entries(SHAPES)) {
    const page = await browser.newPage()
    await page.setViewport({ deviceScaleFactor: 1, ...viewport })
    const src = `/_nuxt/@fs${layoutFile(site.slug, shape)}`
    const dir = path.join(PUBLIC, 'alert', site.setId, faces[0])
    await mkdir(dir, { recursive: true })
    for (const [pair, tMs] of Object.entries(PAIR_T_MS)) {
      const params = new URLSearchParams({ shape, clock: 'virtual', t: String(tMs), src })
      await page.goto(`${values['base-url']}/screen?${params}`, { waitUntil: 'networkidle0' })
      await page.waitForSelector('.evac-screen[data-ready="1"]', { timeout: READY_TIMEOUT_MS })
      const full = path.join(dir, `${pair}.full.png`)
      await page.screenshot({ path: full, type: 'png' })
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', full, '-vf', `scale=${size[0]}:${size[1]}:flags=lanczos`, path.join(dir, `${pair}.png`)])
      await rm(full)
    }
    await page.close()
    for (const face of faces.slice(1)) {
      const copy = path.join(PUBLIC, 'alert', site.setId, face)
      await mkdir(copy, { recursive: true })
      for (const pair of Object.keys(PAIR_T_MS)) await copyFile(path.join(dir, `${pair}.png`), path.join(copy, `${pair}.png`))
    }
    console.log(`STILLS ${site.setId} ${shape} → ${faces.join(' ')}`)
  }
}

function worldPx(lat, lng) {
  const scale = TILE * 2 ** ZOOM
  const sin = Math.sin((lat * Math.PI) / 180)
  return [((lng + 180) / 360) * scale, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale]
}

async function siteRecords() {
  const { shelters } = await readJson(path.join(REPO, 'data/municipalities/05210.shelters.json'))
  return Promise.all(SITES.map(async (site) => {
    const { lat, lng } = await readJson(path.join(REPO, 'demo/sites', site.slug, 'site.json'))
    const cells = Object.fromEntries((await readJson(layoutFile(site.slug, '16x9'))).cells.map((cell) => [cell.role, cell]))
    const name = cells.shelter.text.ja
    const shelter = shelters.find((s) => s.name === name && s.kind === 'emergency_evacuation_site')
    const direction = cells.direction.text.ja
    return {
      ...site, pos: [lat, lng],
      shelter: { name, pos: [shelter.lat, shelter.lng] },
      direction, directionEn: DIRECTION_EN[direction], distanceM: cells.shelter.distance_m,
    }
  }))
}

async function renderMap(browser, records) {
  const points = records.flatMap((r) => [worldPx(...r.pos), worldPx(...r.shelter.pos)])
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  const scale = (MAP_WIDTH - 2 * MAP_MARGIN) / (Math.max(...xs) - Math.min(...xs))
  const height = Math.round((Math.max(...ys) - Math.min(...ys)) * scale + 2 * MAP_MARGIN)
  const origin = [Math.min(...xs) - MAP_MARGIN / scale, Math.min(...ys) - MAP_MARGIN / scale]
  const toMap = ([lat, lng]) => {
    const [x, y] = worldPx(lat, lng)
    return [+((x - origin[0]) * scale).toFixed(1), +((y - origin[1]) * scale).toFixed(1)]
  }
  const tiles = []
  for (let tx = Math.floor(origin[0] / TILE); tx <= Math.floor((origin[0] + MAP_WIDTH / scale) / TILE); tx++) {
    for (let ty = Math.floor(origin[1] / TILE); ty <= Math.floor((origin[1] + height / scale) / TILE); ty++) {
      const file = path.resolve(values.tiles, String(ZOOM), String(tx), `${ty}.png`)
      const size = TILE * scale + 0.5
      tiles.push(`<img src="${pathToFileURL(file)}" style="position:absolute;left:${(tx * TILE - origin[0]) * scale}px;top:${(ty * TILE - origin[1]) * scale}px;width:${size}px;height:${size}px">`)
    }
  }
  const html = path.join(layoutsDir, 'map.html')
  await writeFile(html, `<!doctype html><body style="margin:0;width:${MAP_WIDTH}px;height:${height}px;position:relative;overflow:hidden">${tiles.join('')}</body>`)
  const page = await browser.newPage()
  await page.setViewport({ width: MAP_WIDTH, height, deviceScaleFactor: 2 })
  await page.goto(pathToFileURL(html).href, { waitUntil: 'load' })
  await mkdir(path.join(PUBLIC, 'sites'), { recursive: true })
  await page.screenshot({ path: path.join(PUBLIC, 'sites/map.full.png'), type: 'png' })
  await page.close()
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(PUBLIC, 'sites/map.full.png'), '-vf', 'hue=s=0.55', '-q:v', '4', path.join(PUBLIC, 'sites/map.jpg')])
  await rm(path.join(PUBLIC, 'sites/map.full.png'))
  const sites = records.map(({ pos, shelter, ...rest }) => ({ ...rest, at: toMap(pos), shelter: { name: shelter.name, at: toMap(shelter.pos) } }))
  const doc = { bulletin: BULLETIN, map: { src: 'map.jpg', width: MAP_WIDTH, height, credit: '© OpenStreetMap contributors' }, sites }
  await writeFile(path.join(PUBLIC, 'sites/sites.json'), `${JSON.stringify(doc, null, 2)}\n`)
  console.log(`MAP ${MAP_WIDTH}x${height} (z${ZOOM}, ${tiles.length} tiles)`)
}

const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true, args: ['--allow-file-access-from-files'] })
try {
  const records = await siteRecords()
  await renderMap(browser, records)
  for (const site of SITES.slice(1)) await renderStills(browser, site)
} finally {
  await browser.close()
}
