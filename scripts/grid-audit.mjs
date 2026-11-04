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

// Thresholds (2026-11-04 commander spec). px = CSS px at panel size, u = design units (720 short side).
export const RULES = {
  lineOverlapPx: 0,
  jaLineHeightEm: 1.3,
  elementGapPx: 16,
  pictoCellMarginPx: 8,
  pictoMinU: { action: 192, hazard: 96, aux: 48 },
  textMinCapU: 24,
  frameInsetPx: 0,
}
const PICTO_ROLE = {
  directions_run: 'action', go_higher: 'action', safe_here: 'action',
  flood: 'hazard', tsunami: 'hazard', landslide: 'hazard', cyclone: 'hazard', storm_surge: 'hazard', earthquake: 'hazard', heavy_rain: 'hazard',
  arrow_forward: 'aux', emergency_evacuation_site: 'aux', evacuation_shelter: 'aux', my_location: 'aux',
}

// Runs inside the page. Returns raw measurements; the rules are applied in node so the thresholds live in one place.
function measureInPage(unitPx, pictoRoles) {
  const screen = document.querySelector('.screen') ?? document.querySelector('.evac-screen')
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
      if (last && Math.abs(last.top - r.top) < 1) { last.left = Math.min(last.left, r.left); last.right = Math.max(last.right, r.right); last.bottom = Math.max(last.bottom, r.bottom) }
      else lines.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })
    }
    if (!lines.length) continue
    const cs = getComputedStyle(el)
    const union = { left: Math.min(...lines.map((l) => l.left)), top: Math.min(...lines.map((l) => l.top)), right: Math.max(...lines.map((l) => l.right)), bottom: Math.max(...lines.map((l) => l.bottom)) }
    const cell = el.closest('[data-cell-id]')
    texts.push({
      kind: 'text',
      name: el.dataset.name ?? el.dataset.role ?? el.className,
      lang: el.dataset.font === 'latin' || /^(en|vi|fil|id)$/.test(el.closest('[lang]')?.getAttribute('lang') ?? '') ? 'latin' : 'ja',
      fontPx: parseFloat(cs.fontSize),
      lineHeightPx: parseFloat(cs.lineHeight),
      capU: (el.dataset.cap ? +el.dataset.cap : parseFloat(cs.fontSize) * 0.741 / unitPx),
      isSource: /source/.test(el.dataset.name ?? '') || el.closest('[data-role="source"]') !== null,
      lines: lines.map(rel),
      box: rel(union),
      cell: cell ? rel(cell.getBoundingClientRect()) : null,
    })
  }
  const pictos = []
  for (const el of face.querySelectorAll('.picto, .pictogram')) {
    const svg = el.querySelector('svg')
    if (!svg || !visible(el)) continue
    const bb = svg.getBBox()
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
  return { frame: { width: frame.width, height: frame.height }, texts, pictos }
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
  const farCapU = Math.floor((FAR_M[shape] * UNITS_PER_M) / 8) * 8
  for (const t of m.texts) {
    for (let i = 1; i < t.lines.length; i++) {
      const overlap = t.lines[i - 1].bottom - t.lines[i].top
      row('行間: 隣接行の line box が重ならない', `${t.name} 行${i}→${i + 1}`, `${f(overlap)} px 重なり`, `≤ ${RULES.lineOverlapPx}`, overlap <= RULES.lineOverlapPx)
    }
    if (t.lang === 'ja') {
      const em = t.lineHeightPx / t.fontPx
      row('行間: 和文 line-height ≥ 1.3 em', t.name, `${f(em)} em`, `≥ ${RULES.jaLineHeightEm}`, em >= RULES.jaLineHeightEm)
    }
    if (!t.isSource) row('文字: 最小 cap 高', t.name, `${f(t.capU)} u`, `≥ ${RULES.textMinCapU} u`, t.capU >= RULES.textMinCapU)
    if (/^(action|headline)$/.test(t.name)) row('文字: 視距離の cap 高（遠端）', t.name, `${f(t.capU)} u`, `≥ ${farCapU} u (${FAR_M[shape]} m)`, t.capU >= farCapU)
    const inFrame = t.box.left >= -RULES.frameInsetPx && t.box.top >= -RULES.frameInsetPx && t.box.right <= m.frame.width + RULES.frameInsetPx && t.box.bottom <= m.frame.height + RULES.frameInsetPx
    row('見切れ: フレーム内', t.name, `${f(t.box.left)},${f(t.box.top)}–${f(t.box.right)},${f(t.box.bottom)}`, `0–${m.frame.width}×${m.frame.height}`, inFrame)
    if (t.cell) {
      const inCell = t.box.left >= t.cell.left - 1 && t.box.top >= t.cell.top - 1 && t.box.right <= t.cell.right + 1 && t.box.bottom <= t.cell.bottom + 1
      row('見切れ: セル内', t.name, '', 'bbox ⊂ cell', inCell)
    }
  }
  for (const p of m.pictos) {
    const margins = [p.ink.left - p.cell.left, p.ink.top - p.cell.top, p.cell.right - p.ink.right, p.cell.bottom - p.ink.bottom]
    const minMargin = Math.min(...margins)
    row('図記号: セル内で 4 辺 8 px 以上の余白', p.name, `min ${f(minMargin)} px (l ${f(margins[0])} t ${f(margins[1])} r ${f(margins[2])} b ${f(margins[3])})`, `≥ ${RULES.pictoCellMarginPx}`, minMargin >= RULES.pictoCellMarginPx, p.rotation ? `回転 ${p.rotation}° の外接矩形` : '')
    const sizeU = Math.max(p.ink.right - p.ink.left, p.ink.bottom - p.ink.top) / unitPx
    row('図記号: 大きさの下限', `${p.name} (${p.role})`, `${f(sizeU)} u (box ${f((p.box.right - p.box.left) / unitPx)} u)`, `≥ ${RULES.pictoMinU[p.role]} u`, sizeU >= RULES.pictoMinU[p.role])
    const inFrame = p.ink.left >= 0 && p.ink.top >= 0 && p.ink.right <= m.frame.width && p.ink.bottom <= m.frame.height
    row('見切れ: フレーム内', p.name, `${f(p.ink.left)},${f(p.ink.top)}–${f(p.ink.right)},${f(p.ink.bottom)}`, `0–${m.frame.width}×${m.frame.height}`, inFrame)
  }
  const all = [...m.texts.map((t) => ({ name: t.name, box: t.box })), ...m.pictos.map((p) => ({ name: p.name, box: p.ink }))]
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const g = gap(all[i].box, all[j].box)
      if (g < RULES.elementGapPx) row('隣接要素の bbox 間隔 ≥ 16 px', `${all[i].name} ↔ ${all[j].name}`, `${f(g)} px`, `≥ ${RULES.elementGapPx}`, false)
    }
  const ngPairs = rows.filter((r) => r.check.startsWith('隣接') ).length
  if (!ngPairs) row('隣接要素の bbox 間隔 ≥ 16 px', `全 ${all.length} 要素の対`, 'min ≥ 16 px', `≥ ${RULES.elementGapPx}`, true)
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
<p>閾値: 行の重なり 0 px · 和文 line-height ≥ 1.3 em · 要素間 ≥ 16 px · 図記号の余白 ≥ 8 px · 図記号 行動 ≥ 192 u / 災害 ≥ 96 u / 補助 ≥ 48 u · cap ≥ 24 u（出典除く）· 行動/見出しは形状の遠端視距離 ÷ 120 · 全要素フレーム内</p>
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

const args = process.argv.slice(2)
const onlyShape = args.includes('--shape') ? args[args.indexOf('--shape') + 1] : undefined
if (!args.includes('--proposal')) {
  console.error('usage: node scripts/grid-audit.mjs --proposal [--shape <shape>]  (the /screen mode comes with the implementation)')
  process.exit(2)
}
const results = await auditProposal(onlyShape)
await writeFile(`${REVIEW_DIR}audit.html`, tableHtml(results))
await writeFile(`${REVIEW_DIR}audit.json`, JSON.stringify(results, null, 2))
let total = 0
for (const { shape, variant, rows } of results) {
  const ng = rows.filter((r) => !r.ok)
  total += ng.length
  console.log(`${shape} ${variant}: ${rows.length} checks, NG ${ng.length}`)
  for (const r of ng) console.log(`  NG ${r.check} | ${r.element} | ${r.value} | ${r.threshold}${r.note ? ' | ' + r.note : ''}`)
}
console.log(`total NG ${total} → ${REVIEW_DIR}audit.html`)
process.exit(total ? 1 : 0)
