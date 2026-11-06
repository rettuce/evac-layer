// Records /screen as a deterministic PNG sequence on a virtual clock, then encodes it with ffmpeg.
//
//   node demo/capture/record.mjs --shape 16x9 --cut alert [--seconds 1] [--from-ms <ms>] [--site-name <name>] [--scene <id>] [--verify]
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
const CROPS_PATH = fileURLToPath(new URL('../renders/canvas-crops.json', import.meta.url))
const ROOM_ID = 'concourse'
const CHROME_PATH = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const READY_SELECTOR = '.evac-screen[data-ready="1"]'
const READY_TIMEOUT_MS = 30000

const SHAPES = {
  '16x9': { width: 1920, height: 1080 },
  '9x16': { width: 1080, height: 1920 },
  '32x9': { width: 3840, height: 1080 },
  '1x1': { width: 1080, height: 1080 },
  // The pillar wraps a column (four faces left to right); its logical size is recorded at half scale.
  pillar: { width: 6616, height: 5046, scale: 0.5 },
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
  scene: 'quad-subdivision',
}
const LIVE_READY = '[data-mode="live"][data-ready="1"]'
const LIVE_EVENTS_MS = [13100, 20100, 24600, 26100, 29100, 44350]
const LIVE_SITE_ID = '05210-demo-honjo-station'

// Cut 5c brings each of four sites' screens in after the map moves, so each starts at its own t = 0 (scale-in).
const SITE_SLUGS = ['honjo-station', 'tsurumai-kaikan', 'yuri-hs-ground', 'ishiwaki-park']
const SITE_SECONDS = 2.5
const SITE_CUTS = Object.fromEntries(SITE_SLUGS.map((slug) => [`site-${slug}`, {
  seconds: SITE_SECONDS, startMs: 0,
  query: { src: `demo/sites/${slug}/16x9.json` }, ready: READY_SELECTOR, events: [],
}]))

// Cut 7b sets five municipalities side by side: three bulletins from data/layouts through the local-only
// admin preview, and two municipalities on a quiet day (no bulletin in the window, so the calm layer shows).
const MUNICIPALITY_SECONDS = 10
const preview = (municipality, bulletin) => ({
  seconds: MUNICIPALITY_SECONDS, startMs: 0, ready: READY_SELECTOR, events: [],
  query: { src: `/api/admin/preview-layout?${new URLSearchParams({ municipality, bulletin, shape: '16x9' })}` },
})
const quiet = (municipality) => ({
  seconds: MUNICIPALITY_SECONDS, startMs: 0, ready: LIVE_READY, events: [], approve: false,
  query: { ...LIVE, municipality, from: '2026-10-15T00:00+09:00', to: '2026-10-15T06:00+09:00' },
})
const previewOf = (municipality, bulletin) => (shape) => ({ src: `/api/admin/preview-layout?${new URLSearchParams({ municipality, bulletin, shape })}` })
const MUNICIPALITY_CUTS = {
  'muni-05210': preview('05210', 'VXKOii-202610211815-e713da0e3c05'),
  'muni-17204': preview('17204', 'VPWW56-202610211304-1ebf37f5ab8a'),
  'muni-15205': preview('15205', 'VPWW56-202610311653-b3fa1b3a2ced'),
  'muni-22424': quiet('22424'),
  'muni-14100': quiet('14100'),
}

