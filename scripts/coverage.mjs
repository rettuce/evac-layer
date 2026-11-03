import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { CABINET_OFFICE_5, contrastRatio, inkOn, rgbCss } from '../app/layout/palette.ts'
import { shapeForViewport, viewportFromQuery } from '../app/layout/shapes.ts'
import { fitUnder } from './png-budget.mjs'
import { startServer } from './prod-server.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(new URL('../app/package.json', import.meta.url))
const puppeteer = require('puppeteer-core')

const CHROME_PATH = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const WIDTH = 1920
const MARGIN = 64
const MAX_BYTES = 300 * 1024
const WCAG_AA = 4.5
const MUNICIPALITY = '05210'
const BULLETIN = 'VXKOii-202610211815-e713da0e3c05'
const EXAMPLE_LAYOUT = `data/layouts/${MUNICIPALITY}/${BULLETIN}/16x9.json`
const FONT_PACKAGES = ['noto-sans-jp', 'noto-sans', 'noto-sans-sc', 'noto-sans-tc', 'noto-sans-kr']
const READY_TIMEOUT_MS = 30000
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

const LANGUAGES = [
  ['ja', '日本語'],
  ['ja_easy', 'やさしい日本語'],
  ['en', 'English'],
  ['zh_hans', '简体中文'],
  ['zh_hant', '繁體中文'],
  ['ko', '한국어'],
]

const SWEEP = ['32:9', '3:1', '21:9', '2:1', '16:9', '16:10', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '10:16', '9:16', '1:2']
const NATIVE_ASPECTS = new Set(['32:9', '16:9', '1:1', '9:16'])
const PILLAR_ASPECT = 6616 / 5046
const THUMB_HEIGHT = 170
const THUMB_GAP = 28
const THUMB_ROW = THUMB_HEIGHT + 64

function esc(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function text(x, y, content, { size, weight = 400, fill = INK, font = FONT.ja, anchor = 'start' } = {}) {
  return `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${fill}"${anchor === 'start' ? '' : ` text-anchor="${anchor}"`}>${esc(content)}</text>`
}

function titled(x, y, ja, en, jaSize, enSize) {
  return `<text x="${x}" y="${y}" font-family="${FONT.ja}" font-size="${jaSize}" font-weight="700" fill="${INK}">${esc(ja)}<tspan dx="${enSize * 0.8}" font-family="${FONT.en}" font-size="${enSize}" font-weight="400" fill="${SUB}">${esc(en)}</tspan></text>`
}

function heading(x, y, ja, en) {
  return titled(x, y, ja, en, 30, 20)
}

function sheet(height, parts) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height}" width="${WIDTH}" height="${height}">\n<rect width="${WIDTH}" height="${height}" fill="#fff"/>\n${parts.join('\n')}\n</svg>\n`
}

async function pictogramSvg(id, x, y, size, color) {
  const source = await readFile(`${ROOT}app/public/picto/${id}.svg`, 'utf8')
  return source.replace('<svg ', `<svg x="${x}" y="${y}" width="${size}" height="${size}" color="${color}" `)
}

async function hazardsSheet() {
  const parts = [titled(MARGIN, 96, 'EVAC LAYER が扱う災害情報', 'Hazards and warning levels', 44, 24)]
  const y = 168
  const bandWidth = 760
  parts.push(heading(MARGIN, y, '災害の種別', 'Hazards from JMA bulletins'))
  for (const [i, hazard] of HAZARDS.entries()) {
    const top = y + 24 + i * 84
    const background = CABINET_OFFICE_5[hazard.level]
    const ink = rgbCss(inkOn(background))
    parts.push(`<rect x="${MARGIN}" y="${top}" width="${bandWidth}" height="68" fill="${rgbCss(background)}"/>`)
    parts.push(await pictogramSvg(hazard.pictogram, MARGIN + 16, top + 10, 48, ink))
    parts.push(text(MARGIN + 80, top + 46, hazard.headline, { size: 30, weight: 700, fill: ink }))
    parts.push(text(MARGIN + bandWidth + 32, top + 32, hazard.ja, { size: 26, weight: 700 }))
    parts.push(text(MARGIN + bandWidth + 32, top + 60, `${hazard.en} · 気象庁 ${hazard.jma}`, { size: 20, fill: SUB, font: FONT.en }))
  }
  const levelsY = 572
  const gap = 16
  const boxWidth = (WIDTH - MARGIN * 2 - gap * 4) / 5
  parts.push(heading(MARGIN, levelsY, '警戒レベル 1〜5', 'Cabinet Office warning levels'))
  for (const level of [5, 4, 3, 2, 1]) {
    const background = CABINET_OFFICE_5[level]
    const inkRgb = inkOn(background)
    const ratio = contrastRatio(background, inkRgb)
    if (ratio < WCAG_AA) throw new Error(`level ${level} band ink contrast ${ratio.toFixed(2)} is below ${WCAG_AA}:1`)
    const left = MARGIN + (5 - level) * (boxWidth + gap)
    const ink = rgbCss(inkRgb)
    parts.push(`<rect x="${left}" y="${levelsY + 24}" width="${boxWidth}" height="120" fill="${rgbCss(background)}" stroke="${level === 1 ? RULE : 'none'}"/>`)
    parts.push(text(left + 20, levelsY + 80, `警戒レベル${level}`, { size: 32, weight: 700, fill: ink }))
    parts.push(text(left + 20, levelsY + 124, `コントラスト比 ${ratio.toFixed(1)} : 1`, { size: 20, fill: ink, font: FONT.en }))
  }
  parts.push(text(MARGIN, levelsY + 184, '内閣府 2020 年改定の原典色。帯の文字は自動で白／黒を選び、すべて 4.5 : 1 以上（WCAG AA）', { size: 20, fill: SUB }))
  return sheet(levelsY + 224, parts)
}

