// Records cut 7m from mosaic.html frame by frame (deterministic in t) into demo/capture/out/cut07m.mp4.
//   node demo/capture/mosaic_layouts.mjs   # the tiles and manifest first
//   node demo/capture/mosaic.mjs [--seconds 12]
// Also writes out/mosaic/last-frame.png and out/mosaic/contact.png (one frame per second).
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const require = createRequire(new URL('../../app/package.json', import.meta.url))
const puppeteer = require('puppeteer-core')

const CHROME_PATH = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const REPO = fileURLToPath(new URL('../../', import.meta.url))
const OUT = fileURLToPath(new URL('out/', import.meta.url))
const FPS = 30
const TYPES = { '.html': 'text/html', '.json': 'application/json', '.jpg': 'image/jpeg', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.mjs': 'text/javascript' }

const { values } = parseArgs({ options: { seconds: { type: 'string', default: '12' } } })

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')
  const file = join(REPO, path)
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file')
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    createReadStream(file).pipe(res)
  } catch {
    res.writeHead(404).end()
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

function ffmpeg(args) {
  const child = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] })
  const done = new Promise((resolve, reject) => child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)))))
  return { child, done }
}
const write = (stream, chunk) => new Promise((resolve) => (stream.write(chunk) ? resolve() : stream.once('drain', resolve)))

const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
  page.on('pageerror', (error) => console.error(`PAGE ${error.message}`))
  await page.goto(`${base}/demo/capture/mosaic.html`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('body[data-ready="1"]', { timeout: 60000 })
  const info = await page.evaluate(() => {
    const { count, rowHeight, endRate, rects } = window.mosaicInfo()
    let overlaps = 0
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]
        const b = rects[j]
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlaps++
      }
    }
    const outside = rects.filter((r) => r.x < 0 || r.y < 0 || r.x + r.w > 1920 || r.y + r.h > 1080).length
    const minGap = Math.min(...rects.flatMap((a, i) => rects.slice(i + 1).map((b) => Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h)))))
    return { count, rowHeight, endRate, overlaps, outside, minGap }
  })
  console.log(`MOSAIC ${JSON.stringify(info)}`)
  const frames = Math.round(Number(values.seconds) * FPS)
  const video = ffmpeg(['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', 'pipe:0', '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-crf', '16', '-r', String(FPS), '-movflags', '+faststart', `${OUT}cut07m.mp4`])
  for (let f = 0; f < frames; f++) {
    await page.evaluate((t) => window.mosaicAt(t), f / FPS)
    const png = await page.screenshot({ type: 'png' })
    await write(video.child.stdin, png)
    if (f === Math.round(9.4 * FPS)) await page.screenshot({ path: `${OUT}mosaic/last-frame.png` })
  }
  video.child.stdin.end()
  await video.done
} finally {
  await browser.close()
  server.close()
}

const contact = ffmpeg(['-y', '-loglevel', 'error', '-i', `${OUT}cut07m.mp4`, '-vf', 'fps=1,scale=480:-1,tile=4x3', '-frames:v', '1', `${OUT}mosaic/contact.png`])
contact.child.stdin.end()
await contact.done
console.log(`WROTE ${OUT}cut07m.mp4`)
