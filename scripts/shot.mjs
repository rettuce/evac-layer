import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const require = createRequire(new URL('../app/package.json', import.meta.url))
const puppeteer = require('puppeteer-core')

const BASE_URL = process.env.EVAC_URL ?? 'http://127.0.0.1:3150'
const LAYOUT = process.env.EVAC_LAYOUT ?? 'wajima-tsunami'
const VARIANT = process.env.EVAC_VARIANT ?? '0'
const CHROME_PATH = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const OUT_DIR = fileURLToPath(new URL(`../app/shots/${process.env.EVAC_SHOTS_SUBDIR ?? ''}`, import.meta.url))

const SHAPES = {
  '16x9': { width: 1920, height: 1080 },
  '9x16': { width: 1080, height: 1920 },
  '32x9': { width: 3840, height: 1080 },
  '1x1': { width: 1080, height: 1080 },
  // Drawn at logical pixels, captured at half size: the full 6616 x 5834 frame is 38 MP.
  pillar: { width: 6616, height: 5046, deviceScaleFactor: 0.5 },
}

const READY_TIMEOUT_MS = 30000
const SETTLE_MS = 800
const FLICKER_FRAMES = 3
const FLICKER_WINDOW_MS = 1000
// WCAG 2.3.1: a flash is a pair of opposing changes in relative luminance of 10% or more.
const FLASH_LUMINANCE_DELTA = 0.1
const MAX_REVERSALS = 1

function screenUrl(shape) {
  return `${BASE_URL}/screen?shape=${shape}&layout=${encodeURIComponent(LAYOUT)}&variant=${VARIANT}`
}

async function openScreen(browser, shape, { reducedMotion }) {
  const page = await browser.newPage()
  await page.setViewport({ deviceScaleFactor: 1, ...SHAPES[shape] })
  await page.emulateMediaFeatures([
    { name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' },
  ])
  await page.goto(screenUrl(shape), { waitUntil: 'networkidle0' })
  await page.waitForSelector('.evac-screen[data-ready="1"]', { timeout: READY_TIMEOUT_MS })
  return page
}

async function readScreenState(page) {
  return page.$eval('.evac-screen', (el) => ({
    shape: el.dataset.shape,
    template: el.dataset.template,
    variant: el.dataset.variant,
    level: el.dataset.level,
    dropped: el.dataset.dropped || '',
    overflow: el.dataset.overflow ?? null,
    missingRequired: el.dataset.missingRequired ?? null,
    cells: [...el.querySelectorAll('[data-cell-id]')].map((cell) => ({
      id: cell.dataset.cellId,
      text: cell.innerText.replace(/\s+/g, ' ').trim(),
      color: getComputedStyle(cell).color,
      background: getComputedStyle(cell).backgroundColor,
    })),
  }))
}

async function meanLuminance(page, png) {
  return page.evaluate(async (base64) => {
    const img = new Image()
    img.src = `data:image/png;base64,${base64}`
    await img.decode()
    const canvas = new OffscreenCanvas(img.width, img.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const { data } = ctx.getImageData(0, 0, img.width, img.height)
    const lin = (c) => {
      const v = c / 255
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    }
    let sum = 0
    for (let i = 0; i < data.length; i += 4) {
      sum += 0.2126 * lin(data[i]) + 0.7152 * lin(data[i + 1]) + 0.0722 * lin(data[i + 2])
    }
    return sum / (data.length / 4)
  }, Buffer.from(png).toString('base64'))
}

function countReversals(luminances) {
  const steps = luminances
    .slice(1)
    .map((l, i) => l - luminances[i])
    .filter((d) => Math.abs(d) >= FLASH_LUMINANCE_DELTA)
    .map(Math.sign)
  return steps.slice(1).filter((s, i) => s !== steps[i]).length
}

async function flickerCheck(browser, shape) {
  const page = await openScreen(browser, shape, { reducedMotion: false })
  const luminances = []
  const interval = FLICKER_WINDOW_MS / (FLICKER_FRAMES - 1)
  for (let i = 0; i < FLICKER_FRAMES; i++) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, interval))
    luminances.push(await meanLuminance(page, await page.screenshot({ type: 'png' })))
  }
  await page.close()
  const reversals = countReversals(luminances)
  return { shape, luminances, reversals, pass: reversals <= MAX_REVERSALS }
}

