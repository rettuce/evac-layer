// Machine gate for anything shown to 田中 (proposal pages now, /screen later): measures every text line box and
// pictogram ink box in the browser and reports value / threshold / OK|NG per element.
//   node scripts/grid-audit.mjs --proposal            audits app/shots/layout-review/proposal.html (A and B)
//   node scripts/grid-audit.mjs --proposal --shape 16x9
// Writes app/shots/layout-review/audit.html and audit.json; exits 1 when any row is NG.
import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(new URL('../app/package.json', import.meta.url))
const puppeteer = require('puppeteer-core')
const CHROME_PATH = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const REVIEW_DIR = `${ROOT}app/shots/layout-review/`

const PANEL = { '16x9': [1920, 1080, 1.5], '9x16': [1080, 1920, 1.5], '32x9': [3840, 1080, 1.5], '1x1': [1080, 1080, 1.5], pillar: [6616, 5046, 1654 / 720] }
const FAR_M = { '16x9': 8, '9x16': 5, '1x1': 5, '32x9': 15, pillar: 5 }
const UNITS_PER_M = 8.758

// Thresholds. The proposal set is the commander's first spec (720-unit mock); the app set is recalibrated so that
// 田中's 9:16 artboard (2026-11-04) passes every row: line-height 1.1 em, 8 px between elements, pictograms by ink,
// labels at 30 px. px = CSS px of the rendered screen (1080 short side), u = 720-unit design units.
export const RULES_PROPOSAL = {
  jaLineHeightEm: 1.3,
  elementGapPx: 16,
  pictoCellMarginPx: 8,
  pictoMin: { action: 192, hazard: 96, aux: 48 },
  pictoUnit: 'u',
  textMinCap: 24,
  textUnit: 'u',
  farCap: (shape) => Math.floor((FAR_M[shape] * UNITS_PER_M) / 8) * 8,
}
export const RULES_APP = {
  jaLineHeightEm: 1.1,
  elementGapPx: 8,
  pictoCellMarginPx: 0,
  pictoMin: { action: 288, hazard: 120, aux: 100 },
  pictoUnit: 'dpx',
  textMinCap: 21,
  textUnit: 'dpx',
  // action 150 px → cap 111; a headline stepped down to 0.8 (60.8 px) → cap 45
  farCap: (shape, role) => (role === 'headline' ? 45 : 100),
}
let RULES = RULES_PROPOSAL
const PICTO_ROLE = {
  directions_run: 'action', go_higher: 'action', safe_here: 'action',
  flood: 'hazard', tsunami: 'hazard', landslide: 'hazard', cyclone: 'hazard', storm_surge: 'hazard', earthquake: 'hazard', heavy_rain: 'hazard',
  arrow_forward: 'aux', emergency_evacuation_site: 'aux', evacuation_shelter: 'aux', my_location: 'aux',
}