const CUTS = {
  ...SITE_CUTS,
  ...MUNICIPALITY_CUTS,
  ambient: { seconds: 12, startMs: 0, query: LIVE, ready: LIVE_READY, events: LIVE_EVENTS_MS },
  // Cut 5 opens on 4 s of the calm screen before the 13.1 s level 3 (v9).
  switch: { seconds: 27, startMs: 9100, query: { ...LIVE, scene: 'ink-bloom' }, ready: LIVE_READY, events: LIVE_EVENTS_MS },
  alert: { seconds: 18, startMs: 26000, query: LIVE, ready: LIVE_READY, events: [] },
  // v8 (D-14): the clock runs at real time everywhere except cut 5. The replay clock starts at the window's first
  // bulletin, so a negative start shows the calm screen before it: 15:54:55, then the 15:55 level 3 at 5 s.
  'switch-real': { seconds: 13, startMs: -5000, query: { ...LIVE, speed: '1', from: '2026-10-21T15:55+09:00', scene: 'brush-flow' }, ready: LIVE_READY, events: [0] },
  'ambient-real': { seconds: 16, startMs: -300000, query: { ...LIVE, speed: '1', from: '2026-10-21T15:55+09:00', scene: 'brush-flow' }, ready: LIVE_READY, events: [] },
  // Cut 8 (v9) changes bulletin as the camera starts each move: one still alert per bulletin, per shape.
  'alert-lv3': { seconds: 6, startMs: 3000, query: previewOf('05210', 'VXKOii-202610211555-d5ccc7c6b547'), ready: READY_SELECTOR, events: [] },
  'alert-lv4': { seconds: 6, startMs: 3000, query: previewOf('05210', 'VXKOii-202610211815-e713da0e3c05'), ready: READY_SELECTOR, events: [] },
  'alert-tsunami': { seconds: 6, startMs: 3000, query: previewOf('22424', 'VTSE41-201609010713-ff3dd5d5c94f'), ready: READY_SELECTOR, events: [] },
  'alert-real': { seconds: 27, startMs: 3000, query: { ...LIVE, speed: '1', from: '2026-10-21T19:45+09:00' }, ready: LIVE_READY, events: [] },
  // Cut 5 (D-32): one real-time replay from 15:55, shown in three spans joined at the bulletins. The calm
  // ink-bloom for 4 s and the 15:55 level 3; from 18:15 the level 4; from 19:45 the level 5 (switches at 4, 9.5, 15 s).
  'seq-lv3': { seconds: 9.5, startMs: -4000, query: { ...LIVE, speed: '1', from: '2026-10-21T15:55+09:00', scene: 'ink-bloom' }, ready: LIVE_READY, events: [0] },
  'seq-lv4': { seconds: 5.5, startMs: 8400000, query: { ...LIVE, speed: '1', from: '2026-10-21T15:55+09:00', scene: 'ink-bloom' }, ready: LIVE_READY, events: [8400000] },
  'seq-lv5': { seconds: 6, startMs: 13800000, query: { ...LIVE, speed: '1', from: '2026-10-21T15:55+09:00', scene: 'ink-bloom' }, ready: LIVE_READY, events: [13800000] },
  // Edit material (D-33): 30 s of a calm scene (--scene) on the real-time clock from 15:54:00.
  'ambient-3': { seconds: 3, startMs: -60000, query: { ...LIVE, speed: '1', from: '2026-10-21T15:55+09:00' }, ready: LIVE_READY, events: [] },
  'ambient-30': { seconds: 30, startMs: -60000, query: { ...LIVE, speed: '1', from: '2026-10-21T15:55+09:00' }, ready: LIVE_READY, events: [] },
  // Cut 9 (D-32): the 15:55 level 3 instead of the level 5.
  'alert-real-lv3': { seconds: 12, startMs: 3000, query: { ...LIVE, speed: '1', from: '2026-10-21T15:55+09:00' }, ready: LIVE_READY, events: [] },
  // The dashboard counts up in about 4 s of its own clock; a quarter rate stretches that over the cut.
  dashboard: { seconds: 25, startMs: 0, rate: 0.25, page: '/dashboard', query: {}, ready: '.dashboard[data-ready="1"]', events: [] },
  // Four times the dashboard's own clock settles the numbers within the first second, then they hold.
  'dashboard-final': { seconds: 6, startMs: 0, rate: 4, page: '/dashboard', query: {}, ready: '.dashboard[data-ready="1"]', events: [] },
  'fixture-alert': { seconds: 27, startMs: 0, query: { layout: 'wajima-tsunami' }, ready: READY_SELECTOR, events: [] },
  'scenario-ambient': { seconds: 12, startMs: 0, query: { ...SCENARIO, scenario: 'ambient' }, ready: READY_SELECTOR, events: [] },
  'scenario-switch': {
    seconds: 27, startMs: 0, ready: READY_SELECTOR, events: [SCENARIO_SWITCH_AT_MS],
    query: { ...SCENARIO, scenario: 'switch', t_switch: String(SCENARIO_SWITCH_AT_MS) },
  },
}

async function options() {
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
      scene: { type: 'string' },
      window: { type: 'string' },
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
    out: values.out ?? `${SCREENS_DIR}${values.window ?? values.shape}_${values.cut}.mp4`,
    room: values.window ? await roomWindow(values.window, values.shape) : undefined,
  }
}

// One window of the concourse canvas (demo/renders/canvas-crops.json, the same windows as the sim): the screen
// draws its part of one room-wide ambient, so neighbouring screens continue each other.
async function roomWindow(name, shape) {
  const { canvas, crops, shapes, seam } = JSON.parse(await readFile(CROPS_PATH, 'utf8'))
  if (!crops[name]) throw new Error(`--window must be one of ${Object.keys(crops).join(', ')}`)
  if (shapes[name] !== shape) throw new Error(`window ${name} is a ${shapes[name]} screen, not ${shape}`)
  return { canvas: `${canvas[0]}x${canvas[1]}`, crop: crops[name].join(','), canvas_id: ROOM_ID, ...(seam[name] ? { seam: seam[name] } : {}) }
}

function queryOf(cut, shape) {
  const { query } = CUTS[cut]
  return typeof query === 'function' ? query(shape) : query
}