function galleryHtml(results) {
  const figures = results
    .map(
      (r) => `<figure><img src="${r.shape}.png" alt="${r.shape}"><figcaption>${r.shape} — ${SHAPES[r.shape].width}×${SHAPES[r.shape].height} — dropped: ${r.state.dropped || 'none'}${r.state.overflow ? ` — overflow: ${r.state.overflow}` : ''}</figcaption></figure>`,
    )
    .join('\n')
  return `<!doctype html><meta charset="utf-8"><title>EVAC LAYER shots — ${LAYOUT}</title>
<style>body{margin:24px;background:#222;color:#eee;font:14px/1.5 system-ui}main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;align-items:start}figure{margin:0}figure.wide{grid-column:1/-1}img{width:100%;height:auto;display:block;background:#fff}</style>
<h1>${LAYOUT}</h1><main>${figures.replace('<figure><img src="32x9.png"', '<figure class="wide"><img src="32x9.png"')}</main>`
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true })
  try {
    const results = []
    for (const shape of Object.keys(SHAPES)) {
      const page = await openScreen(browser, shape, { reducedMotion: true })
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
      await page.screenshot({ path: `${OUT_DIR}${shape}.png`, type: 'png' })
      results.push({ shape, file: `app/shots/${shape}.png`, state: await readScreenState(page) })
      await page.close()
    }
    const flicker = await flickerCheck(browser, '16x9')
    const report = { layout: LAYOUT, baseUrl: BASE_URL, results, flicker }
    await writeFile(`${OUT_DIR}report.json`, JSON.stringify(report, null, 2))
    await writeFile(`${OUT_DIR}index.html`, galleryHtml(results))
    for (const r of results) {
      console.log(`${r.shape}\tdropped=${r.state.dropped || '-'}\toverflow=${r.state.overflow ?? '-'}\tmissing=${r.state.missingRequired ?? '-'}`)
    }
    console.log(`flicker ${flicker.shape}: luminance=${flicker.luminances.map((l) => l.toFixed(4)).join(',')} reversals=${flicker.reversals} pass=${flicker.pass}`)
    if (!flicker.pass) process.exitCode = 1
  } finally {
    await browser.close()
  }
}

const FRAME_INTERVAL_MS = 1000 / 30

const { values: args } = parseArgs({
  options: {
    frames: { type: 'boolean', default: false },
    name: { type: 'string' },
    shape: { type: 'string', default: '16x9' },
    seconds: { type: 'string', default: '3' },
    start: { type: 'string', default: '0' },
    query: { type: 'string', default: '' },
  },
})

async function recordFrames() {
  const shape = args.shape
  if (!(shape in SHAPES)) throw new Error(`unknown shape ${shape}`)
  const frameCount = Math.round(Number(args.seconds) * 1000 / FRAME_INTERVAL_MS)
  const startMs = Number(args.start)
  const name = args.name ?? `${LAYOUT}-${shape}`
  const dir = fileURLToPath(new URL(`../app/shots/frames/${name}/`, import.meta.url))
  await mkdir(dir, { recursive: true })
  const extra = args.query ? `&${args.query}` : ''
  const url = `${screenUrl(shape)}&clock=virtual&t=${startMs}${extra}`

  const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true })
  const began = performance.now()
  try {
    const page = await browser.newPage()
    await page.setViewport({ deviceScaleFactor: 1, ...SHAPES[shape] })
    await page.goto(url, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.evac-screen[data-ready="1"]', { timeout: READY_TIMEOUT_MS })
    for (let i = 0; i < frameCount; i++) {
      const t = Math.round(startMs + i * FRAME_INTERVAL_MS)
      await page.evaluate((ms) => window.evacClock.set(ms), t)
      await page.screenshot({ path: `${dir}${String(i + 1).padStart(4, '0')}.png`, type: 'png' })
    }
  } finally {
    await browser.close()
  }
  const seconds = (performance.now() - began) / 1000
  console.log(`frames ${name}: ${frameCount} PNG in ${seconds.toFixed(1)} s -> app/shots/frames/${name}/ (${url})`)
}

await (args.frames ? recordFrames() : main())
