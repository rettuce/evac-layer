// Records a command with macOS `script -r`, then redraws the recording in xterm.js frame by frame
// and encodes it, so terminal cuts are as exact as the screen recordings.
//
//   node demo/capture/terminal.mjs --name cut06 --cmd "<shell command>" [--show "<command typed on screen>"]
//   node demo/capture/terminal.mjs --name cut06 --rec demo/capture/out/cut06.rec [--show "..."]
//
// Output: demo/capture/out/<name>.mp4 (1920x1080, 30 fps, no audio) and <name>.rec.
import { execFile, spawn } from 'node:child_process'
import { access, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs, promisify } from 'node:util'

const require = createRequire(new URL('../../app/package.json', import.meta.url))
const puppeteer = require('puppeteer-core')
const run = promisify(execFile)

const OUT_DIR = fileURLToPath(new URL('./out/', import.meta.url))
const CACHE_DIR = fileURLToPath(new URL('../cache/terminal/', import.meta.url))
const CHROME_PATH = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const CJK_FONT = fileURLToPath(new URL('../compose/fonts/NotoSansJP-Bold.otf', import.meta.url))
const ASSETS = {
  'xterm.js': 'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.js',
  'xterm.css': 'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.css',
  'LICENSE-xterm.txt': 'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/LICENSE',
  'jetbrains-mono.woff2': 'https://cdn.jsdelivr.net/npm/@fontsource/jetbrains-mono@5.0.20/files/jetbrains-mono-latin-400-normal.woff2',
  'LICENSE-jetbrains-mono.txt': 'https://cdn.jsdelivr.net/npm/@fontsource/jetbrains-mono@5.0.20/LICENSE',
}
const SIZE = { width: 1920, height: 1080 }
const COLS = 120
const ROWS = 30
const FPS = 30
const MAX_IDLE_S = 1.5
const FONT_PX = 24
const TYPE_CPS = 40
const PROMPT = '\x1b[38;5;245m$\x1b[0m '
// `script` echoes the EOF it sends when stdin is not a terminal.
const EOF_ECHO = '^D\b\b'

const { values: opts } = parseArgs({
  options: {
    name: { type: 'string' },
    cmd: { type: 'string' },
    rec: { type: 'string' },
    show: { type: 'string' },
  },
})

async function ensureAssets() {
  await mkdir(CACHE_DIR, { recursive: true })
  for (const [file, url] of Object.entries(ASSETS)) {
    const path = `${CACHE_DIR}${file}`
    try {
      await access(path)
    } catch {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`${url} answered ${res.status}`)
      await writeFile(path, Buffer.from(await res.arrayBuffer()))
    }
  }
}