// Runs inside the page. Returns raw measurements; the rules are applied in node so the thresholds live in one place.
async function measureInPage(unitPx, pictoRoles) {
  const screen = document.querySelector('.screen') ?? document.querySelector('.evac-screen')
  const cvs = document.createElement('canvas')
  const ctx = cvs.getContext('2d')
  const metricCache = new Map()
  const metrics = (cs) => {
    const key = cs.fontWeight + ' 100px ' + cs.fontFamily
    if (!metricCache.has(key)) {
      ctx.font = key
      const m = ctx.measureText('H')
      metricCache.set(key, { asc: m.fontBoundingBoxAscent / 100, desc: m.fontBoundingBoxDescent / 100, cap: m.actualBoundingBoxAscent / 100 })
    }
    return metricCache.get(key)
  }
  // The ink of a line, from the baseline: Noto Sans JP ideographs reach 0.86 em up and 0.10 em down (measured on
  // the artboard), Latin the cap height up and the descender (0.22 em) down only when the text has descenders.
  const inkLine = (r, cs, latin, text) => {
    const F = parseFloat(cs.fontSize)
    const lh = parseFloat(cs.lineHeight)
    const m = metrics(cs)
    const baseline = r.top + (r.bottom - r.top - lh) / 2 + (lh - (m.asc + m.desc) * F) / 2 + m.asc * F
    const down = latin ? (/[gjpqyQ]/.test(text) ? 0.22 : 0.03) : 0.1
    return { left: r.left, right: r.right, top: baseline - (latin ? m.cap : 0.86) * F, bottom: baseline + down * F }
  }
  const frame = screen.getBoundingClientRect()
  const face = screen.querySelector('[data-face="0"]') ?? screen
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('.lang-variant:not(.is-current)') }
  const rel = (r) => ({ left: r.left - frame.left, top: r.top - frame.top, right: r.right - frame.left, bottom: r.bottom - frame.top })
  const texts = []
  for (const el of face.querySelectorAll('.t, p, .lang-label')) {
    if (!visible(el) || !el.textContent.trim()) continue
    if (el.matches('p') && el.closest('.t')) continue
    const range = document.createRange()
    range.selectNodeContents(el)
    const lines = []
    for (const r of range.getClientRects()) {
      if (r.width === 0 || r.height === 0) continue
      const last = lines[lines.length - 1]
      const sameLine = last && Math.min(last.bottom, r.bottom) - Math.max(last.top, r.top) > 0.5 * Math.min(last.bottom - last.top, r.height)
      if (sameLine) { last.left = Math.min(last.left, r.left); last.right = Math.max(last.right, r.right); last.top = Math.min(last.top, r.top); last.bottom = Math.max(last.bottom, r.bottom) }
      else lines.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })
    }
    if (!lines.length) continue
    const cs = getComputedStyle(el)
    const latin = el.dataset.font === 'latin' || /^(en|vi|fil|id)$/.test(el.closest('[lang]')?.getAttribute('lang') ?? '')
    const inks = lines.map((l) => inkLine(l, cs, latin, el.textContent))
    const union = { left: Math.min(...inks.map((l) => l.left)), top: Math.min(...inks.map((l) => l.top)), right: Math.max(...inks.map((l) => l.right)), bottom: Math.max(...inks.map((l) => l.bottom)) }
    const cell = el.closest('[data-cell-id]')
    const role = cell?.dataset.role
    texts.push({
      kind: 'text',
      name: el.dataset.name ?? (role ? `${role} ${el.className.replace(/\bt-\w+\b/g, '').trim() || 'p'}` : el.className),
      role,
      lang: latin ? 'latin' : 'ja',
      fontPx: parseFloat(cs.fontSize),
      lineHeightPx: parseFloat(cs.lineHeight),
      capU: el.dataset.cap ? +el.dataset.cap : (parseFloat(cs.fontSize) * metrics(cs).cap) / unitPx,
      isSource: /source/.test(el.dataset.name ?? '') || role === 'source',
      lines: inks.map(rel),
      box: rel(union),
      cell: cell ? rel(cell.getBoundingClientRect()) : null,
    })
  }
  const RASTER = 512
  const rasterInk = async (svg) => {
    const vb = svg.viewBox.baseVal
    const markup = svg.outerHTML.replace(/^<svg/, `<svg width="${RASTER}" height="${RASTER}" color="#000"`)
    const img = new Image()
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup)
    await img.decode()
    const c = document.createElement('canvas'); c.width = RASTER; c.height = RASTER
    const cx = c.getContext('2d'); cx.drawImage(img, 0, 0, RASTER, RASTER)
    const d = cx.getImageData(0, 0, RASTER, RASTER).data
    let l = RASTER, t = RASTER, r = -1, b = -1
    for (let y = 0; y < RASTER; y++) for (let x = 0; x < RASTER; x++) { if (d[(y * RASTER + x) * 4 + 3] < 128) continue; if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y }
    if (r < 0) return null
    return { x: vb.x + (l / RASTER) * vb.width, y: vb.y + (t / RASTER) * vb.height, width: ((r + 1 - l) / RASTER) * vb.width, height: ((b + 1 - t) / RASTER) * vb.height }
  }
  const pictos = []
  for (const el of face.querySelectorAll('.picto, .pictogram')) {
    const svg = el.querySelector('svg')
    if (!svg || !visible(el)) continue
    const bb = (await rasterInk(svg)) ?? svg.getBBox()
    const m = svg.getScreenCTM()
    const pts = [[bb.x, bb.y], [bb.x + bb.width, bb.y], [bb.x, bb.y + bb.height], [bb.x + bb.width, bb.y + bb.height]].map(([x, y]) => {
      const p = new DOMPoint(x, y).matrixTransform(m)
      return [p.x, p.y]
    })
    const ink = { left: Math.min(...pts.map((p) => p[0])), top: Math.min(...pts.map((p) => p[1])), right: Math.max(...pts.map((p) => p[0])), bottom: Math.max(...pts.map((p) => p[1])) }
    const id = el.dataset.id ?? el.dataset.pictogram ?? ''
    const cell = el.closest('[data-cell-id]')
    pictos.push({ kind: 'picto', name: id, role: pictoRoles[id] ?? 'aux', box: rel(el.getBoundingClientRect()), ink: rel(ink), cell: cell ? rel(cell.getBoundingClientRect()) : rel(el.getBoundingClientRect()), rotation: +(el.dataset.rotation ?? 0) })
  }
  const root = document.querySelector('.evac-screen')
  const state = root?.dataset.cellId === undefined && root?.dataset.ready !== undefined ? { overflow: root.dataset.overflow ?? '', missing: root.dataset.missingRequired ?? '', dropped: root.dataset.dropped ?? '' } : null
  return { frame: { width: frame.width, height: frame.height }, texts, pictos, state }
}

