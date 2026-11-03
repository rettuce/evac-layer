// One frame per screen shape for the key-visual variants, written as per-window stills for blender --canvas-dir.
//
//   node demo/capture/kv_frames.mjs [--base-url http://127.0.0.1:3151]
//
// Output: demo/cache/kv/<variant>/<window>.png (every window of a shape shows the same frame).
import { copyFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const require = createRequire(new URL('../../app/package.json', import.meta.url))
const puppeteer = require('puppeteer-core')

const KV_ROOT = fileURLToPath(new URL('../cache/kv/', import.meta.url))
const CHROME_PATH = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const READY_SELECTOR = '.evac-screen[data-ready="1"]'
const READY_TIMEOUT_MS = 30000
// The pillar wraps a column (four faces left to right); its logical size is captured at half scale.
const SHAPES = {
  '9x16': { width: 1080, height: 1920, windows: ['9x16_0', '9x16_1', '9x16_2'] },
  '32x9': { width: 3840, height: 1080, windows: ['32x9_0', '32x9_1', '32x9_2'] },
  pillar: { width: 6616, height: 5046, scale: 0.5, windows: ['pillar_0', 'pillar_1', 'pillar_2', 'pillar_3'] },
}
// The language band shows two languages per 2.5 s from appearance; stills use t = 13.5 s (easy Japanese
// and English, one full rotation after the band has settled; the rule of scripts/screens.mjs), t = 6 s is Korean and Thai.
const T_EASY_EN_MS = 13500
const T_KO_TH_MS = 6000
const preview = (municipality, bulletin) => (shape) =>
  ({ src: `/api/admin/preview-layout?${new URLSearchParams({ municipality, bulletin, shape })}` })
const VARIANTS = {
  'lv3-rain': { query: preview('17204', 'VPWW55-202610200500-e9e69c6c3b73'), t: T_EASY_EN_MS },
  'lv4-flood': { query: preview('05210', 'VXKOii-202610211815-e713da0e3c05'), t: T_EASY_EN_MS },
  'lv4-flood-ko-th': { query: preview('05210', 'VXKOii-202610211815-e713da0e3c05'), t: T_KO_TH_MS },
  'lv5-flood': { query: preview('05210', 'VXKOii-202610211945-a25f8f3aba7d'), t: T_EASY_EN_MS },
  'clear': { query: preview('05210', 'VXKOii-202610220620-74a7831c8a40'), t: T_EASY_EN_MS },
  'tsunami-drill': { query: preview('22424', 'VTSE41-201609010713-ff3dd5d5c94f'), t: T_EASY_EN_MS },
}

const { values } = parseArgs({ options: { 'base-url': { type: 'string', default: process.env.EVAC_URL ?? 'http://127.0.0.1:3151' } } })
const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true })
try {
  for (const [variant, { query, t }] of Object.entries(VARIANTS)) {
    const dir = `${KV_ROOT}${variant}/`
    await mkdir(dir, { recursive: true })
    for (const [shape, { width, height, scale = 1, windows }] of Object.entries(SHAPES)) {
      const params = new URLSearchParams({ shape, clock: 'virtual', t: String(t), ...query(shape) })
      const page = await browser.newPage()
      await page.setViewport({ width, height, deviceScaleFactor: scale })
      await page.bringToFront()
      await page.goto(`${values['base-url']}/screen?${params}`, { waitUntil: 'networkidle0' })
      await page.waitForSelector(READY_SELECTOR, { timeout: READY_TIMEOUT_MS })
      const first = `${dir}${windows[0]}.png`
      await page.screenshot({ path: first, type: 'png' })
      await page.close()
      for (const window of windows.slice(1)) await copyFile(first, `${dir}${window}.png`)
    }
    console.log(`KV_FRAMES ${variant} t=${t} → ${dir}`)
  }
} finally {
  await browser.close()
}