async function pictogramIds() {
  const schema = JSON.parse(await readFile(`${ROOT}schema/layout.schema.json`, 'utf8'))
  const ids = schema.$defs.pictogram.enum
  const missing = ids.filter((id) => !PICTOGRAM_MEANING[id])
  if (ids.length !== 14 || missing.length) throw new Error(`pictogram registry has ${ids.length} ids; no meaning for: ${missing.join(', ')}`)
  return ids
}

async function pictogramsSheet(ids, action) {
  const parts = [titled(MARGIN, 96, 'EVAC LAYER が扱う災害情報', 'Pictograms and languages', 44, 24)]
  const y = 168
  const cell = 124
  parts.push(heading(MARGIN, y, `図記号 ${ids.length} 種`, 'Pictograms'))
  const rows = [
    ['災害', HAZARD_PICTOGRAMS],
    ['行動・場所', ids.filter((id) => !HAZARD_PICTOGRAMS.includes(id))],
  ]
  for (const [r, [label, row]] of rows.entries()) {
    const top = y + 36 + r * 162
    parts.push(text(MARGIN, top, label, { size: 18, weight: 700, fill: SUB }))
    for (const [i, id] of row.entries()) {
      const [ja, en] = PICTOGRAM_MEANING[id]
      const center = MARGIN + i * cell + cell / 2
      parts.push(await pictogramSvg(id, center - 32, top + 14, 64, INK))
      parts.push(text(center, top + 108, ja, { size: ja.length > 5 ? 15 : 20, weight: 700, anchor: 'middle' }))
      parts.push(text(center, top + 130, en, { size: 15, fill: SUB, font: FONT.en, anchor: 'middle' }))
    }
  }
  const original = ids.length - MATERIAL_PICTOGRAMS.length - 1
  parts.push(text(MARGIN, y + 356, `Material Symbols ${MATERIAL_PICTOGRAMS.length} 種（Apache-2.0）・方向の矢印は Material の形をもとに再描画`, { size: 17, fill: SUB }))
  parts.push(text(MARGIN, y + 380, `ほか ${original} 種は EVAC LAYER の自作。台風・高潮・地震は図記号だけを用意している（気象庁の電文から画面を作れるのは大雨・土砂災害・洪水・津波）`, { size: 17, fill: SUB }))
  const right = 1000
  parts.push(heading(right, y, '言語', 'Languages — level 4 action text'))
  for (const [i, [key, label]] of LANGUAGES.entries()) {
    const baseline = y + 62 + i * 52
    parts.push(text(right, baseline, label, { size: 20, fill: SUB, font: FONT[key] ?? FONT.ja }))
    parts.push(text(right + 180, baseline, action[key], { size: 32, weight: 700, font: FONT[key] ?? FONT.ja }))
  }
  return sheet(y + 420, parts)
}

