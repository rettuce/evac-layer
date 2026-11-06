import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { fitUnder } from './png-budget.mjs'
import { startServer } from './prod-server.mjs'

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
// The official JMA sample tsunami bulletins (marked as a drill) for Yoshida, Shizuoka: the major warning
// on the two widest shapes and the all-clear.
const TSUNAMI_MUNICIPALITY = '22424'
const TSUNAMI = [
  ['tsunami-major', 'VTSE41-201609010713-ff3dd5d5c94f', ['16x9', '32x9']],
  ['tsunami-clear', 'VTSE41-201609010955-5a813306d772', ['16x9']],
]
const SITE_FILE = 'demo/sites/honjo-station/site.json'
const SHAPES = {
  '16x9': [1920, 1080],
  '9x16': [1080, 1920],
  '32x9': [3840, 1080],
  '1x1': [1080, 1080],
  pillar: [6616, 5046],
}
const SCENES = ['quad-subdivision']
const SWITCH_AT_MS = 12000
const SWITCH_FRAMES_MS = [11500, 11800, 12100, 12400, 12700, 13000]
const READY_TIMEOUT_MS = 30000
// The first language pair (easy Japanese + English) is up and the action's pulse is at full opacity:
// 480 + 2000 × 7 (pulse period 2000 from the end of the scale-in), 1.98 s into the pair's second round.
const ALERT_AT_MS = 14480

function scaleFor(shape, width) {
  return shape === 'pillar' ? PILLAR_SCALE : Math.min(1, GALLERY_WIDTH / width)
}

function previewSrc(bulletin, shape, municipality = MUNICIPALITY) {
  return encodeURIComponent(`/api/admin/preview-layout?municipality=${municipality}&bulletin=${bulletin}&shape=${shape}`)
}

async function capture(page, url, shape, ready, scale) {
  const [width, height] = SHAPES[shape]
  await page.setViewport({ width, height, deviceScaleFactor: scale ?? scaleFor(shape, width) })
  await page.goto(url, { waitUntil: 'networkidle0' })
  await page.waitForSelector(ready, { timeout: READY_TIMEOUT_MS })
  return page
}

async function save(page, name, png) {
  const path = `${OUT_DIR}${name}.png`
  const bytes = await fitUnder(page, png ?? Buffer.from(await page.screenshot({ type: 'png' })), MAX_BYTES)
  await writeFile(path, bytes)
  return { name, size: bytes.length }
}

