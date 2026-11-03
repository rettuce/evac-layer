import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { CABINET_OFFICE_5, contrastRatio, inkOn, rgbCss } from '../app/layout/palette.ts'
import { fitUnder } from './png-budget.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(new URL('../app/package.json', import.meta.url))
const puppeteer = require('puppeteer-core')

const CHROME_PATH = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const WIDTH = 1920
const HEIGHT = 1080
const MARGIN = 64
const MAX_BYTES = 300 * 1024
const WCAG_AA = 4.5
const EXAMPLE_LAYOUT = 'data/layouts/05210/VXKOii-202610211815-e713da0e3c05/16x9.json'
const FONT_PACKAGES = ['noto-sans-jp', 'noto-sans', 'noto-sans-sc', 'noto-sans-tc', 'noto-sans-kr']
const INK = '#000'
const SUB = '#555'
const RULE = '#d0d0d0'

const FONT = {
  ja: "'Noto Sans JP', sans-serif",
  en: "'Noto Sans', 'Noto Sans JP', sans-serif",
  zh_hans: "'Noto Sans SC', sans-serif",
  zh_hant: "'Noto Sans TC', sans-serif",
  ko: "'Noto Sans KR', sans-serif",
}

const HAZARDS = [
  { ja: '大雨', en: 'Heavy rain', jma: 'VPWW55', level: 3, headline: 'レベル３大雨警報', pictogram: 'heavy_rain' },
  { ja: '土砂災害', en: 'Landslide', jma: 'VPWW56', level: 4, headline: 'レベル４土砂災害危険警報', pictogram: 'landslide' },
  { ja: '洪水（指定河川）', en: 'River flood', jma: 'VXKOnn', level: 5, headline: 'レベル５氾濫特別警報', pictogram: 'flood' },
  { ja: '津波', en: 'Tsunami', jma: 'VTSE41', level: 3, headline: '津波警報', pictogram: 'tsunami' },
]

const PICTOGRAM_MEANING = {
  tsunami: ['津波', 'Tsunami'],
  flood: ['洪水', 'Flood'],
  landslide: ['土砂災害', 'Landslide'],
  heavy_rain: ['大雨', 'Heavy rain'],
  cyclone: ['台風', 'Typhoon'],
  storm_surge: ['高潮', 'Storm surge'],
  earthquake: ['地震', 'Earthquake'],
  directions_run: ['避難する', 'Evacuate'],
  go_higher: ['高い所へ', 'Go higher'],
  safe_here: ['解除・安全', 'All clear'],
  arrow_forward: ['方向', 'Direction'],
  my_location: ['現在地', 'You are here'],
  emergency_evacuation_site: ['指定緊急避難場所', 'Evacuation site'],
  evacuation_shelter: ['指定避難所', 'Shelter'],
}
const HAZARD_PICTOGRAMS = ['tsunami', 'flood', 'landslide', 'heavy_rain', 'cyclone', 'storm_surge', 'earthquake']
const MATERIAL_PICTOGRAMS = ['tsunami', 'flood', 'landslide', 'cyclone', 'directions_run', 'my_location']
const REDRAWN_MATERIAL = 'arrow_forward'

const LANGUAGES = [
  ['ja', '日本語'],
  ['ja_easy', 'やさしい日本語'],
  ['en', 'English'],
  ['zh_hans', '简体中文'],
  ['zh_hant', '繁體中文'],
  ['ko', '한국어'],
]

const SHAPES = [
  ['16x9', '16:9', 1920 / 1080],
  ['9x16', '9:16', 1080 / 1920],
  ['32x9', '32:9', 3840 / 1080],
  ['1x1', '1:1', 1],
  ['pillar', '柱（4 面）', 6616 / 5046],
]
const THUMB_HEIGHT = 120

