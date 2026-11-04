// Synthetic alert screens for cut 7m: fictional municipalities, facilities and bulletins composed into
// evac-screen layouts and drawn by the real renderer (/screen), one still per layout.
//   node demo/capture/mosaic_layouts.mjs [--count 180] [--seed 20261105] [--base-url http://127.0.0.1:3151]
//
// Output: demo/capture/out/mosaic/{layouts/*.json, tiles/*.jpg, manifest.json}. The layouts are served from
// demo/sites/_mosaic/ while the stills are taken (the production build reads layouts only from the layout store
// or demo/sites/), and that directory is removed afterwards.
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const require = createRequire(new URL('../../app/package.json', import.meta.url))
const puppeteer = require('puppeteer-core')

const CHROME_PATH = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const REPO = fileURLToPath(new URL('../../', import.meta.url))
const SITES_DIR = 'demo/sites/_mosaic/'
const OUT = fileURLToPath(new URL('out/mosaic/', import.meta.url))
const READY_TIMEOUT_MS = 30000

const { values } = parseArgs({
  options: {
    count: { type: 'string', default: '180' },
    seed: { type: 'string', default: '20261105' },
    'base-url': { type: 'string', default: process.env.EVAC_URL ?? 'http://127.0.0.1:3151' },
  },
})

// The renderer's native canvas per shape, taken at a scale that keeps a tile sharp at the size it reaches on
// screen; the first tile fills 60 % of the frame, so it is taken at full size.
const SHAPES = {
  '16x9': { width: 1920, height: 1080, scale: 0.5, share: 50 },
  '9x16': { width: 1080, height: 1920, scale: 0.4, share: 40 },
  '32x9': { width: 3840, height: 1080, scale: 0.4, share: 25 },
  '1x1': { width: 1080, height: 1080, scale: 0.5, share: 35 },
  pillar: { width: 6616, height: 5046, scale: 0.15, share: 30 },
}
const HERO_SCALE = 1

const PAIR_T_MS = [14480, 16480, 18480, 22480, 24480]

const MUNICIPALITIES = [
  { id: '99001', ja: '朝霧市', en: 'Asagiri', coastal: true },
  { id: '99002', ja: '青葉台市', en: 'Aobadai', coastal: false },
  { id: '99003', ja: '汐見市', en: 'Shiomi', coastal: true },
  { id: '99004', ja: '若菜町', en: 'Wakana', coastal: false },
  { id: '99005', ja: '星ヶ丘市', en: 'Hoshigaoka', coastal: false },
]

const FACILITIES = [
  '朝霧小学校', '青葉台中学校', '汐見公園', '若菜市民センター', '星ヶ丘体育館', '中央公園', '東公民館', '南小学校', '港市民センター',
  '桜台中学校', '旭ヶ丘高校', '本町公民館', '山王公園', '新田小学校', '川端体育館', '松原中学校', '宮前市民センター', '高台公園',
  '浜手津波避難タワー', '城山公園',
]
const TSUNAMI_TOWER = '浜手津波避難タワー'
const TSUNAMI_FACILITIES = [TSUNAMI_TOWER, '高台公園', '旭ヶ丘高校', '城山公園']

const DIRECTIONS = { 0: '東へ', 45: '南東へ', 90: '南へ', 135: '南西へ', 180: '西へ', 225: '北西へ', 270: '北へ', 315: '北東へ' }

const t = (ja, ja_easy, en, zh_hans, zh_hant, ko, th, vi, fil, id) => ({ ja, ja_easy, en, zh_hans, zh_hant, ko, th, vi, fil, id })