async function record(command, recPath) {
  // stdin must not be a pipe: script(1) gives up with "tcgetattr/ioctl: Operation not supported on socket".
  // A command that exits non-zero is still a recording worth rendering, so only an empty file is an error.
  const child = spawn('script', ['-q', '-r', recPath, 'sh', '-c', `stty cols ${COLS} rows ${ROWS}; ${command}`], {
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  await new Promise((resolve) => child.on('exit', resolve))
  if ((await stat(recPath)).size === 0) throw new Error(`script recorded nothing: ${stderr.trim()}`)
}

function parseRecording(buffer) {
  const events = []
  let start = null
  for (let i = 0; i < buffer.length;) {
    const length = Number(buffer.readBigUInt64LE(i))
    const seconds = Number(buffer.readBigUInt64LE(i + 8)) + buffer.readUInt32LE(i + 16) / 1e6
    const direction = String.fromCharCode(buffer.readUInt32LE(i + 20))
    const data = buffer.subarray(i + 24, i + 24 + length).toString('utf8')
    i += 24 + length
    start ??= seconds
    if (direction === 'o' && data !== EOF_ECHO) events.push({ real: seconds - start, data })
    if (direction === 'e') events.push({ real: seconds - start, data: '' })
  }
  return events
}

// Idle stretches longer than MAX_IDLE_S are shortened on screen; the real elapsed time is kept
// alongside so the corner clock never pretends the run was faster than it was.
function compress(events, offset) {
  let shown = offset
  let previous = 0
  return events.map((event) => {
    shown += Math.min(event.real - previous, MAX_IDLE_S)
    previous = event.real
    return { ...event, shown }
  })
}

function typedPreroll(show) {
  const events = [{ shown: 0, real: null, data: PROMPT }]
  if (!show) return { events, duration: 0.3 }
  ;[...show].forEach((char, i) => events.push({ shown: 0.4 + i / TYPE_CPS, real: null, data: char }))
  const end = 0.4 + show.length / TYPE_CPS + 0.3
  events.push({ shown: end, real: null, data: '\r\n' })
  return { events, duration: end + 0.1 }
}

function pageHtml() {
  const asset = (file) => pathToFileURL(`${CACHE_DIR}${file}`).href
  return `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="${asset('xterm.css')}">
<style>
@font-face{font-family:"JetBrains Mono";src:url("${asset('jetbrains-mono.woff2')}")}
@font-face{font-family:"Noto Sans JP";src:url("${pathToFileURL(CJK_FONT).href}")}
html,body{margin:0;background:#101114;width:${SIZE.width}px;height:${SIZE.height}px;overflow:hidden}
#term{position:absolute;left:48px;top:64px}
#clock{position:absolute;right:40px;top:18px;color:#8a8f98;font:22px "Noto Sans JP",sans-serif}
</style><div id="clock"></div><div id="term"></div><script src="${asset('xterm.js')}"></script>`
}

async function render(events, realTotal, out, framesDir) {
  const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true, args: ['--allow-file-access-from-files'] })
  const page = await browser.newPage()
  await page.setViewport({ ...SIZE, deviceScaleFactor: 1 })
  const htmlPath = `${framesDir}page.html`
  await writeFile(htmlPath, pageHtml())
  await page.goto(pathToFileURL(htmlPath).href)
  await page.evaluate(async ({ cols, rows, fontPx }) => {
    await document.fonts.load(`${fontPx}px "JetBrains Mono"`)
    await document.fonts.load(`${fontPx}px "Noto Sans JP"`)
    window.term = new window.Terminal({
      cols, rows, fontSize: fontPx, lineHeight: 1.0, fontFamily: '"JetBrains Mono", "Noto Sans JP", monospace',
      theme: { background: '#101114', foreground: '#e6e6e6' }, cursorBlink: false, allowProposedApi: true,
    })
    const host = document.getElementById('term')
    window.term.open(host)
    host.style.left = `${Math.round((window.innerWidth - host.offsetWidth) / 2)}px`
    window.writeAll = (chunks) => new Promise((resolve) => window.term.write(chunks.join(''), resolve))
  }, { cols: COLS, rows: ROWS, fontPx: FONT_PX })
  const duration = events.at(-1).shown + 1.0
  let next = 0
  for (let frame = 0; frame < Math.ceil(duration * FPS); frame++) {
    const t = frame / FPS
    const chunks = []
    let real = null
    while (next < events.length && events[next].shown <= t) {
      chunks.push(events[next].data)
      if (events[next].real !== null) real = events[next].real
      next++
    }
    const clock = real === null ? '' : `実時間 ${Math.min(real, realTotal).toFixed(1)} s`
    await page.evaluate(async (pending, label) => {
      if (pending.length) await window.writeAll(pending)
      if (label) document.getElementById('clock').textContent = label
    }, chunks, clock)
    await page.screenshot({ path: `${framesDir}${String(frame).padStart(5, '0')}.png` })
  }
  await browser.close()
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', `${framesDir}%05d.png`,
    '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', '-an', out])
  return duration
}

async function main() {
  if (!opts.name || (!opts.cmd && !opts.rec)) throw new Error('usage: --name <cut> (--cmd "<command>" | --rec <file>) [--show "<typed>"]')
  await mkdir(OUT_DIR, { recursive: true })
  await ensureAssets()
  const recPath = opts.rec ?? `${OUT_DIR}${opts.name}.rec`
  if (opts.cmd) await record(opts.cmd, recPath)
  const recorded = parseRecording(await readFile(recPath))
  const preroll = typedPreroll(opts.show)
  const realTotal = recorded.at(-1)?.real ?? 0
  const events = [...preroll.events, ...compress(recorded, preroll.duration)]
  const framesDir = `${CACHE_DIR}frames_${opts.name}/`
  await rm(framesDir, { recursive: true, force: true })
  await mkdir(framesDir, { recursive: true })
  const out = `${OUT_DIR}${opts.name}.mp4`
  const started = performance.now()
  const duration = await render(events, realTotal, out, framesDir)
  await rm(framesDir, { recursive: true, force: true })
  console.log(`TERMINAL ${out} duration_s=${duration.toFixed(2)} real_s=${realTotal.toFixed(2)} ` +
    `events=${recorded.length} render_s=${((performance.now() - started) / 1000).toFixed(1)}`)
}

await main()