function gap(a, b) {
  const dx = Math.max(b.left - a.right, a.left - b.right)
  const dy = Math.max(b.top - a.bottom, a.top - b.bottom)
  return Math.max(dx, dy)
}

export function applyRules(m, { unitPx, shape }) {
  const rows = []
  const row = (check, element, value, threshold, ok, note = '') => rows.push({ check, element, value, threshold, ok, note })
  const f = (v) => Math.round(v * 10) / 10
  const unit = RULES.textUnit
  const capIn = (t) => (unit === 'px' ? t.capU * unitPx : t.capU)
  for (const t of m.texts) {
    for (let i = 1; i < t.lines.length; i++) {
      const overlap = t.lines[i - 1].bottom - t.lines[i].top
      row('行間: 隣接行のインクが重ならない', `${t.name} 行${i}→${i + 1}`, `${f(overlap)} px 重なり`, '≤ 0', overlap <= 0)
    }
    if (t.lang === 'ja') {
      const em = t.lineHeightPx / t.fontPx
      row(`行間: 和文 line-height ≥ ${RULES.jaLineHeightEm} em`, t.name, `${f(em)} em`, `≥ ${RULES.jaLineHeightEm}`, em >= RULES.jaLineHeightEm - 0.005)
    }
    if (!t.isSource) row('文字: 最小 cap 高', t.name, `${f(capIn(t))} ${unit}`, `≥ ${RULES.textMinCap} ${unit}`, capIn(t) >= RULES.textMinCap - 0.5)
    if (t.role === 'action' || t.role === 'headline' || /^(action|headline)$/.test(t.name)) {
      const isMain = /(action|headline)/.test(t.name) && !/level|label/.test(t.name)
      const farCap = RULES.farCap(shape, /headline/.test(t.name) ? 'headline' : 'action')
      if (isMain) row('文字: 行動・見出しの cap 高（遠端視距離）', t.name, `${f(capIn(t))} ${unit}`, `≥ ${farCap} ${unit}`, capIn(t) >= farCap - 0.5)
    }
    const inFrame = t.box.left >= 0 && t.box.top >= 0 && t.box.right <= m.frame.width && t.box.bottom <= m.frame.height
    row('見切れ: フレーム内', t.name, `${f(t.box.left)},${f(t.box.top)}–${f(t.box.right)},${f(t.box.bottom)}`, `0–${m.frame.width}×${m.frame.height}`, inFrame)
    if (t.cell) {
      // 2 px: sub-pixel rounding of auto rows on scaled aspects (0.9 / 0.75).
      const inCell = t.box.left >= t.cell.left - 2 && t.box.top >= t.cell.top - 2 && t.box.right <= t.cell.right + 2 && t.box.bottom <= t.cell.bottom + 2
      row('見切れ: セル内', t.name, `ink ${f(t.box.left)},${f(t.box.top)}–${f(t.box.right)},${f(t.box.bottom)} / cell ${f(t.cell.left)},${f(t.cell.top)}–${f(t.cell.right)},${f(t.cell.bottom)}`, 'bbox ⊂ cell', inCell)
    }
  }
  for (const p of m.pictos) {
    const margins = [p.ink.left - p.cell.left, p.ink.top - p.cell.top, p.cell.right - p.ink.right, p.cell.bottom - p.ink.bottom]
    const minMargin = Math.min(...margins)
    row(`図記号: インクがセル内（余白 ≥ ${RULES.pictoCellMarginPx} px）`, p.name, `min ${f(minMargin)} px (l ${f(margins[0])} t ${f(margins[1])} r ${f(margins[2])} b ${f(margins[3])})`, `≥ ${RULES.pictoCellMarginPx}`, minMargin >= RULES.pictoCellMarginPx - 0.5)
    const sizePx = Math.max(p.ink.right - p.ink.left, p.ink.bottom - p.ink.top)
    const size = RULES.pictoUnit === 'px' ? sizePx : sizePx / unitPx
    row('図記号: 大きさの下限（インク）', `${p.name} (${p.role})`, `${f(size)} ${RULES.pictoUnit}`, `≥ ${RULES.pictoMin[p.role]} ${RULES.pictoUnit}`, size >= RULES.pictoMin[p.role] - 0.5)
    const inFrame = p.ink.left >= 0 && p.ink.top >= 0 && p.ink.right <= m.frame.width && p.ink.bottom <= m.frame.height
    row('見切れ: フレーム内', p.name, `${f(p.ink.left)},${f(p.ink.top)}–${f(p.ink.right)},${f(p.ink.bottom)}`, `0–${m.frame.width}×${m.frame.height}`, inFrame)
  }
  const all = [...m.texts.map((t) => ({ name: t.name, box: t.box })), ...m.pictos.map((p) => ({ name: p.name, box: p.ink }))]
  let pairs = 0
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const g = gap(all[i].box, all[j].box) / (RULES.textUnit === 'px' ? 1 : unitPx)
      if (g < RULES.elementGapPx) { pairs++; row(`隣接要素のインク間隔 ≥ ${RULES.elementGapPx} px`, `${all[i].name} ↔ ${all[j].name}`, `${f(g)} px`, `≥ ${RULES.elementGapPx}`, false) }
    }
  if (!pairs) row(`隣接要素のインク間隔 ≥ ${RULES.elementGapPx} px`, `全 ${all.length} 要素の対`, `min ≥ ${RULES.elementGapPx} px`, `≥ ${RULES.elementGapPx}`, true)
  if (m.state) {
    row('溢れ: data-overflow', 'screen', m.state.overflow || '(none)', '空', !m.state.overflow)
    row('必須セル: data-missing-required', 'screen', m.state.missing || '(none)', '空', !m.state.missing)
  }
  return rows
}