const HEADLINES = {
  flood: {
    3: t('レベル３氾濫警報', 'かわ はんらん けいほう', 'Lv3 Flood Warning', '3级泛滥警报', '3級氾濫警報', '레벨3 범람경보', 'คำเตือนน้ำล้นตลิ่งระดับ3', 'Cảnh báo lũ cấp 3', 'Babala sa Baha, Antas 3', 'Peringatan Banjir Level 3'),
    4: t('レベル４氾濫危険警報', 'かわが あふれる きけん', 'Lv4 Flood Danger Warning', '4级泛滥危险警报', '4級氾濫危險警報', '레벨4 범람 위험경보', 'เตือนภัยอันตรายน้ำล้นตลิ่งระดับ4', 'Cảnh báo nguy hiểm tràn bờ cấp 4', 'Babala sa Panganib ng Pag-apaw, Antas 4', 'Peringatan Bahaya Luapan Level 4'),
    5: t('レベル５氾濫特別警報', 'かわ とくべつけいほう', 'Lv5 Flood Emergency Warning', '5级泛滥特别警报', '5級氾濫特別警報', '레벨5 범람 특별경보', 'ประกาศเตือนภัยพิเศษน้ำล้นตลิ่งระดับ5', 'Cảnh báo đặc biệt lũ tràn cấp 5', 'Espesyal na Babala sa Pag-apaw, Antas 5', 'Peringatan Khusus Luapan Level 5'),
  },
  heavy_rain: {
    3: t('レベル３大雨警報', 'レベル３ おおあめ けいほう', 'Lv3 Heavy Rain Warning', '3级大雨警报', '3級大雨警報', '레벨3 호우경보', 'คำเตือนฝนตกหนักระดับ3', 'Cảnh báo mưa lớn cấp 3', 'Babala sa Malakas na Ulan, Antas 3', 'Peringatan Hujan Lebat Level 3'),
    4: t('レベル４大雨危険警報', 'レベル４ おおあめ きけん', 'Lv4 Heavy Rain Danger', '4级大雨危险警报', '4級大雨危險警報', '레벨4 호우 위험경보', 'เตือนภัยอันตรายฝนตกหนักระดับ4', 'Cảnh báo nguy hiểm mưa lớn cấp 4', 'Babala sa Panganib ng Malakas na Ulan, Antas 4', 'Peringatan Bahaya Hujan Lebat Level 4'),
    5: t('レベル５大雨特別警報', 'おおあめ とくべつけいほう', 'Lv5 Heavy Rain Emergency', '5级大雨特别警报', '5級大雨特別警報', '레벨5 호우 특별경보', 'ประกาศเตือนภัยพิเศษฝนตกหนักระดับ5', 'Cảnh báo đặc biệt mưa lớn cấp 5', 'Espesyal na Babala sa Malakas na Ulan, Antas 5', 'Peringatan Khusus Hujan Lebat Level 5'),
  },
  landslide: {
    3: t('レベル３土砂災害警報', 'レベル３ どしゃさいがい けいほう', 'Lv.3 Landslide Warning', '3级土砂灾害警报', '3級土砂災害警報', '레벨3 토사재해 경보', 'คำเตือนภัยดินถล่มระดับ3', 'Cảnh báo sạt lở đất cấp 3', 'Babala sa Pagguho ng Lupa, Antas 3', 'Peringatan Tanah Longsor Level 3'),
    4: t('レベル４土砂災害危険警報', 'レベル4 どしゃ きけん けいほう', 'Lv.4 Landslide Warning', '4级土砂灾害危险警报', '4級土砂災害危險警報', '레벨4 토사재해 위험경보', 'ประกาศเตือนอันตรายดินถล่มระดับ4', 'Cảnh báo nguy hiểm sạt lở đất cấp 4', 'Babala sa Panganib ng Pagguho ng Lupa, Antas 4', 'Peringatan Bahaya Tanah Longsor Level 4'),
    5: t('レベル５土砂災害特別警報', 'どしゃ とくべつけいほう', 'Lv5 Landslide Emergency', '5级土砂灾害特别警报', '5級土砂災害特別警報', '레벨5 토사재해 특별경보', 'ประกาศเตือนภัยพิเศษดินถล่มระดับ5', 'Cảnh báo đặc biệt sạt lở đất cấp 5', 'Espesyal na Babala sa Pagguho ng Lupa, Antas 5', 'Peringatan Khusus Tanah Longsor Level 5'),
  },
  tsunami: {
    2: t('津波注意報', 'つなみ ちゅういほう', 'Tsunami Advisory', '海啸注意报', '海嘯注意報', '쓰나미 주의보', 'ประกาศเฝ้าระวังสึนามิ', 'Chú ý sóng thần', 'Tsunami Advisory', 'Peringatan Dini Tsunami'),
    3: t('津波警報', 'つなみ けいほう', 'Tsunami Warning', '海啸警报', '海嘯警報', '쓰나미 경보', 'คำเตือนสึนามิ', 'Cảnh báo sóng thần', 'Babala sa Tsunami', 'Peringatan Tsunami'),
    4: t('大津波警報', 'おおつなみ けいほう', 'Major Tsunami Warning', '大海啸警报', '大海嘯警報', '대형 쓰나미 경보', 'คำเตือนสึนามิขนาดใหญ่', 'Cảnh báo sóng thần lớn', 'Babala sa Malaking Tsunami', 'Peringatan Tsunami Besar'),
  },
}

