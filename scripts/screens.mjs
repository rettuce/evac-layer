import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(new URL('../app/package.json', import.meta.url))
const puppeteer = require('puppeteer-core')

const CHROME_PATH = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const OUT_DIR = `${ROOT}docs/screens/`
const MUNICIPALITY = '05210'
const SITE_NAME = '羽後本荘駅前'
const GALLERY_WIDTH = 1280
const PILLAR_SCALE = 0.25
const STRIP_FRAME_WIDTH = 640
const MAX_BYTES = 300 * 1024
const BULLETINS = [
  ['lv3', 'VXKOii-202610211555-d5ccc7c6b547'],
  ['lv4', 'VXKOii-202610211815-e713da0e3c05'],
  ['lv5', 'VXKOii-202610211945-a25f8f3aba7d'],
  ['clear', 'VXKOii-202610220620-74a7831c8a40'],
]
const SHAPES = {
  '16x9': [1920, 1080],
  '9x16': [1080, 1920],
  '32x9': [3840, 1080],
  '1x1': [1080, 1080],
  pillar: [6616, 5046],
}
const SCENES = ['color-planes', 'clock-grid']
const SWITCH_AT_MS = 12000
const SWITCH_FRAMES_MS = [11500, 11800, 12100, 12400, 12700, 13000]
const READY_TIMEOUT_MS = 30000

function scaleFor(shape, width) {
  return shape === 'pillar' ? PILLAR_SCALE : Math.min(1, GALLERY_WIDTH / width)
}

async function freePort() {
  return new Promise((resolve) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

async function startServer() {
  const port = await freePort()
  const child = spawn(process.execPath, [`${ROOT}app/.output/server/index.mjs`], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NUXT_ADMIN_TOKEN: '' },
    stdio: 'ignore',
  })
  const base = `http://127.0.0.1:${port}`
  for (let i = 0; i < 100; i++) {
    if (await fetch(`${base}/screen`).then((r) => r.ok, () => false)) return { base, child }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  child.kill()
  throw new Error(`production server did not start on ${base}`)
}

function previewSrc(bulletin, shape) {
  return encodeURIComponent(`/api/admin/preview-layout?municipality=${MUNICIPALITY}&bulletin=${bulletin}&shape=${shape}`)
}

async function capture(page, url, shape, ready, scale) {
  const [width, height] = SHAPES[shape]
  await page.setViewport({ width, height, deviceScaleFactor: scale ?? scaleFor(shape, width) })
  await page.goto(url, { waitUntil: 'networkidle0' })
  await page.waitForSelector(ready, { timeout: READY_TIMEOUT_MS })
  return page
}

// Smooth colour fields compress badly as PNG; posterizing them (fewer levels per channel) keeps the
// picture and brings the file under the gallery limit without an image library.
const POSTERIZE_STEPS = [8, 16]

async function posterize(page, png, step) {
  const data = await page.evaluate(
    async (base64, step) => {
      const img = new Image()
      img.src = `data:image/png;base64,${base64}`
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const pixels = ctx.getImageData(0, 0, img.width, img.height)
      for (let i = 0; i < pixels.data.length; i += 4) {
        for (let c = 0; c < 3; c++) pixels.data[i + c] = Math.min(255, Math.round(pixels.data[i + c] / step) * step)
      }
      ctx.putImageData(pixels, 0, 0)
      return canvas.toDataURL('image/png').split(',')[1]
    },
    png.toString('base64'),
    step,
  )
  return Buffer.from(data, 'base64')
}

async function save(page, name, png) {
  const path = `${OUT_DIR}${name}.png`
  let bytes = png ?? Buffer.from(await page.screenshot({ type: 'png' }))
  for (const step of POSTERIZE_STEPS) {
    if (bytes.length <= MAX_BYTES) break
    bytes = await posterize(page, bytes, step)
  }
  await writeFile(path, bytes)
  return { name, size: bytes.length }
}

async function layoutInfo(bulletin) {
  const layout = JSON.parse(await readFile(`${ROOT}data/layouts/${MUNICIPALITY}/${bulletin}/16x9.json`, 'utf8'))
  const cell = (role) => layout.cells.find((c) => c.role === role)
  return {
    issued: layout.alert.issued_at.slice(0, 16).replace('T', ' '),
    headline: cell('headline')?.text.ja ?? '',
    level: layout.template === 'all-clear' ? '解除' : `警戒レベル${layout.alert.level}`,
    template: layout.template,
    source: cell('source')?.text.ja ?? '',
  }
}

async function switchStrip(browser, base, bulletin) {
  const frames = []
  const page = await browser.newPage()
  for (const t of SWITCH_FRAMES_MS) {
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: STRIP_FRAME_WIDTH / 1920 })
    await page.goto(
      `${base}/screen?shape=16x9&clock=virtual&t=${t}&mode=scenario&scenario=switch&t_switch=${SWITCH_AT_MS}&scene=color-planes&site_name=${encodeURIComponent(SITE_NAME)}&src=${previewSrc(bulletin, '16x9')}`,
      { waitUntil: 'networkidle0' },
    )
    await page.waitForSelector('[data-scenario] [data-layer="ambient"][data-ready="1"]', { timeout: READY_TIMEOUT_MS })
    frames.push({ t, data: (await page.screenshot({ type: 'png', encoding: 'base64' })).toString() })
  }
  const height = Math.round((STRIP_FRAME_WIDTH * 9) / 16)
  await page.setViewport({ width: STRIP_FRAME_WIDTH * frames.length, height, deviceScaleFactor: 1 })
  await page.setContent(
    `<body style="margin:0;display:flex">${frames.map((f) => `<img src="data:image/png;base64,${f.data}" width="${STRIP_FRAME_WIDTH}" height="${height}">`).join('')}</body>`,
    { waitUntil: 'load' },
  )
  const result = await save(page, 'switch-16x9-strip', Buffer.from(await page.screenshot({ type: 'png' })))
  await page.close()
  return result
}

