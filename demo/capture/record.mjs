// Records /screen as a deterministic PNG sequence on a virtual clock, then encodes it with ffmpeg.
//
//   node demo/capture/record.mjs --shape 16x9 --cut alert [--seconds 1] [--layout wajima-tsunami]
//
// Output: demo/screens/<shape>_<cut>.mp4 (h264, yuv420p, no audio, native screen resolution).
import { execFile } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { parseArgs, promisify } from 'node:util'

const require = createRequire(new URL('../../app/package.json', import.meta.url))
const puppeteer = require('puppeteer-core')
const run = promisify(execFile)

const SCREENS_DIR = fileURLToPath(new URL('../screens/', import.meta.url))
const FRAMES_ROOT = fileURLToPath(new URL('../cache/capture/', import.meta.url))
const CHROME_PATH = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const READY_SELECTOR = '.evac-screen[data-ready="1"]'
const READY_TIMEOUT_MS = 30000

const SHAPES = {
  '16x9': { width: 1920, height: 1080 },
  '9x16': { width: 1080, height: 1920 },
  '32x9': { width: 3840, height: 1080 },
  '1x1': { width: 1080, height: 1080 },
}

// Switch moment shared by every shape so the four screens cut over on the same frame (storyboard cut 5).
const SWITCH_AT_MS = 12000

const CUTS = {
  ambient: { seconds: 12, query: { mode: 'scenario', scenario: 'ambient' } },
  switch: { seconds: 27, query: { mode: 'scenario', scenario: 'switch', t_switch: String(SWITCH_AT_MS) } },
  alert: { seconds: 27, query: {} },
}

function options() {
  const { values } = parseArgs({
    options: {
      shape: { type: 'string' },
      cut: { type: 'string' },
      seconds: { type: 'string' },
      fps: { type: 'string', default: '30' },
      layout: { type: 'string', default: 'wajima-tsunami' },
      'base-url': { type: 'string', default: process.env.EVAC_URL ?? 'http://127.0.0.1:3150' },
      out: { type: 'string' },
      'keep-frames': { type: 'boolean', default: false },
    },
  })
  if (!SHAPES[values.shape]) throw new Error(`--shape must be one of ${Object.keys(SHAPES).join(', ')}`)
  if (!CUTS[values.cut]) throw new Error(`--cut must be one of ${Object.keys(CUTS).join(', ')}`)
  const fps = Number(values.fps)
  const seconds = values.seconds ? Number(values.seconds) : CUTS[values.cut].seconds
  return {
    ...values,
    fps,
    frameCount: Math.round(seconds * fps),
    out: values.out ?? `${SCREENS_DIR}${values.shape}_${values.cut}.mp4`,
  }
}

function frameUrl(opts, tMs) {
  const params = new URLSearchParams({
    shape: opts.shape,
    layout: opts.layout,
    clock: 'virtual',
    t: String(Math.round(tMs)),
    ...CUTS[opts.cut].query,
  })
  return `${opts['base-url']}/screen?${params}`
}

// Prefer an in-page clock hook when the renderer exposes one; a full navigation per frame is the fallback.
async function seek(page, opts, tMs) {
  const seeked = await page.evaluate(async (t) => {
    if (typeof window.evacClock?.set !== 'function') return false
    await window.evacClock.set(t)
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return true
  }, tMs)
  if (!seeked) {
    await page.goto(frameUrl(opts, tMs), { waitUntil: 'networkidle0' })
    await page.waitForSelector(READY_SELECTOR, { timeout: READY_TIMEOUT_MS })
  }
  return seeked ? 'hook' : 'navigate'
}

async function captureFrames(opts, framesDir) {
  const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true })
  try {
    const page = await browser.newPage()
    await page.setViewport({ ...SHAPES[opts.shape], deviceScaleFactor: 1 })
    await page.goto(frameUrl(opts, 0), { waitUntil: 'networkidle0' })
    await page.waitForSelector(READY_SELECTOR, { timeout: READY_TIMEOUT_MS })
    const modes = new Set()
    for (let frame = 0; frame < opts.frameCount; frame++) {
      if (frame > 0) modes.add(await seek(page, opts, (frame * 1000) / opts.fps))
      const name = String(frame + 1).padStart(5, '0')
      await page.screenshot({ path: `${framesDir}${name}.png`, type: 'png' })
    }
    return [...modes]
  } finally {
    await browser.close()
  }
}

async function encode(opts, framesDir) {
  await mkdir(SCREENS_DIR, { recursive: true })
  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-framerate', String(opts.fps),
    '-i', `${framesDir}%05d.png`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-an',
    opts.out,
  ])
}

async function main() {
  const opts = options()
  const framesDir = `${FRAMES_ROOT}${opts.shape}_${opts.cut}/`
  await rm(framesDir, { recursive: true, force: true })
  await mkdir(framesDir, { recursive: true })
  const started = performance.now()
  const modes = await captureFrames(opts, framesDir)
  await encode(opts, framesDir)
  if (!opts['keep-frames']) await rm(framesDir, { recursive: true, force: true })
  const seconds = (performance.now() - started) / 1000
  console.log(
    `RECORDED ${opts.out} shape=${opts.shape} cut=${opts.cut} frames=${opts.frameCount} fps=${opts.fps} ` +
      `seek=${modes.join('+') || '-'} elapsed_s=${seconds.toFixed(1)} per_frame_s=${(seconds / opts.frameCount).toFixed(2)}`,
  )
}

await main()