const ACTIONS = {
  'evac-prepare': t('高齢者は避難', 'おとしよりは にげてください', 'Elderly: evacuate', '老年人请避难', '老年人請避難', '고령자는 대피하세요', 'ผู้สูงอายุอพยพ', 'Người cao tuổi sơ tán', 'Matatanda: lumikas', 'Lansia harap mengungsi'),
  'evac-now': t('危険な場所から避難', 'あぶない ばしょから にげて', 'Leave danger areas', '从危险地方撤离', '從危險地方撤離', '위험한 곳에서 대피', 'ออกจากที่อันตราย', 'Rời nơi nguy hiểm', 'Lumikas sa mapanganib', 'Tinggalkan area bahaya'),
  'secure-now': t('高い所へ上がって', 'たかい ところへ あがって', 'Go up higher', '请到高处', '請到高處', '높은 곳으로 올라가세요', 'ขึ้นไปที่สูง', 'Lên chỗ cao hơn', 'Umakyat sa mataas', 'Naik ke tempat tinggi'),
  tsunami: t('高い所へ避難', 'たかい ところへ にげて', 'Go to higher ground', '到高处避难', '到高處避難', '높은 곳으로 대피', 'อพยพขึ้นที่สูง', 'Sơ tán lên chỗ cao', 'Lumikas sa mataas na lugar', 'Mengungsi ke tempat tinggi'),
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let r = Math.imul(a ^ (a >>> 15), 1 | a)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function synthesize(count, seed) {
  const rand = mulberry32(seed)
  const pick = (list) => list[Math.floor(rand() * list.length)]
  const shapes = Object.entries(SHAPES).flatMap(([shape, spec]) => Array(spec.share).fill(shape))
  const layouts = []
  for (let n = 0; n < count; n++) {
    const shape = n === 0 ? '16x9' : shapes[Math.floor(rand() * shapes.length)]
    const muni = n === 0 ? MUNICIPALITIES[0] : MUNICIPALITIES[n % MUNICIPALITIES.length]
    const hazards = muni.coastal ? ['heavy_rain', 'landslide', 'flood', 'tsunami', 'tsunami'] : ['heavy_rain', 'landslide', 'flood']
    const hazard = n === 0 ? 'flood' : pick(hazards)
    const level = n === 0 ? 4 : hazard === 'tsunami' ? pick([2, 3, 4]) : pick([3, 4, 4, 5])
    const template = hazard === 'tsunami' ? 'evac-now' : level >= 5 ? 'secure-now' : level === 4 ? 'evac-now' : 'evac-prepare'
    const action = hazard === 'tsunami' ? ACTIONS.tsunami : ACTIONS[template]
    const actionPictogram = hazard === 'tsunami' || template === 'secure-now' ? 'go_higher' : 'directions_run'
    const month = 6 + Math.floor(rand() * 5)
    const day = 1 + Math.floor(rand() * 28)
    const hh = Math.floor(rand() * 24)
    const mm = Math.floor(rand() * 12) * 5
    const pad = (v) => String(v).padStart(2, '0')
    const id = `mosaic-${String(n).padStart(3, '0')}`
    const bulletin = `SYNTHETIC-${id}`
    const cells = [
      { id: 'headline', role: 'headline', priority: 1, text: HEADLINES[hazard][level], pictogram: hazard, motion: 'scale-in' },
      { id: 'action', role: 'action', priority: 1, text: action, pictogram: actionPictogram, motion: 'pulse' },
    ]
    if (template !== 'secure-now') {
      const rotation = Number(pick(Object.keys(DIRECTIONS)))
      const facility = pick(hazard === 'tsunami' ? TSUNAMI_FACILITIES : FACILITIES.filter((f) => f !== TSUNAMI_TOWER))
      cells.push({ id: 'direction', role: 'direction', priority: 2, text: { ja: DIRECTIONS[rotation] }, pictogram: 'arrow_forward', rotation, motion: 'static' })
      cells.push({ id: 'shelter', role: 'shelter', priority: 2, kind: 'emergency_evacuation_site', text: { ja: facility }, pictogram: 'emergency_evacuation_site', distance_m: 120 + Math.round((rand() * 1680) / 10) * 10, motion: 'static' })
    }
    cells.push({ id: 'languages', role: 'languages', priority: 3, text: action, motion: 'static' })
    cells.push({
      id: 'source', role: 'source', priority: 9, motion: 'static',
      text: { ja: `気象庁 ${month}/${day} ${pad(hh)}:${pad(mm)} 発表・${muni.ja}`, en: `JMA ${pad(hh)}:${pad(mm)}, ${MONTHS[month - 1]} ${day} · ${muni.en}` },
    })
    layouts.push({
      id,
      pairT: PAIR_T_MS[Math.floor(rand() * PAIR_T_MS.length)],
      layout: {
        version: '0.1', kind: 'evac-screen',
        municipality: { id: muni.id, name: muni.ja },
        alert: { source: 'jma', bulletin_id: bulletin, hazard, level, issued_at: `2026-${pad(month)}-${pad(day)}T${pad(hh)}:${pad(mm)}:00+09:00` },
        shape, template, cells, palette: 'cabinet-office-5',
        sources: [{ type: 'jma', bulletin_id: bulletin }],
      },
    })
  }
  return layouts
}

async function dashboardTotals() {
  const response = await fetch(`${values['base-url']}/api/dashboard`)
  const { totals } = await response.json()
  return { municipalities: totals.municipalities, bulletins: totals.bulletins, layouts: totals.layouts }
}

const layouts = synthesize(Number(values.count), Number(values.seed))
await rm(OUT, { recursive: true, force: true })
await mkdir(`${OUT}layouts`, { recursive: true })
await mkdir(`${OUT}tiles`, { recursive: true })
await mkdir(`${REPO}${SITES_DIR}`, { recursive: true })
for (const { id, layout } of layouts) {
  const json = `${JSON.stringify(layout, null, 2)}\n`
  await writeFile(`${OUT}layouts/${id}.json`, json)
  await writeFile(`${REPO}${SITES_DIR}${id}.json`, json)
}

const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true })
const tiles = []
try {
  const page = await browser.newPage()
  for (const [n, { id, pairT, layout }] of layouts.entries()) {
    const spec = SHAPES[layout.shape]
    const scale = n === 0 ? HERO_SCALE : spec.scale
    await page.setViewport({ width: spec.width, height: spec.height, deviceScaleFactor: scale })
    const params = new URLSearchParams({ shape: layout.shape, clock: 'virtual', t: String(pairT), src: `${SITES_DIR}${id}.json` })
    await page.goto(`${values['base-url']}/screen?${params}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.evac-screen[data-ready="1"]', { timeout: READY_TIMEOUT_MS })
    await page.screenshot({ path: `${OUT}tiles/${id}.jpg`, type: 'jpeg', quality: 90 })
    const { alert, municipality, shape } = layout
    tiles.push({ id, file: `tiles/${id}.jpg`, shape, width: spec.width, height: spec.height, municipality: municipality.name, hazard: alert.hazard, level: alert.level })
    if (n % 20 === 0) console.log(`TILE ${n}/${layouts.length}`)
  }
} finally {
  await browser.close()
  await rm(`${REPO}${SITES_DIR}`, { recursive: true, force: true })
}

const totals = await dashboardTotals()
await writeFile(`${OUT}manifest.json`, `${JSON.stringify({ seed: Number(values.seed), totals, tiles }, null, 2)}\n`)
const tally = (key) => Object.entries(tiles.reduce((acc, tile) => ({ ...acc, [tile[key]]: (acc[tile[key]] ?? 0) + 1 }), {})).map(([k, v]) => `${k} ${v}`).join(' / ')
console.log(`MOSAIC ${tiles.length} tiles · totals ${JSON.stringify(totals)}`)
console.log(`by municipality: ${tally('municipality')}`)
console.log(`by shape: ${tally('shape')}`)
console.log(`by hazard: ${tally('hazard')}`)
console.log(`by level: ${tally('level')}`)