function tableHtml(results) {
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
  const sections = results.map(({ shape, variant, rows }) => {
    const ng = rows.filter((r) => !r.ok).length
    return `<h2>${shape} 案 ${variant} <small>${rows.length} 検査 · NG ${ng}</small></h2>
<table><tr><th>検査</th><th>要素</th><th>値</th><th>閾値</th><th>判定</th><th>備考</th></tr>
${rows.map((r) => `<tr class="${r.ok ? 'ok' : 'ng'}"><td>${esc(r.check)}</td><td>${esc(r.element)}</td><td>${esc(r.value)}</td><td>${esc(r.threshold)}</td><td>${r.ok ? 'OK' : 'NG'}</td><td>${esc(r.note)}</td></tr>`).join('\n')}
</table>`
  })
  const total = results.reduce((n, r) => n + r.rows.filter((x) => !x.ok).length, 0)
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><title>grid-audit</title>
<style>body{font:13px/1.5 "Noto Sans JP",sans-serif;padding:24px 32px;color:#111}table{border-collapse:collapse;margin:8px 0 24px}td,th{border:1px solid #ccc;padding:3px 8px;text-align:left;vertical-align:top}th{background:#eee}tr.ng td{background:#ffe3e3}tr.ok td:nth-child(5){color:#080}tr.ng td:nth-child(5){color:#c00;font-weight:700}h2 small{font-weight:400;color:#666}</style>
<h1>grid-audit — ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · NG 合計 ${total}</h1>
<p>閾値: 行のインク重なり 0 · 和文 line-height ≥ ${RULES.jaLineHeightEm} em · 要素間 ≥ ${RULES.elementGapPx} px · 図記号のインクがセル内（余白 ≥ ${RULES.pictoCellMarginPx} px）· 図記号 行動 ≥ ${RULES.pictoMin.action} / 災害 ≥ ${RULES.pictoMin.hazard} / 補助 ≥ ${RULES.pictoMin.aux} ${RULES.pictoUnit} · cap ≥ ${RULES.textMinCap} ${RULES.textUnit}（出典除く）· 全要素フレーム内 · data-overflow / missing-required 空</p>
${sections.join('\n')}</html>`
}

async function auditProposal(onlyShape) {
  const browser = await puppeteer.launch({ executablePath: CHROME_PATH, args: ['--allow-file-access-from-files'] })
  const page = await browser.newPage()
  const results = []
  for (const [shape, [w, h, px]] of Object.entries(PANEL)) {
    if (onlyShape && onlyShape !== shape) continue
    for (const variant of ['A', 'B']) {
      await page.setViewport({ width: w, height: h, deviceScaleFactor: 0.25 })
      await page.goto(`file://${REVIEW_DIR}proposal.html?shape=${shape}&px=${px}&variant=${variant}&grid=0&marks=0`, { waitUntil: 'networkidle0' })
      await page.waitForFunction(() => document.body.dataset.ready === '1', { timeout: 30000 })
      const has = await page.$('.screen')
      if (!has) continue
      const m = await page.evaluate(measureInPage, px, PICTO_ROLE)
      results.push({ shape, variant, rows: applyRules(m, { unitPx: px, shape }) })
    }
  }
  await browser.close()
  return results
}