async function layoutInfo(base, bulletin, municipality = MUNICIPALITY) {
  const layout = await (await fetch(`${base}${decodeURIComponent(previewSrc(bulletin, '16x9', municipality))}`)).json()
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
      `${base}/screen?shape=16x9&clock=virtual&t=${t}&mode=scenario&scenario=switch&t_switch=${SWITCH_AT_MS}&scene=quad-subdivision&site_name=${encodeURIComponent(SITE_NAME)}&src=${previewSrc(bulletin, '16x9')}`,
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
    `Every screen below is drawn from a bulletin of the Japan Meteorological Agency: the Koyoshi River flood in Yurihonjo, Akita, from the bulletins actually issued on 21–22 Oct 2026, and the tsunami in Yoshida, Shizuoka, from JMA's official sample bulletins. The samples are drill bulletins, so every screen made from them says so. The Writer (Claude) writes the wording from the municipality's hazard map, and the Verifier checks every screen by rules, in a browser and by Vision. Each still is taken at ${ALERT_AT_MS / 1000} s, while the language row shows *yasashii nihongo* and English.`,
    `気象庁の電文から作った画面です。秋田県由利本荘市の子吉川の洪水は、2026 年 10 月 21〜22 日に実際に発表された電文から、静岡県吉田町の津波は、気象庁の公式のサンプル電文から作りました。サンプルは訓練の電文なので、画面にも【訓練】と出ます。文言は Writer（Claude）が自治体のハザードマップをもとに書き、Verifier が規則・ブラウザ・Vision の 3 段で検査しています。どの画面も、言語の欄にやさしい日本語と英語が出ている ${ALERT_AT_MS / 1000} 秒の時点で撮りました。`,
    '',
    'To regenerate: `pnpm -F app screens` (builds the app for production and captures each screen from the admin preview on localhost).',
    '',
  ]
  for (const [shape] of Object.entries(SHAPES)) {
    lines.push(`## ${shape === 'pillar' ? 'pillar (an LED wrapped round a column, four faces, shown at 1/4 size)' : shape}`, '')
    for (const [key] of BULLETINS) {
      const info = infos[key]
      const name = `${key}-${shape}`
      if (!sizeOf(name)) continue
      lines.push(`![${info.headline} (${shape})](screens/${name}.png)`, '')
      lines.push(`${info.issued} JST · ${info.headline} · ${info.level} — source shown on the screen: ${info.source}`, '')
    }
  }
  lines.push('## Tsunami (Yoshida, Shizuoka — official sample bulletins, drill)', '')
  for (const [key, , shapes] of TSUNAMI) {
    const info = infos[key]
    for (const shape of shapes) {
      lines.push(`![${info.headline} (${shape})](screens/${key}-${shape}.png)`, '')
      lines.push(`${info.issued} JST · ${info.headline} · ${info.level} — source shown on the screen: ${info.source}`, '')
    }
  }
  lines.push('## Ambient (no warning in force)', '')
  for (const scene of SCENES) {
    for (const shape of ['16x9', 'pillar']) {
      lines.push(`![ambient ${scene} (${shape})](screens/ambient-${scene}-${shape}.png)`, '')
      lines.push(shape === 'pillar'
        ? `The ambient scene \`${scene}\` on the pillar, the whole column as one picture (shown 1280 px wide). The time, the site name and its latitude and longitude appear once, in a corner of the front face.`
        : `The ambient scene \`${scene}\` on ${shape}. One corner shows the time, the site name and its latitude and longitude.`, '')
    }
  }
  lines.push('## Switch (ambient → warning)', '')
  lines.push('![switch](screens/switch-16x9-strip.png)', '')
  lines.push(`16:9 at t = ${SWITCH_FRAMES_MS.map((t) => (t / 1000).toFixed(1)).join(', ')} s: ambient content, 300 ms of black from ${(SWITCH_AT_MS / 1000).toFixed(1)} s, then the level 4 screen scales in once.`, '')
  return `${lines.join('\n')}\n`
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const { base, child } = await startServer()
  const browser = await puppeteer.launch({ executablePath: CHROME_PATH, args: ['--disable-gpu-rasterization'] })
  try {
    const page = await browser.newPage()
    const files = []
    const infos = {}
    for (const [key, bulletin] of BULLETINS) {
      infos[key] = await layoutInfo(base, bulletin)
      for (const shape of Object.keys(SHAPES)) {
        await capture(page, `${base}/screen?shape=${shape}&clock=virtual&t=${ALERT_AT_MS}&src=${previewSrc(bulletin, shape)}`, shape, '.evac-screen[data-ready="1"]')
        files.push(await save(page, `${key}-${shape}`))
      }
    }
    for (const [key, bulletin, shapes] of TSUNAMI) {
      infos[key] = await layoutInfo(base, bulletin, TSUNAMI_MUNICIPALITY)
      for (const shape of shapes) {
        await capture(page, `${base}/screen?shape=${shape}&clock=virtual&t=${ALERT_AT_MS}&src=${previewSrc(bulletin, shape, TSUNAMI_MUNICIPALITY)}`, shape, '.evac-screen[data-ready="1"]')
        files.push(await save(page, `${key}-${shape}`))
      }
    }
    const site = JSON.parse(await readFile(`${ROOT}${SITE_FILE}`, 'utf8'))
    for (const scene of SCENES) {
      for (const shape of ['16x9', 'pillar']) {
        await capture(
          page,
          `${base}/screen?shape=${shape}&clock=virtual&t=4000&mode=scenario&scenario=ambient&scene=${scene}&site_name=${encodeURIComponent(SITE_NAME)}&lat=${site.lat}&lng=${site.lng}&src=${previewSrc(BULLETINS[1][1], shape)}`,
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