function esc(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function text(x, y, content, { size, weight = 400, fill = INK, font = FONT.ja, anchor = 'start', opacity } = {}) {
  const extra = `${anchor === 'start' ? '' : ` text-anchor="${anchor}"`}${opacity === undefined ? '' : ` fill-opacity="${opacity}"`}`
  return `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${fill}"${extra}>${esc(content)}</text>`
}

function titled(x, y, ja, en, jaSize, enSize) {
  return `<text x="${x}" y="${y}" font-family="${FONT.ja}" font-size="${jaSize}" font-weight="700" fill="${INK}">${esc(ja)}<tspan dx="${enSize * 0.8}" font-family="${FONT.en}" font-size="${enSize}" font-weight="400" fill="${SUB}">${esc(en)}</tspan></text>`
}

function heading(x, y, ja, en) {
  return titled(x, y, ja, en, 30, 20)
}

async function pictogramSvg(id, x, y, size, color) {
  const source = await readFile(`${ROOT}app/public/picto/${id}.svg`, 'utf8')
  return source.replace('<svg ', `<svg x="${x}" y="${y}" width="${size}" height="${size}" color="${color}" `)
}

async function pictogramIds() {
  const schema = JSON.parse(await readFile(`${ROOT}schema/layout.schema.json`, 'utf8'))
  return schema.$defs?.pictogram?.enum ?? schema.definitions?.pictogram?.enum
}

async function hazardSection(x, y) {
  const parts = [heading(x, y, '災害の種別', 'Hazards from JMA bulletins')]
  const bandWidth = 600
  for (const [i, hazard] of HAZARDS.entries()) {
    const top = y + 24 + i * 84
    const background = CABINET_OFFICE_5[hazard.level]
    const ink = rgbCss(inkOn(background))
    parts.push(`<rect x="${x}" y="${top}" width="${bandWidth}" height="68" fill="${rgbCss(background)}"/>`)
    parts.push(await pictogramSvg(hazard.pictogram, x + 16, top + 10, 48, ink))
    parts.push(text(x + 80, top + 46, hazard.headline, { size: 30, weight: 700, fill: ink }))
    parts.push(text(x + bandWidth + 24, top + 32, hazard.ja, { size: 24, weight: 700 }))
    parts.push(text(x + bandWidth + 24, top + 58, `${hazard.en} · 気象庁 ${hazard.jma}`, { size: 18, fill: SUB, font: FONT.en }))
  }
  return parts.join('')
}

function levelSection(x, y, width) {
  const parts = [heading(x, y, '警戒レベル 1〜5', 'Cabinet Office warning levels')]
  const gap = 14
  const boxWidth = (width - gap * 4) / 5
  for (const level of [5, 4, 3, 2, 1]) {
    const background = CABINET_OFFICE_5[level]
    const inkRgb = inkOn(background)
    const ratio = contrastRatio(background, inkRgb)
    if (ratio < WCAG_AA) throw new Error(`level ${level} band ink contrast ${ratio.toFixed(2)} is below ${WCAG_AA}:1`)
    const left = x + (5 - level) * (boxWidth + gap)
    const ink = rgbCss(inkRgb)
    parts.push(`<rect x="${left}" y="${y + 24}" width="${boxWidth}" height="100" fill="${rgbCss(background)}" stroke="${level === 1 ? RULE : 'none'}"/>`)
    parts.push(text(left + 14, y + 66, `警戒レベル${level}`, { size: 22, weight: 700, fill: ink }))
    parts.push(text(left + 16, y + 104, `文字 ${ratio.toFixed(1)} : 1`, { size: 18, fill: ink, font: FONT.en }))
  }
  parts.push(text(x, y + 156, '内閣府 2020 年改定の原典色。帯の文字は自動で白／黒を選び、すべて 4.5 : 1 以上（WCAG AA）', { size: 18, fill: SUB }))
  return parts.join('')
}

async function pictogramSection(x, y, ids) {
  const parts = [heading(x, y, `図記号 ${ids.length} 種`, 'Pictograms')]
  const cell = 122
  const rows = [
    ['災害', HAZARD_PICTOGRAMS],
    ['行動・場所', ids.filter((id) => !HAZARD_PICTOGRAMS.includes(id))],
  ]
  for (const [r, [label, row]] of rows.entries()) {
    const top = y + 36 + r * 162
    parts.push(text(x, top, label, { size: 18, weight: 700, fill: SUB }))
    for (const [i, id] of row.entries()) {
      const [ja, en] = PICTOGRAM_MEANING[id]
      const center = x + i * cell + cell / 2
      parts.push(await pictogramSvg(id, center - 32, top + 14, 64, INK))
      parts.push(text(center, top + 108, ja, { size: ja.length > 5 ? 15 : 20, weight: 700, anchor: 'middle' }))
      parts.push(text(center, top + 130, en, { size: 15, fill: SUB, font: FONT.en, anchor: 'middle' }))
    }
  }
  const material = MATERIAL_PICTOGRAMS.length
  const original = ids.length - material - 1
  parts.push(text(x, y + 356, `Material Symbols ${material} 種（Apache-2.0）・方向の矢印は Material の形をもとに再描画・ほか ${original} 種は EVAC LAYER の自作`, { size: 16, fill: SUB }))
  parts.push(text(x, y + 380, '台風・高潮・地震は図記号のみ用意（気象庁電文の取り込みは大雨・土砂災害・洪水・津波の 4 種別）', { size: 16, fill: SUB }))
  return parts.join('')
}

function languageSection(x, y, action) {
  const parts = [heading(x, y, '言語', 'Languages — level 4 action text')]
  for (const [i, [key, label]] of LANGUAGES.entries()) {
    const baseline = y + 42 + i * 32
    parts.push(text(x, baseline, label, { size: 18, fill: SUB, font: key === 'en' ? FONT.en : FONT[key] ?? FONT.ja }))
    parts.push(text(x + 170, baseline, action[key], { size: 24, weight: 700, font: FONT[key] ?? FONT.ja }))
  }
  return parts.join('')
}

async function thumbnails(page) {
  const out = {}
  for (const [shape, , ratio] of SHAPES) {
    const png = await readFile(`${ROOT}docs/screens/lv4-${shape}.png`)
    out[shape] = await page.evaluate(
      async (base64, width, height) => {
        const img = new Image()
        img.src = `data:image/png;base64,${base64}`
        await img.decode()
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, 0, 0, width, height)
        return canvas.toDataURL('image/png')
      },
      png.toString('base64'),
      Math.round(THUMB_HEIGHT * ratio * 2),
      THUMB_HEIGHT * 2,
    )
  }
  return out
}