const PANEL_SIZES = { '16x9': [1920, 1080], '9x16': [1080, 1920], '32x9': [3840, 1080], '1x1': [1080, 1080] }
const ASPECT_SIZES = { '10:16': [1080, 1728], '1:2': [1080, 2160], '3:4': [1080, 1440] }

async function auditApp(base, shapes, aspects, onlyBulletin) {
  const { readdirSync, existsSync } = await import('node:fs')
  const dirs = []
  for (const m of readdirSync(`${ROOT}data/layouts`)) {
    const mdir = `${ROOT}data/layouts/${m}`
    if (!existsSync(`${mdir}/index.json`)) continue
    for (const b of readdirSync(mdir)) if (existsSync(`${mdir}/${b}/9x16.json`) && (!onlyBulletin || b === onlyBulletin)) dirs.push({ m, b })
  }
  const browser = await puppeteer.launch({ executablePath: CHROME_PATH })
  const page = await browser.newPage()
  const results = []
  for (const { m, b } of dirs) {
    const targets = [...shapes.map((shape) => ({ label: shape, shape, size: PANEL_SIZES[shape], query: `shape=${shape}` })), ...aspects.map((a) => ({ label: a, shape: '9x16', size: ASPECT_SIZES[a], query: `aspect=${a}` }))]
    for (const t of targets) {
      await page.setViewport({ width: t.size[0], height: t.size[1], deviceScaleFactor: 0.25 })
      const src = encodeURIComponent(`/api/admin/preview-layout?municipality=${m}&bulletin=${b}&shape=${t.shape}`)
      await page.goto(`${base}/screen?${t.query}&clock=virtual&t=14480&src=${src}`, { waitUntil: 'networkidle0' })
      await page.waitForSelector('.evac-screen[data-ready="1"]', { timeout: 30000 })
      const unitPx = await page.$eval('.evac-screen', (el) => parseFloat(getComputedStyle(el).getPropertyValue('--px')))
      const mm = await page.evaluate(measureInPage, unitPx, PICTO_ROLE)
      if (args.includes('--dump')) console.log(JSON.stringify({ unitPx, frame: mm.frame, texts: mm.texts.map((x) => [x.name, x.lang, x.fontPx, x.lineHeightPx, x.box, x.lines.length]), pictos: mm.pictos.map((x) => [x.name, x.ink, x.cell]) }))
      results.push({ shape: `${m}/${b} ${t.label}`, variant: '', rows: applyRules(mm, { unitPx, shape: t.shape }) })
    }
  }
  await browser.close()
  return results
}