async function renderThumb(page, base, aspect) {
  const { width, height } = viewportFromQuery(undefined, undefined, aspect)
  const family = shapeForViewport(width, height)
  await page.setViewport({ width, height, deviceScaleFactor: (THUMB_HEIGHT * 2) / height })
  const src = encodeURIComponent(`/api/admin/preview-layout?municipality=${MUNICIPALITY}&bulletin=${BULLETIN}&shape=${family}`)
  await page.goto(`${base}/screen?aspect=${aspect}&clock=virtual&t=5000&src=${src}`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.evac-screen[data-ready="1"]', { timeout: READY_TIMEOUT_MS })
  const state = await page.$eval('.evac-screen', (el) => ({
    overflow: el.dataset.overflow ?? '',
    dropped: el.dataset.dropped ?? '',
    missing: el.dataset.missingRequired ?? '',
  }))
  if (state.overflow || state.missing) throw new Error(`${aspect} (${family}) overflow=${state.overflow} missing=${state.missing}`)
  const png = Buffer.from(await page.screenshot({ type: 'png' }))
  return { aspect, ratio: width / height, family, dropped: state.dropped, href: `data:image/png;base64,${png.toString('base64')}` }
}

async function pillarThumb() {
  const png = await readFile(`${ROOT}docs/screens/lv4-pillar.png`)
  return { aspect: '柱（4 面）', ratio: PILLAR_ASPECT, family: 'pillar', dropped: '', href: `data:image/png;base64,${png.toString('base64')}` }
}

function shapesSheet(thumbs) {
  const parts = [titled(MARGIN, 96, 'どんな画角でも、同じ案内。', 'Any aspect, the same guidance.', 44, 24)]
  parts.push(text(MARGIN, 140, `同じ電文（由利本荘・警戒レベル 4）を ${thumbs.length} の画角で描いたもの。画面の縦横比にいちばん近い基準形状（32:9・16:9・1:1・9:16）を選び、その配置を画面に合わせて伸縮する`, { size: 20, fill: SUB }))
  let x = MARGIN
  let y = 176
  for (const thumb of thumbs) {
    const width = Math.round(THUMB_HEIGHT * thumb.ratio)
    if (x + width > WIDTH - MARGIN) {
      x = MARGIN
      y += THUMB_ROW
    }
    parts.push(`<image x="${x}" y="${y}" width="${width}" height="${THUMB_HEIGHT}" href="${thumb.href}" preserveAspectRatio="none"/>`)
    parts.push(`<rect x="${x}" y="${y}" width="${width}" height="${THUMB_HEIGHT}" fill="none" stroke="${RULE}"/>`)
    const native = NATIVE_ASPECTS.has(thumb.aspect) || thumb.family === 'pillar'
    parts.push(text(x, y + THUMB_HEIGHT + 30, thumb.aspect, { size: 22, weight: 700, font: FONT.en }))
    if (!native) parts.push(text(x, y + THUMB_HEIGHT + 52, `基準形状 ${thumb.family.replace('x', ':')}`, { size: 16, fill: SUB, font: FONT.en }))
    x += width + THUMB_GAP
  }
  const bottom = y + THUMB_ROW
  parts.push(text(MARGIN, bottom + 16, '基準形状が 1:1 の画面（1:1・4:5）では、優先度の低い言語の並記を省く（1:1 では避難場所も省く）。4:3・5:4 は 16:9 を基準にするので避難場所まで表示する。必須の項目はどの画角でも表示される', { size: 18, fill: SUB }))
  return sheet(bottom + 48, parts)
}

function fontLinks() {
  return FONT_PACKAGES.flatMap((name) =>
    ['400', '700'].map((weight) => `<link rel="stylesheet" href="${pathToFileURL(`${ROOT}app/node_modules/@fontsource/${name}/${weight}.css`).href}">`),
  ).join('')
}

async function writeSheet(page, name, svg) {
  const height = Number(svg.match(/viewBox="0 0 \d+ (\d+)"/)[1])
  await writeFile(`${ROOT}docs/${name}.svg`, svg)
  const htmlPath = `${ROOT}tmp/${name}.html`
  await writeFile(htmlPath, `<!doctype html><meta charset="utf-8">${fontLinks()}<style>body{margin:0;background:#fff}</style>${svg}`)
  await page.setViewport({ width: WIDTH, height, deviceScaleFactor: 1 })
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
  const png = await fitUnder(page, Buffer.from(await page.screenshot({ type: 'png' })), MAX_BYTES)
  if (png.length > MAX_BYTES) throw new Error(`docs/${name}.png is ${png.length} bytes, over ${MAX_BYTES}`)
  await writeFile(`${ROOT}docs/${name}.png`, png)
  console.log(`docs/${name}.png ${WIDTH}x${height} ${png.length} B · .svg ${Buffer.byteLength(svg)} B`)
}

const ids = await pictogramIds()
const layout = JSON.parse(await readFile(`${ROOT}${EXAMPLE_LAYOUT}`, 'utf8'))
const action = layout.cells.find((c) => c.role === 'action').text
const { base, child } = await startServer()
const browser = await puppeteer.launch({ executablePath: CHROME_PATH, args: ['--allow-file-access-from-files'] })
try {
  const page = await browser.newPage()
  const thumbs = []
  for (const aspect of SWEEP) thumbs.push(await renderThumb(page, base, aspect))
  thumbs.push(await pillarThumb())
  for (const t of thumbs) console.log(`${t.aspect.padEnd(8)} ${t.family.padEnd(6)} dropped=${t.dropped || '-'}`)
  await writeSheet(page, 'coverage-hazards', await hazardsSheet())
  await writeSheet(page, 'coverage-pictograms', await pictogramsSheet(ids, action))
  await writeSheet(page, 'coverage-shapes', shapesSheet(thumbs))
} finally {
  await browser.close()
  child.kill()
}