function shapeSection(x, y, thumbs) {
  const parts = [heading(x, y, '画面形状', 'Screen shapes')]
  let left = x
  for (const [shape, label, ratio] of SHAPES) {
    const width = Math.round(THUMB_HEIGHT * ratio)
    parts.push(`<image x="${left}" y="${y + 20}" width="${width}" height="${THUMB_HEIGHT}" href="${thumbs[shape]}" preserveAspectRatio="none"/>`)
    parts.push(`<rect x="${left}" y="${y + 20}" width="${width}" height="${THUMB_HEIGHT}" fill="none" stroke="${RULE}"/>`)
    parts.push(text(left, y + THUMB_HEIGHT + 46, label, { size: 20, weight: 700 }))
    left += width + 36
  }
  return parts.join('')
}

async function buildSvg(page) {
  const ids = await pictogramIds()
  const missing = ids.filter((id) => !PICTOGRAM_MEANING[id])
  if (ids.length !== 14 || missing.length) throw new Error(`pictogram registry has ${ids.length} ids; no meaning for: ${missing.join(', ')}`)
  const layout = JSON.parse(await readFile(`${ROOT}${EXAMPLE_LAYOUT}`, 'utf8'))
  const action = layout.cells.find((c) => c.role === 'action').text
  const source = layout.cells.find((c) => c.role === 'source').text.ja
  const right = 1000
  const body = [
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="#fff"/>`,
    titled(MARGIN, 96, 'EVAC LAYER が扱う災害情報', 'What the screens cover', 44, 24),
    await hazardSection(MARGIN, 168),
    levelSection(MARGIN, 572, right - MARGIN - 64),
    await pictogramSection(right, 168, ids),
    languageSection(right, 590, action),
    shapeSection(MARGIN, 830, await thumbnails(page)),
    text(WIDTH - MARGIN, 1022, '出典の例 / Sources on every screen', { size: 16, fill: SUB, anchor: 'end', font: FONT.en }),
    text(WIDTH - MARGIN, 1050, source, { size: 18, anchor: 'end' }),
  ].join('\n')
  return { ids, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}">\n${body}\n</svg>\n` }
}

function fontLinks() {
  return FONT_PACKAGES.flatMap((name) =>
    ['400', '700'].map((weight) => `<link rel="stylesheet" href="${pathToFileURL(`${ROOT}app/node_modules/@fontsource/${name}/${weight}.css`).href}">`),
  ).join('')
}

const browser = await puppeteer.launch({ executablePath: CHROME_PATH, args: ['--allow-file-access-from-files'] })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 })
  await page.goto('about:blank')
  const { ids, svg } = await buildSvg(page)
  await writeFile(`${ROOT}docs/coverage.svg`, svg)
  const htmlPath = `${ROOT}tmp/coverage.html`
  await writeFile(htmlPath, `<!doctype html><meta charset="utf-8">${fontLinks()}<style>body{margin:0;background:#fff}</style>${svg}`)
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
  const png = await fitUnder(page, Buffer.from(await page.screenshot({ type: 'png' })), MAX_BYTES)
  if (png.length > MAX_BYTES) throw new Error(`docs/coverage.png is ${png.length} bytes, over ${MAX_BYTES}`)
  await writeFile(`${ROOT}docs/coverage.png`, png)
  console.log(`docs/coverage.png ${png.length} bytes · docs/coverage.svg ${Buffer.byteLength(svg)} bytes · ${ids.length} pictograms`)
} finally {
  await browser.close()
}
