// Pre-recorded ambient loops for the sim: the whole room canvas (crops.json `canvas`, 11000×2600) rendered frame
// by frame on the virtual clock, folded into a seamless 24 s loop, and written twice, since 11000 px exceeds
// H.264's decode limits: <scene>-4k.mp4 (H.264 High, 4096×968, CRF 22) for every decoder and <scene>-8k.mp4
// (HEVC hvc1 Main, 8192×1936, CRF 24). Every display mesh cuts its own window out of the one texture.
//
//   node demo/capture/ambient_loops.mjs --scenes brush-flow,ink-bloom [--seconds 26] [--loop 24] [--fold 2] [--base-url http://127.0.0.1:3151]
//   node demo/capture/ambient_loops.mjs --scenes brush-flow --encode-only   # fold and encode again from the kept raw renders
//   node demo/capture/ambient_loops.mjs --alert [--municipality 05210 --bulletin <id>] [--alert-dir <dir>]   # still PNGs of the alert faces, one per language pair
//
// Output: demo/out/ambient/loops/<scene>-{4k,8k}.mp4 (30 fps, keyframes every 2 s, faststart, bit rate capped so a
// loop stays around 20 MB / 50 MB) and demo/out/ambient/loops/alert/<crop>/<pair>.png. The near-lossless renders
// (CRF 12, 26 s) stay in demo/out/ambient/loops/raw/ so the loops can be re-encoded without rendering again.
import { execFile, spawn } from 'node:child_process'
import { copyFile, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { parseArgs, promisify } from 'node:util'

const require = createRequire(new URL('../../app/package.json', import.meta.url))
const puppeteer = require('puppeteer-core')
const run = promisify(execFile)

const OUT_ROOT = fileURLToPath(new URL('../out/ambient/loops/', import.meta.url))
const CROPS_PATH = fileURLToPath(new URL('../renders/canvas-crops.json', import.meta.url))
const CHROME_PATH = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const READY_SELECTOR = '[data-layer="ambient"][data-ready="1"]'
const READY_TIMEOUT_MS = 60000
const ROOM_ID = 'concourse'
const SCENARIO = { mode: 'scenario', layout: 'wajima-tsunami', scenario: 'ambient' }
const KEYFRAMES = ['-r', '30', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0', '-movflags', '+faststart']
const RAW = ['-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-r', '30', '-crf', '12', '-g', '30']
const VERSIONS = {
  '4k': { size: '4096:968', encode: ['-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-crf', '26', '-maxrate', '8M', '-bufsize', '16M', ...KEYFRAMES] },
  '8k': { size: '8192:1936', encode: ['-c:v', 'libx265', '-tag:v', 'hvc1', '-profile:v', 'main', '-pix_fmt', 'yuv420p', '-crf', '28', '-maxrate', '20M', '-bufsize', '40M', '-x265-params', 'log-level=error', ...KEYFRAMES] },
}

// The alert faces: the level-4 bulletin the sim replays, laid out per shape, one still per language pair.
// t: the pair is up and the action pictogram's pulse is at full opacity (the rule of scripts/screens.mjs:
// 480 + 2000 n after the scale-in, inside the pair's 2.5 s slot of the second rotation from 12.5 s).
// The band shows nine languages after the Japanese headline: four pairs and Indonesian alone in the fifth slot.
const PAIR_T_MS = { 'ja_easy-en': 14480, 'zh_hans-zh_hant': 16480, 'ko-th': 18480, 'vi-tl': 22480, id: 24480 }
const SHAPE_VIEWPORTS = {
  '16x9': { width: 1920, height: 1080 },
  '9x16': { width: 1080, height: 1920 },
  '32x9': { width: 3840, height: 1080 },
  pillar: { width: 6616, height: 5046, scale: 0.5 },
}

const { values } = parseArgs({
  options: {
    scenes: { type: 'string' },
    alert: { type: 'boolean', default: false },
    municipality: { type: 'string', default: '05210' },
    bulletin: { type: 'string', default: 'VXKOii-202610211815-e713da0e3c05' },
    'alert-dir': { type: 'string' },
    seconds: { type: 'string', default: '26' },
    loop: { type: 'string', default: '24' },
    fold: { type: 'string', default: '2' },
    fps: { type: 'string', default: '30' },
    'base-url': { type: 'string', default: process.env.EVAC_URL ?? 'http://127.0.0.1:3151' },
    out: { type: 'string', default: OUT_ROOT },
    'encode-only': { type: 'boolean', default: false },
  },
})
const fps = Number(values.fps)
const outRoot = values.out.endsWith('/') ? values.out : `${values.out}/`
const { canvas, crops, shapes } = JSON.parse(await readFile(CROPS_PATH, 'utf8'))

function scaleFilter() {
  const names = Object.keys(VERSIONS)
  const split = `[0:v]split=${names.length}${names.map((_, i) => `[s${i}]`).join('')}`
  return [split, ...names.map((v, i) => `[s${i}]scale=${VERSIONS[v].size}:flags=lanczos[o${i}]`)].join(';')
}

function spawnFfmpeg(args) {
  const child = spawn('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: ['pipe', 'inherit', 'inherit'] })
  const done = new Promise((resolve, reject) => {
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))))
  })
  return { child, done }
}

