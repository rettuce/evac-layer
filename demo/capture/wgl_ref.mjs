// Records a wgl lab sketch in real time as the reference clip for an ambient scene.
//
//   node demo/capture/wgl_ref.mjs --sketch stream-hatch [--base-url http://127.0.0.1:3170] [--seconds 5] [--settle 4]
//   node demo/capture/wgl_ref.mjs --name painterly-flow --url https://wgl.ie3.jp/?set=painterly-flow [--seconds 10]
//
// Output: demo/out/ambient/ref/<sketch>.mp4 (640x360, 30 fps, no audio), via a 1280x720 screencast.
import { execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { parseArgs, promisify } from 'node:util'

const require = createRequire(new URL('../../app/package.json', import.meta.url))
const puppeteer = require('puppeteer-core')
const run = promisify(execFile)

const OUT_DIR = fileURLToPath(new URL('../out/ambient/ref/', import.meta.url))
const CHROME_PATH = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VIEW = { width: 1280, height: 720 }
const OUT_SIZE = '640:360'

const { values } = parseArgs({
  options: {
    sketch: { type: 'string' },
    name: { type: 'string' },
    url: { type: 'string' },
    'base-url': { type: 'string', default: 'http://127.0.0.1:3170' },
    seconds: { type: 'string', default: '5' },
    settle: { type: 'string', default: '4' },
  },
})
const name = values.name ?? values.sketch
if (!name) throw new Error('--sketch (a wgl lab slug) or --name with --url is required')
const pageUrl = values.url ?? `${values['base-url']}/lab/${values.sketch}`

await mkdir(OUT_DIR, { recursive: true })
const webm = `${OUT_DIR}${name}.webm`
const mp4 = `${OUT_DIR}${name}.mp4`
const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true, args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage()
  await page.setViewport(VIEW)
  await page.goto(pageUrl, { waitUntil: 'networkidle0', timeout: 120000 })
  await page.waitForSelector('canvas', { timeout: 60000 })
  await new Promise((resolve) => setTimeout(resolve, Number(values.settle) * 1000))
  const recorder = await page.screencast({ path: webm })
  await new Promise((resolve) => setTimeout(resolve, Number(values.seconds) * 1000))
  await recorder.stop()
} finally {
  await browser.close()
}
await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-t', values.seconds, '-vf', `scale=${OUT_SIZE},fps=30`, '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-an', mp4])
console.log(`WGL_REF ${name} → ${mp4}`)