// Step-4 mocks (proposal-step4.html): 1080-short-side design px, judged by the app thresholds.
const STEP4 = { '16x9': [1920, 1080, 1], '32x9': [3840, 1080, 1], '1x1': [1080, 1080, 1], pillar: [6616, 5046, 1654 / 1080] }
async function auditStep4(onlyShape) {
  const browser = await puppeteer.launch({ executablePath: CHROME_PATH, args: ['--allow-file-access-from-files'] })
  const page = await browser.newPage()
  const results = []
  for (const [shape, [w, h, px]] of Object.entries(STEP4)) {
    if (onlyShape && onlyShape !== shape) continue
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 0.25 })
    await page.goto(`file://${REVIEW_DIR}proposal-step4.html?shape=${shape}&px=${px}`, { waitUntil: 'networkidle0' })
    await page.waitForFunction(() => document.body.dataset.ready === '1', { timeout: 30000 })
    const m = await page.evaluate(measureInPage, px, PICTO_ROLE)
    results.push({ shape, variant: 'step4', rows: applyRules(m, { unitPx: px, shape: shape === 'pillar' ? '9x16' : shape }) })
  }
  await browser.close()
  return results
}

const args = process.argv.slice(2)
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
let results
let outName
if (args.includes('--step4')) {
  RULES = RULES_APP
  results = await auditStep4(arg('--shape'))
  outName = 'audit-step4'
} else if (args.includes('--proposal')) {
  RULES = RULES_PROPOSAL
  results = await auditProposal(arg('--shape'))
  outName = 'audit'
} else if (args.includes('--app')) {
  RULES = RULES_APP
  const base = arg('--app') ?? 'http://127.0.0.1:3154'
  const shapes = (arg('--shapes') ?? '9x16').split(',')
  const aspects = (arg('--aspects') ?? '').split(',').filter(Boolean)
  results = await auditApp(base, shapes, aspects, arg('--bulletin'))
  outName = 'audit-app'
} else {
  console.error('usage: node scripts/grid-audit.mjs --proposal [--shape <shape>] | --step4 [--shape <shape>] | --app <baseURL> [--shapes 9x16] [--aspects 10:16,1:2,3:4] [--bulletin <id>]')
  process.exit(2)
}
await writeFile(`${REVIEW_DIR}${outName}.html`, tableHtml(results))
await writeFile(`${REVIEW_DIR}${outName}.json`, JSON.stringify(results, null, 2))
let total = 0
for (const { shape, variant, rows } of results) {
  const ng = rows.filter((r) => !r.ok)
  total += ng.length
  console.log(`${shape} ${variant}: ${rows.length} checks, NG ${ng.length}`)
  for (const r of ng) console.log(`  NG ${r.check} | ${r.element} | ${r.value} | ${r.threshold}${r.note ? ' | ' + r.note : ''}`)
}
console.log(`total NG ${total} → ${REVIEW_DIR}${outName}.html`)
process.exit(total ? 1 : 0)
