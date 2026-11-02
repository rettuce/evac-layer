// Records examples/minimal-cms in real time against an EVAC LAYER feed, then cuts the moments
// its state changes into a short clip with the CMS log burned in (cut 9 picture-in-picture).
//
//   node demo/capture/pip_cms.mjs [--seconds 65] [--base-url http://127.0.0.1:3151] [--port 8091]
//
// Output: demo/capture/out/cut09_pip.mp4 (1280x860: the 1280x720 player with the CMS log in a band
// below it, 30 fps, no audio) and cut09_pip_raw.mp4.
import { execFile, spawn } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { parseArgs, promisify } from 'node:util'

const require = createRequire(new URL('../../app/package.json', import.meta.url))
const puppeteer = require('puppeteer-core')
const run = promisify(execFile)

const REPO = fileURLToPath(new URL('../../', import.meta.url))
const OUT_DIR = fileURLToPath(new URL('./out/', import.meta.url))
const FRAMES_DIR = fileURLToPath(new URL('../cache/pip_frames/', import.meta.url))
const CHROME_PATH = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const FONT = fileURLToPath(new URL('../compose/fonts/NotoSansJP-Bold.otf', import.meta.url))
const SITE = '05210-demo-honjo-station'
const SITE_FILE = fileURLToPath(new URL('../../data/sites/05210-demo.json', import.meta.url))
const VIEW = { width: 1280, height: 720 }
const SHOT_INTERVAL_MS = 100
const BEFORE_S = 1.2
const AFTER_S = 2.0
const LOG_LINES = 3
const LOG_BAND_PX = 140
// The moments shown, by the bulletin the feed switches to: Lv3 appears, Lv5, the all-clear.
const PICKED_BULLETINS = ['VXKOii-202610211555', 'VXKOii-202610211945', 'VXKOii-202610220620']

const { values: opts } = parseArgs({
  options: {
    seconds: { type: 'string', default: '65' },
    'base-url': { type: 'string', default: 'http://127.0.0.1:3151' },
    port: { type: 'string', default: '8091' },
  },
})

function startCms(log, startedAt) {
  const child = spawn(process.execPath, ['examples/minimal-cms/index.mjs'], {
    cwd: REPO,
    env: { ...process.env, EVAC_FEED: `${opts['base-url']}/api/feed/${SITE}`, SHAPE: '16x9', PORT: opts.port },
  })
  let buffer = ''
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop()
    for (const line of lines) log.push({ t: (performance.now() - startedAt) / 1000, line })
  })
  return child
}

async function waitFor(log, pattern) {
  while (!log.some((entry) => pattern.test(entry.line))) await new Promise((resolve) => setTimeout(resolve, 100))
}

// The feed replays once from the first request after the server starts and then stays ambient,
// so restart the shared replay clock right before recording.
async function restartReplay() {
  const { replay } = JSON.parse(await readFile(SITE_FILE, 'utf8'))
  const params = new URLSearchParams({ municipality: replay.municipality, speed: String(replay.speed), from: replay.from, to: replay.to, reset: '1' })
  const res = await fetch(`${opts['base-url']}/api/replay?${params}`)
  if (!res.ok) throw new Error(`replay reset answered ${res.status}`)
}

async function capture(log, startedAt) {
  const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true })
  const page = await browser.newPage()
  await page.setViewport({ ...VIEW, deviceScaleFactor: 1 })
  await page.goto(`http://127.0.0.1:${opts.port}/`)
  const frames = []
  const endAt = performance.now() + Number(opts.seconds) * 1000
  while (performance.now() < endAt) {
    const shotAt = performance.now()
    const path = `${FRAMES_DIR}${String(frames.length).padStart(5, '0')}.png`
    await page.screenshot({ path })
    frames.push({ t: (shotAt - startedAt) / 1000, path })
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, SHOT_INTERVAL_MS - (performance.now() - shotAt))))
  }
  await browser.close()
  return frames
}

async function encodeRaw(frames, out) {
  const listing = frames.map((frame, i) => {
    const next = frames[i + 1]?.t ?? frame.t + SHOT_INTERVAL_MS / 1000
    return `file '${frame.path}'\nduration ${(next - frame.t).toFixed(4)}\n`
  })
  const listPath = `${FRAMES_DIR}frames.txt`
  await writeFile(listPath, listing.join('') + `file '${frames.at(-1).path}'\n`)
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listPath,
    '-vf', 'fps=30', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-an', out])
  return frames[0].t
}

function stateOf(line) {
  const [, state, bulletin] = line.split(' ')
  return `${state} ${bulletin ?? ''}`
}

function changes(log) {
  const states = log.filter((entry) => /^\d{4}-/.test(entry.line))
  return states.filter((entry, i) => i > 0 && stateOf(entry.line) !== stateOf(states[i - 1].line))
}

function shortLine(line) {
  const [iso, state, bulletin = ''] = line.split(' ')
  return `${iso.slice(11, 19)}Z  ${state.padEnd(7)} ${bulletin}`
}

async function cut(log, rawStart, raw, out) {
  const moments = changes(log).filter((entry) => PICKED_BULLETINS.some((id) => entry.line.includes(id)))
  if (moments.length !== PICKED_BULLETINS.length) {
    throw new Error(`saw ${moments.length} of ${PICKED_BULLETINS.length} picked switches; start the server and record right away`)
  }
  const parts = []
  for (const [i, moment] of moments.entries()) {
    const from = Math.max(0, moment.t - BEFORE_S - rawStart)
    const shown = log.filter((entry) => /^\d{4}-/.test(entry.line) && entry.t <= moment.t).slice(-LOG_LINES)
    const textPath = `${FRAMES_DIR}log_${i}.txt`
    await writeFile(textPath, `minimal CMS · feed ${SITE}\n` + shown.map((entry) => shortLine(entry.line)).join('\n'))
    const part = `${FRAMES_DIR}part_${i}.mp4`
    const text = `pad=iw:ih+${LOG_BAND_PX}:0:0:color=0x111111,` +
      `drawtext=fontfile='${FONT}':textfile='${textPath}':fontcolor=white:fontsize=22:line_spacing=6:x=24:y=h-text_h-16`
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', from.toFixed(3), '-i', raw, '-t', String(BEFORE_S + AFTER_S),
      '-vf', text, '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-an', part])
    parts.push(part)
  }
  const listPath = `${FRAMES_DIR}parts.txt`
  await writeFile(listPath, parts.map((part) => `file '${part}'\n`).join(''))
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', out])
  return moments
}

async function main() {
  await rm(FRAMES_DIR, { recursive: true, force: true })
  await mkdir(FRAMES_DIR, { recursive: true })
  await mkdir(OUT_DIR, { recursive: true })
  await restartReplay()
  const startedAt = performance.now()
  const log = []
  const cms = startCms(log, startedAt)
  try {
    await waitFor(log, /minimal CMS on/)
    const frames = await capture(log, startedAt)
    const raw = `${OUT_DIR}cut09_pip_raw.mp4`
    const rawStart = await encodeRaw(frames, raw)
    const out = `${OUT_DIR}cut09_pip.mp4`
    const moments = await cut(log, rawStart, raw, out)
    for (const entry of log) console.log(`LOG t=${entry.t.toFixed(2)} ${entry.line}`)
    console.log(`PIP ${out} changes=${moments.length} frames=${frames.length} raw=${raw}`)
  } finally {
    cms.kill()
  }
}

await main()
