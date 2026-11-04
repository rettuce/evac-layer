// Records a wgl lab sketch in real time as the reference clip for an ambient scene.
//
//   node demo/capture/wgl_ref.mjs --sketch stream-hatch [--base-url http://127.0.0.1:3170] [--seconds 5] [--settle 4]
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
    'base-url': { type: 'string', default: 'http://127.0.0.1:3170' },
    seconds: { type: 'string', default: '5' },
    settle: { type: 'string', default: '4' },
  },
})
if (!values.sketch) throw new Error('--sketch is required (a wgl lab slug)')

await mkdir(OUT_DIR, { recursive: true })
const webm = `${OUT_DIR}${values.sketch}.webm`
const mp4 = `${OUT_DIR}${values.sketch}.mp4`
const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true, args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage()
  await page.setViewport(VIEW)
  await page.goto(`${values['base-url']}/lab/${values.sketch}`, { waitUntil: 'networkidle0', timeout: 120000 })
  await page.waitForSelector('canvas', { timeout: 60000 })
  await new Promise((resolve) => setTimeout(resolve, Number(values.settle) * 1000))
  const recorder = await page.screencast({ path: webm })
  await new Promise((resolve) => setTimeout(resolve, Number(values.seconds) * 1000))
  await recorder.stop()
} finally {
  await browser.close()
}
await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-t', values.seconds, '-vf', `scale=${OUT_SIZE},fps=30`, '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-an', mp4])
console.log(`WGL_REF ${values.sketch} → ${mp4}`)
