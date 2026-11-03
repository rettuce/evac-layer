// Screenshots every screen's window of one room canvas, per ambient scene, for the whole-room stills.
//
//   node demo/capture/canvas_stills.mjs --scenes brush-flow,ink-bloom [--crops demo/renders/canvas-crops.json] [--t 4000]
//
// Output: demo/cache/canvas/<scene>/<window>.png at each crop's own size (blender --canvas-dir reads them).
import { mkdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const require = createRequire(new URL('../../app/package.json', import.meta.url))
const puppeteer = require('puppeteer-core')

const CANVAS_ROOT = fileURLToPath(new URL('../cache/canvas/', import.meta.url))
const CHROME_PATH = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const READY_SELECTOR = '.evac-screen[data-ready="1"], [data-ready="1"]'
const READY_TIMEOUT_MS = 30000
// Every window shares canvas and canvas_id, so all of them cut the same seeded picture.
const ROOM_ID = 'concourse'
const SITE = { name: '羽後本荘駅', lat: '39.38633978', lng: '140.0563304' }

const { values } = parseArgs({
  options: {
    scenes: { type: 'string' },
    crops: { type: 'string', default: fileURLToPath(new URL('../renders/canvas-crops.json', import.meta.url)) },
    t: { type: 'string', default: '4000' },
    'base-url': { type: 'string', default: process.env.EVAC_URL ?? 'http://127.0.0.1:3151' },
  },
})
if (!values.scenes) throw new Error('--scenes is required (comma-separated scene ids)')

const { canvas, crops } = JSON.parse(await readFile(values.crops, 'utf8'))
const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true })
try {
  for (const scene of values.scenes.split(',')) {
    const dir = `${CANVAS_ROOT}${scene}/`
    await mkdir(dir, { recursive: true })
    for (const [name, [x, y, w, h]] of Object.entries(crops)) {
      const params = new URLSearchParams({
        mode: 'scenario', scenario: 'ambient', scene, clock: 'virtual', t: values.t,
        canvas: `${canvas[0]}x${canvas[1]}`, crop: `${x},${y},${w},${h}`, canvas_id: ROOM_ID,
        site_name: SITE.name, lat: SITE.lat, lng: SITE.lng,
      })
      const page = await browser.newPage()
      await page.setViewport({ width: w, height: h })
      await page.goto(`${values['base-url']}/screen?${params}`)
      await page.waitForSelector(READY_SELECTOR, { timeout: READY_TIMEOUT_MS })
      await page.screenshot({ path: `${dir}${name}.png`, type: 'png' })
      await page.close()
    }
    console.log(`CANVAS ${scene} windows=${Object.keys(crops).length} → ${dir}`)
  }
} finally {
  await browser.close()
}