function frameUrl(opts, tMs) {
  const params = new URLSearchParams({
    shape: opts.shape,
    clock: 'virtual',
    t: String(Math.round(tMs)),
    ...queryOf(opts.cut, opts.shape),
    ...(opts.scene ? { scene: opts.scene } : {}),
    ...(opts.room ?? {}),
  })
  if (opts['site-name'] && opts.cut !== 'alert') params.set('site_name', opts['site-name'])
  return `${opts['base-url']}${CUTS[opts.cut].page ?? '/screen'}?${params}`
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
const frameTime = (opts, frame) => opts.startMs + ((frame * 1000) / opts.fps) * (CUTS[opts.cut].rate ?? 1)

async function openPage(browser, opts, tMs) {
  const page = await browser.newPage()
  const { width, height, scale = 1 } = SHAPES[opts.shape]
  await page.setViewport({ width, height, deviceScaleFactor: scale })
  // Background tabs pause requestAnimationFrame, so evacClock.set() would resolve before painting.
  await page.bringToFront()
  await page.goto(frameUrl(opts, tMs), { waitUntil: 'networkidle0' })
  await page.waitForSelector(CUTS[opts.cut].ready, { timeout: READY_TIMEOUT_MS })
  return page
}

// Live screens only show approved bulletins and read approvals once on mount, so approve every
// bulletin that becomes a screen (and turn auto-publish on) before the first page opens.
async function approveLive(browser, opts) {
  const { approve } = CUTS[opts.cut]
  const query = queryOf(opts.cut, opts.shape)
  if (query.mode !== 'live' || approve === false) return null
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
    modes.add(await seek(page, opts, frameTime(opts, frame)))
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
    const eventFrame = Math.round(((eventMs - startMs) / 1000 / (CUTS[opts.cut].rate ?? 1)) * opts.fps)
    frames.push(eventFrame - 1, eventFrame)
  }
  return [...new Set(frames)].filter((f) => f >= 0 && f < opts.frameCount).sort((a, b) => a - b)
}

async function diffStats(fileA, fileB) {
  const { stdout } = await run('ffmpeg', [
    '-loglevel', 'error', '-i', fileA, '-i', fileB,
    '-lavfi', '[0][1]blend=all_mode=difference,format=gray', '-f', 'rawvideo', '-',
  ], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
  const { width } = await imageSize(fileA)
  let max = 0
  let pixels = 0
  const box = { x0: Infinity, y0: Infinity, x1: -1, y1: -1 }
  for (let i = 0; i < stdout.length; i++) {
    if (stdout[i] === 0) continue
    const x = i % width
    const y = Math.floor(i / width)
    max = Math.max(max, stdout[i])
    pixels++
    box.x0 = Math.min(box.x0, x)
    box.y0 = Math.min(box.y0, y)
    box.x1 = Math.max(box.x1, x)
    box.y1 = Math.max(box.y1, y)
  }
  return { max, pixels, bbox: pixels ? `${box.x0},${box.y0}-${box.x1},${box.y1}` : '-' }
}

async function imageSize(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file])
  const [width, height] = stdout.trim().split(',').map(Number)
  return { width, height }
}

// Re-shoots each sample time on a fresh page that jumps from t=0 straight to t through the same
// seek path as the recording, so a pass also proves the frame does not depend on the frames before
// it. Comparing against a page opened directly at t would mix two Chrome rasterization paths, which
// differ by 1/255 on text that is mid scale-in.
async function verify(browser, opts, framesDir) {
  const results = []
  for (const frame of verifyFrames(opts)) {
    const page = await openPage(browser, opts, 0)
    await seek(page, opts, frameTime(opts, frame))
    const again = `${framesDir}verify_${frameName(frame)}.png`
    await page.screenshot({ path: again, type: 'png' })
    await page.close()
    const original = `${framesDir}${frameName(frame)}.png`
    const identical = (await readFile(original)).equals(await readFile(again))
    const diff = identical ? null : await diffStats(original, again)
    results.push({ frame: frame + 1, tMs: Math.round(frameTime(opts, frame)), identical, diff })
  }
  return results
}

async function encode(opts, framesDir) {
  await mkdir(SCREENS_DIR, { recursive: true })
  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-framerate', String(opts.fps),
    '-i', `${framesDir}%05d.png`,
    // yuv420p needs even sides; the half-scale pillar is 2523 px tall.
    '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-an',
    opts.out,
  ])
}

async function main() {
  const opts = await options()
  const framesDir = opts['frames-dir'] ? `${opts['frames-dir'].replace(/\/$/, '')}/` : `${FRAMES_ROOT}${opts.window ?? opts.shape}_${opts.cut}/`
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
    const verdict = c.identical
      ? 'identical'
      : `DIFFERS max_delta=${c.diff.max} pixels=${c.diff.pixels} bbox=${c.diff.bbox}`
    console.log(`VERIFY frame=${c.frame} t_ms=${c.tMs} ${verdict}`)
  }
  if (checks.some((c) => !c.identical)) {
    console.log(`VERIFY FAILED ${checks.filter((c) => !c.identical).length}/${checks.length} frames differ`)
    process.exitCode = 1
  }
}

await main()