function write(stream, chunk) {
  return new Promise((resolve, reject) => {
    const ok = stream.write(chunk, (error) => (error ? reject(error) : undefined))
    if (ok) resolve()
    else stream.once('drain', resolve)
  })
}

async function seek(page, tMs) {
  await page.evaluate(async (t) => {
    await window.evacClock.set(t)
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  }, tMs)
}

const rawPath = (scene, v) => `${outRoot}raw/${scene}-${v}.mp4`

async function renderScene(browser, scene) {
  const versions = Object.keys(VERSIONS)
  await mkdir(`${outRoot}raw/`, { recursive: true })
  const page = await browser.newPage()
  await page.setViewport({ width: canvas[0], height: canvas[1], deviceScaleFactor: 1 })
  await page.bringToFront()
  const params = new URLSearchParams({
    ...SCENARIO, scene, clock: 'virtual', t: '0', overlay: 'none',
    canvas: `${canvas[0]}x${canvas[1]}`, crop: `0,0,${canvas[0]},${canvas[1]}`, canvas_id: ROOM_ID,
  })
  await page.goto(`${values['base-url']}/screen?${params}`, { waitUntil: 'networkidle0' })
  await page.waitForSelector(READY_SELECTOR, { timeout: READY_TIMEOUT_MS })
  const frameCount = Math.round(Number(values.seconds) * fps)
  const outputs = versions.flatMap((v, i) => ['-map', `[o${i}]`, ...RAW, rawPath(scene, v)])
  const { child, done } = spawnFfmpeg(['-f', 'image2pipe', '-framerate', String(fps), '-i', 'pipe:0', '-filter_complex', scaleFilter(), ...outputs])
  const started = Date.now()
  for (let frame = 0; frame < frameCount; frame++) {
    await seek(page, (frame * 1000) / fps)
    const png = await page.screenshot({ type: 'png' })
    await write(child.stdin, png)
    if (frame % 150 === 0) console.log(`FRAME ${scene} ${frame}/${frameCount} ${((Date.now() - started) / 1000).toFixed(0)}s`)
  }
  child.stdin.end()
  await done
  await page.close()
}

async function encodeScene(scene) {
  const sizes = []
  for (const [v, spec] of Object.entries(VERSIONS)) {
    const out = `${outRoot}${scene}-${v}.mp4`
    await fold(rawPath(scene, v), out, spec.encode)
    const bytes = (await stat(out)).size
    sizes.push(`${v} ${(bytes / 1e6).toFixed(1)} MB (${((bytes * 8) / Number(values.loop) / 1e6).toFixed(1)} Mbps)`)
  }
  console.log(`LOOPS ${scene} ${Number(values.loop)} s: ${sizes.join(' / ')}`)
}

