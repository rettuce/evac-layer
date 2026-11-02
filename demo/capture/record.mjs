// Records /screen as a deterministic PNG sequence on a virtual clock, then encodes it with ffmpeg.
//
//   node demo/capture/record.mjs --shape 16x9 --cut alert [--seconds 1] [--from-ms <ms>] [--site-name <name>] [--verify]
//
// Output: demo/screens/<shape>_<cut>.mp4 (h264, yuv420p, no audio, native screen resolution).
import { execFile } from 'node:child_process'
import { mkdir, readFile, rm } from 'node:fs/promises'
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

// Fixture scenario: the four screens cut over on the same frame at 12 s.
const SCENARIO_SWITCH_AT_MS = 12000
const SCENARIO = { mode: 'scenario', layout: 'wajima-tsunami' }

// Live replay of real JMA bulletins for Yurihonjo (05210) at 1200x speed, limited to the
// 2026-10-21 flood so the first screen comes 13 s in rather than minutes later. Events are when the
// screen changes: Lv3 prepare, Lv4, three Lv5 bulletins, cross-fade back to ambient.
const LIVE = {
  mode: 'live', municipality: '05210', speed: '1200',
  from: '2026-10-21T11:00+09:00', to: '2026-10-22T07:00+09:00',
}
const LIVE_READY = '[data-mode="live"][data-ready="1"]'
const LIVE_EVENTS_MS = [13100, 20100, 24600, 26100, 29100, 44350]
const LIVE_SITE_ID = '05210-demo-honjo-station'

const CUTS = {
  ambient: { seconds: 12, startMs: 0, query: LIVE, ready: LIVE_READY, events: LIVE_EVENTS_MS },
  switch: { seconds: 27, startMs: 5000, query: LIVE, ready: LIVE_READY, events: LIVE_EVENTS_MS },
  alert: { seconds: 18, startMs: 26000, query: LIVE, ready: LIVE_READY, events: [] },
  'fixture-alert': { seconds: 27, startMs: 0, query: { layout: 'wajima-tsunami' }, ready: READY_SELECTOR, events: [] },
  'scenario-ambient': { seconds: 12, startMs: 0, query: { ...SCENARIO, scenario: 'ambient' }, ready: READY_SELECTOR, events: [] },
  'scenario-switch': {
    seconds: 27, startMs: 0, ready: READY_SELECTOR, events: [SCENARIO_SWITCH_AT_MS],
    query: { ...SCENARIO, scenario: 'switch', t_switch: String(SCENARIO_SWITCH_AT_MS) },
  },
}

function options() {
  const { values } = parseArgs({
    options: {
      shape: { type: 'string' },
      cut: { type: 'string' },
      seconds: { type: 'string' },
      fps: { type: 'string', default: '30' },
      'site-name': { type: 'string' },
      'base-url': { type: 'string', default: process.env.EVAC_URL ?? 'http://127.0.0.1:3150' },
      out: { type: 'string' },
      'keep-frames': { type: 'boolean', default: false },
      verify: { type: 'boolean', default: false },
      'from-ms': { type: 'string' },
      'frames-dir': { type: 'string' },
    },
  })
  if (!SHAPES[values.shape]) throw new Error(`--shape must be one of ${Object.keys(SHAPES).join(', ')}`)
  if (!CUTS[values.cut]) throw new Error(`--cut must be one of ${Object.keys(CUTS).join(', ')}`)
  const fps = Number(values.fps)
  const seconds = values.seconds ? Number(values.seconds) : CUTS[values.cut].seconds
  return {
    ...values,
    fps,
    startMs: values['from-ms'] ? Number(values['from-ms']) : CUTS[values.cut].startMs,
    frameCount: Math.round(seconds * fps),
    out: values.out ?? `${SCREENS_DIR}${values.shape}_${values.cut}.mp4`,
  }
}

function frameUrl(opts, tMs) {
  const params = new URLSearchParams({
    shape: opts.shape,
    clock: 'virtual',
    t: String(Math.round(tMs)),
    ...CUTS[opts.cut].query,
  })
  if (opts['site-name'] && opts.cut !== 'alert') params.set('site_name', opts['site-name'])
  return `${opts['base-url']}/screen?${params}`
}

// Prefer an in-page clock hook when the renderer exposes one; a full navigation per frame is the fallback.
const SEEK_ATTEMPTS = 3

// A dev server's HMR can reload the page mid-recording; wait for it to settle and seek again.
async function seek(page, opts, tMs) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await seekOnce(page, opts, tMs)
    } catch (error) {
      if (attempt >= SEEK_ATTEMPTS || !/context was destroyed/.test(error.message)) throw error
      await page.waitForSelector(CUTS[opts.cut].ready, { timeout: READY_TIMEOUT_MS })
    }
  }
}

async function seekOnce(page, opts, tMs) {
  const seeked = await page.evaluate(async (t) => {
    if (typeof window.evacClock?.set !== 'function') return false
    await window.evacClock.set(t)
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return true
  }, tMs)
  if (!seeked) {
    await page.goto(frameUrl(opts, tMs), { waitUntil: 'networkidle0' })
    await page.waitForSelector(CUTS[opts.cut].ready, { timeout: READY_TIMEOUT_MS })
  }
  return seeked ? 'hook' : 'navigate'
}

const frameName = (frame) => String(frame + 1).padStart(5, '0')
const frameTime = (opts, frame) => opts.startMs + (frame * 1000) / opts.fps