function markdown(infos, files) {
  const sizeOf = (name) => files.find((f) => f.name === name)
  const lines = [
    '# Screens',
    '',
    'Every screen below is drawn from a real bulletin of the Japan Meteorological Agency (Yurihonjo, Akita, 21–22 Oct 2026: the Koyoshi River flood sequence). The wording is written by the Writer agent from the municipal hazard map and checked by the Verifier (static, browser and vision).',
    '全部、気象庁の実際の電文（秋田県由利本荘市・2026-10-21〜22 の子吉川の洪水）から作った画面です。文言は Writer が自治体のハザードマップから書き、Verifier（静的・ブラウザ・画像）が検査しています。',
    '',
    'Regenerate with `pnpm -F app screens` (production build, loopback admin preview).',
    '',
  ]
  for (const [shape] of Object.entries(SHAPES)) {
    lines.push(`## ${shape === 'pillar' ? 'pillar (four faces round a column, shown at 0.25)' : shape}`, '')
    for (const [key] of BULLETINS) {
      const info = infos[key]
      const name = `${key}-${shape}`
      if (!sizeOf(name)) continue
      lines.push(`![${info.headline} (${shape})](screens/${name}.png)`, '')
      lines.push(`${info.issued} JST · ${info.headline} · ${info.level} — source line: ${info.source}`, '')
    }
  }
  lines.push('## Ambient (no alert)', '')
  for (const scene of SCENES) {
    for (const shape of ['16x9', 'pillar']) {
      lines.push(`![ambient ${scene} (${shape})](screens/ambient-${scene}-${shape}.png)`, '')
      lines.push(`Ambient scene \`${scene}\` on ${shape}${shape === 'pillar' ? ' (the whole column as one picture, shown at 1280 wide)' : ''}; the clock, the site name and the power-outage notice sit in one corner (once on the front face of a pillar).`, '')
    }
  }
  lines.push('## Switch (ambient → alert)', '')
  lines.push('![switch](screens/switch-16x9-strip.png)', '')
  lines.push(`16:9 at t = ${SWITCH_FRAMES_MS.map((t) => (t / 1000).toFixed(1)).join(', ')} s: ambient, 300 ms of black at ${(SWITCH_AT_MS / 1000).toFixed(1)} s, then the level-4 screen scales in once.`, '')
  return `${lines.join('\n')}\n`
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const { base, child } = await startServer()
  const browser = await puppeteer.launch({ executablePath: CHROME_PATH })
  try {
    const page = await browser.newPage()
    const files = []
    const infos = {}
    for (const [key, bulletin] of BULLETINS) {
      infos[key] = await layoutInfo(bulletin)
      for (const shape of Object.keys(SHAPES)) {
        await capture(page, `${base}/screen?shape=${shape}&clock=virtual&t=5000&src=${previewSrc(bulletin, shape)}`, shape, '.evac-screen[data-ready="1"]')
        files.push(await save(page, `${key}-${shape}`))
      }
    }
    for (const scene of SCENES) {
      for (const shape of ['16x9', 'pillar']) {
        await capture(
          page,
          `${base}/screen?shape=${shape}&clock=virtual&t=4000&mode=scenario&scenario=ambient&scene=${scene}&site_name=${encodeURIComponent(SITE_NAME)}&src=${previewSrc(BULLETINS[1][1], shape)}`,
          shape,
          '[data-layer="ambient"][data-ready="1"]',
          Math.min(1, GALLERY_WIDTH / SHAPES[shape][0]),
        )
        files.push(await save(page, `ambient-${scene}-${shape}`))
      }
    }
    files.push(await switchStrip(browser, base, BULLETINS[1][1]))
    await writeFile(`${ROOT}docs/screens.md`, markdown(infos, files))
    for (const f of files) console.log(`${f.size > MAX_BYTES ? 'OVER' : 'ok  '} ${(f.size / 1024).toFixed(0).padStart(4)} KB ${f.name}.png`)
    if (files.some((f) => f.size > MAX_BYTES)) process.exitCode = 1
  } finally {
    await browser.close()
    child.kill()
  }
}

await main()