async function recordScene(browser, scene) {
  if (!values['encode-only']) await renderScene(browser, scene)
  await encodeScene(scene)
}

// The last `fold` seconds cross-fade into the first `fold` seconds, so frame `loop` continues into frame 0.
// The encoder's first keyframes come out 20-30 % smaller than the steady state (rate control warming up), which
// showed as a brightness step at the loop point, so PREROLL_S of the loop's tail is encoded first and cut off at the
// keyframe boundary with a stream copy.
const PREROLL_S = 6
async function fold(raw, out, encode) {
  const loop = Number(values.loop)
  const f = Number(values.fold)
  const graph = [
    `[0:v]trim=0:${loop},setpts=PTS-STARTPTS,split=3[m1][m2][m3]`,
    `[0:v]trim=${loop}:${loop + f},setpts=PTS-STARTPTS[tail]`,
    `[m1]trim=0:${f},setpts=PTS-STARTPTS[head]`,
    `[m2]trim=${f}:${loop},setpts=PTS-STARTPTS[rest]`,
    `[m3]trim=${loop - PREROLL_S}:${loop},setpts=PTS-STARTPTS[pre]`,
    `[tail][head]blend=all_expr='A*(1-T/${f})+B*(T/${f})'[xf]`,
    `[pre][xf][rest]concat=n=3:v=1[out]`,
  ].join(';')
  const prerolled = out.replace(/\.mp4$/, '.preroll.mp4')
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-filter_complex', graph, '-map', '[out]', ...encode, prerolled])
  const tag = encode.includes('-tag:v') ? ['-tag:v', encode[encode.indexOf('-tag:v') + 1]] : []
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(PREROLL_S), '-i', prerolled, '-c', 'copy', ...tag, '-movflags', '+faststart', out])
  await rm(prerolled)
}

async function recordAlert(browser) {
  const alertRoot = values['alert-dir'] ? `${values['alert-dir'].replace(/\/$/, '')}/` : `${outRoot}alert/`
  const byShape = {}
  for (const name of Object.keys(crops)) (byShape[shapes[name]] ??= []).push(name)
  for (const [shape, names] of Object.entries(byShape)) {
    const viewport = SHAPE_VIEWPORTS[shape]
    const page = await browser.newPage()
    await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.scale ?? 1 })
    await page.bringToFront()
    const src = `/api/admin/preview-layout?${new URLSearchParams({ municipality: values.municipality, bulletin: values.bulletin, shape })}`
    const first = names[0]
    const [, , w, h] = crops[first]
    const dir = `${alertRoot}${first}/`
    await mkdir(dir, { recursive: true })
    for (const [pair, tMs] of Object.entries(PAIR_T_MS)) {
      const params = new URLSearchParams({ shape, clock: 'virtual', t: String(tMs), src })
      await page.goto(`${values['base-url']}/screen?${params}`, { waitUntil: 'networkidle0' })
      await page.waitForSelector('.evac-screen[data-ready="1"]', { timeout: READY_TIMEOUT_MS })
      const shot = `${dir}${pair}.full.png`
      await page.screenshot({ path: shot, type: 'png' })
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', shot, '-vf', `scale=${w}:${h}:flags=lanczos`, `${dir}${pair}.png`])
      await rm(shot)
    }
    await page.close()
    for (const other of names.slice(1)) {
      const odir = `${alertRoot}${other}/`
      await mkdir(odir, { recursive: true })
      for (const pair of Object.keys(PAIR_T_MS)) await copyFile(`${dir}${pair}.png`, `${odir}${pair}.png`)
    }
    console.log(`ALERT ${shape} → ${names.join(' ')} (${Object.keys(PAIR_T_MS).length} pairs each, ${w}x${h})`)
  }
}

const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
try {
  if (values.alert) await recordAlert(browser)
  for (const scene of values.scenes ? values.scenes.split(',') : []) await recordScene(browser, scene)
} finally {
  await browser.close()
}