async function openPage(browser, opts, tMs) {
  const page = await browser.newPage()
  await page.setViewport({ ...SHAPES[opts.shape], deviceScaleFactor: 1 })
  // Background tabs pause requestAnimationFrame, so evacClock.set() would resolve before painting.
  await page.bringToFront()
  await page.goto(frameUrl(opts, tMs), { waitUntil: 'networkidle0' })
  await page.waitForSelector(CUTS[opts.cut].ready, { timeout: READY_TIMEOUT_MS })
  return page
}

// Live screens only show approved bulletins and read approvals once on mount, so approve every
// bulletin that becomes a screen (and turn auto-publish on) before the first page opens.
async function approveLive(browser, opts) {
  const { query } = CUTS[opts.cut]
  if (query.mode !== 'live') return null
  const { mode, ...replayQuery } = query
  const replayPath = `/api/replay?${new URLSearchParams(replayQuery)}`
  const page = await browser.newPage()
  await page.goto(`${opts['base-url']}${replayPath}`)
  const approved = await page.evaluate(async ({ municipality, siteId, replayPath }) => {
    const post = async (path, body) => {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(`${path} answered ${response.status}`)
    }
    const replay = await (await fetch(replayPath)).json()
    const ids = replay.rows.filter((row) => row.screen).map((row) => row.bulletin_id)
    await post('/api/admin/site', { site_id: siteId, auto_publish: true })
    for (const id of ids) await post('/api/admin/approve', { municipality, bulletin_id: id, approved: true })
    return ids
  }, { municipality: query.municipality, siteId: LIVE_SITE_ID, replayPath })
  await page.close()
  if (approved.length === 0) throw new Error(`no screen bulletins to approve for ${query.municipality}`)
  return approved
}

async function captureFrames(browser, opts, framesDir) {
  const page = await openPage(browser, opts, 0)
  const modes = new Set()
  for (let frame = 0; frame < opts.frameCount; frame++) {
    if (frame > 0) modes.add(await seek(page, opts, frameTime(opts, frame)))
    await page.screenshot({ path: `${framesDir}${frameName(frame)}.png`, type: 'png' })
  }
  await page.close()
  return [...modes]
}

// Frames to re-shoot: first, middle, last, and the two frames around each screen change.
function verifyFrames(opts) {
  const frames = [0, Math.floor(opts.frameCount / 2), opts.frameCount - 1]
  const { startMs } = opts
  const { events } = CUTS[opts.cut]
  for (const eventMs of events) {
    const eventFrame = Math.round(((eventMs - startMs) / 1000) * opts.fps)
    frames.push(eventFrame - 1, eventFrame)
  }
  return [...new Set(frames)].filter((f) => f >= 0 && f < opts.frameCount).sort((a, b) => a - b)
}

async function maxPixelDelta(fileA, fileB) {
  const { stderr } = await run('ffmpeg', [
    '-hide_banner', '-i', fileA, '-i', fileB,
    '-lavfi', '[0][1]blend=all_mode=difference,format=gray,signalstats,metadata=print:key=lavfi.signalstats.YMAX',
    '-f', 'null', '-',
  ])
  return Number(stderr.match(/YMAX=(\d+)/)?.[1] ?? NaN)
}

// Re-shoots each sample time on a fresh page that jumps from t=0 straight to t through the same
// seek path as the recording, so a pass also proves the frame does not depend on the frames before
// it. Comparing against a page opened directly at t would mix two Chrome rasterization paths, which
// differ by 1/255 on text that is mid scale-in.
async function verify(browser, opts, framesDir) {
  const results = []
  for (const frame of verifyFrames(opts)) {
    const page = await openPage(browser, opts, 0)
    if (frame > 0) await seek(page, opts, frameTime(opts, frame))
    const again = `${framesDir}verify_${frameName(frame)}.png`
    await page.screenshot({ path: again, type: 'png' })
    await page.close()
    const original = `${framesDir}${frameName(frame)}.png`
    const identical = (await readFile(original)).equals(await readFile(again))
    const delta = identical ? 0 : await maxPixelDelta(original, again)
    results.push({ frame: frame + 1, tMs: Math.round(frameTime(opts, frame)), identical, delta })
  }
  return results
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
  const framesDir = opts['frames-dir'] ? `${opts['frames-dir'].replace(/\/$/, '')}/` : `${FRAMES_ROOT}${opts.shape}_${opts.cut}/`
  await rm(framesDir, { recursive: true, force: true })
  await mkdir(framesDir, { recursive: true })
  const started = performance.now()
  const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true })
  let modes
  let checks = []
  let approved = null
  try {
    approved = await approveLive(browser, opts)
    modes = await captureFrames(browser, opts, framesDir)
    if (opts.verify) checks = await verify(browser, opts, framesDir)
  } finally {
    await browser.close()
  }
  await encode(opts, framesDir)
  if (!opts['keep-frames']) await rm(framesDir, { recursive: true, force: true })
  const seconds = (performance.now() - started) / 1000
  console.log(
    `RECORDED ${opts.out} shape=${opts.shape} cut=${opts.cut} frames=${opts.frameCount} fps=${opts.fps} ` +
      `seek=${modes.join('+') || '-'} elapsed_s=${seconds.toFixed(1)} per_frame_s=${(seconds / opts.frameCount).toFixed(2)}`,
  )
  if (approved) console.log(`APPROVED ${approved.length} bulletins + auto_publish for ${LIVE_SITE_ID}`)
  for (const c of checks) {
    console.log(`VERIFY frame=${c.frame} t_ms=${c.tMs} ${c.identical ? 'identical' : `DIFFERS max_delta=${c.delta}`}`)
  }
  if (checks.some((c) => !c.identical)) {
    console.log(`VERIFY FAILED ${checks.filter((c) => !c.identical).length}/${checks.length} frames differ`)
    process.exitCode = 1
  }
}

await main()
