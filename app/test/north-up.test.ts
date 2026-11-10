import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { SHAPES } from '../layout/shapes.ts'
import type { EvacScreen, Shape } from '../layout/types.ts'
import { APP_DIR, SERVER_ENTRY, startServer } from './helpers.ts'

const require = createRequire(import.meta.url)
const puppeteer = require('puppeteer-core') as typeof import('puppeteer-core')

const CHROME_PATH = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const READY_MS = 30000
// TYPE_PX at a 1080 px short side (layout/typography.ts): the guide and fine viewing distances.
const TYPE_PX = { guide: 64, fine: 28 }
const skip = (!existsSync(SERVER_ENTRY) && 'run `pnpm -F app build` first') || (!existsSync(CHROME_PATH) && `no Chrome at ${CHROME_PATH}`)

// The Verifier's own table (agents/src/verifier/checks.ts NORTH_UP_ROTATION): screen degrees clockwise from right.
const ROTATION: Record<string, number> = { 北へ: 270, 北東へ: 315, 東へ: 0, 南東へ: 45, 南へ: 90, 南西へ: 135, 西へ: 180, 北西へ: 225 }
const fixture = (level: number) => JSON.parse(readFileSync(join(APP_DIR, 'fixtures', `north-up-l${level}.json`), 'utf8')) as EvacScreen[]
const typeScale = (shape: Shape) => (shape === 'pillar' ? 1 : Math.min(SHAPES[shape].width, SHAPES[shape].height) / 1080)

interface Read {
  overflow: string
  missing: string
  dropped: string
  word: string
  rotation: number | null
  marks: { text: string; px: number; visible: boolean; onDial: boolean }[]
  directionPx: number[]
  distances: { role: string; text: string }[]
}

describe('a site without facing shows the way on a north-fixed dial on every shape', { skip }, () => {
  let base = ''
  let child: ChildProcess | undefined
  let browser: import('puppeteer-core').Browser | undefined

  before(async () => {
    ;({ base, child } = await startServer({ NUXT_ADMIN_TOKEN: '' }))
    browser = await puppeteer.launch({ executablePath: CHROME_PATH })
  })
  after(async () => {
    await browser?.close()
    child?.kill()
  })

  async function render(screen: EvacScreen): Promise<Read> {
    const page = await browser!.newPage()
    try {
      const { width, height } = SHAPES[screen.shape]
      await page.setViewport({ width, height, deviceScaleFactor: 0.25 })
      await page.evaluateOnNewDocument((body: string) => {
        const original = window.fetch
        window.fetch = async (input, init) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
          if (url.includes('/api/admin/preview-layout')) return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
          return original(input, init)
        }
      }, JSON.stringify(screen))
      const src = encodeURIComponent(`/api/admin/preview-layout?municipality=${screen.municipality.id}&bulletin=${screen.alert.bulletin_id}&shape=${screen.shape}`)
      await page.goto(`${base}/screen?shape=${screen.shape}&clock=virtual&t=14480&src=${src}`, { waitUntil: 'networkidle0' })
      await page.waitForSelector('.evac-screen[data-ready="1"]', { timeout: READY_MS })
      return await page.evaluate(() => {
        const el = document.querySelector('.evac-screen') as HTMLElement
        const root = el.querySelector('[data-face="0"]') ?? el
        const cell = root.querySelector('[data-role="direction"][data-orientation="north-up"]') as HTMLElement
        const cellBox = cell.getBoundingClientRect()
        const ring = cell.querySelector('.north-ring')!.getBoundingClientRect()
        const glyph = cell.querySelector('[data-north-dial] .pictogram .glyph') as HTMLElement
        const m = new DOMMatrixReadOnly(getComputedStyle(glyph).transform)
        const marks = [...cell.querySelectorAll<HTMLElement>('.north-mark')].map((mark) => {
          const r = mark.getBoundingClientRect()
          const inCell = r.left >= cellBox.left - 1 && r.right <= cellBox.right + 1 && r.top >= cellBox.top - 1 && r.bottom <= cellBox.bottom + 1
          return { text: mark.innerText.trim(), px: parseFloat(getComputedStyle(mark).fontSize), visible: mark.offsetParent !== null && r.width > 0 && inCell, onDial: r.bottom >= ring.top && r.top <= ring.top + ring.height * 0.25 && r.right >= ring.left && r.left <= ring.right }
        })
        return {
          overflow: el.dataset.overflow ?? '',
          missing: el.dataset.missingRequired ?? '',
          dropped: el.dataset.dropped ?? '',
          word: (cell.querySelector('.direction-text') as HTMLElement).innerText.trim(),
          rotation: ((Math.round((Math.atan2(m.b, m.a) * 180) / Math.PI) % 360) + 360) % 360,
          marks,
          directionPx: [...cell.querySelectorAll<HTMLElement>('.t-guide')].map((p) => parseFloat(getComputedStyle(p).fontSize)),
          distances: [...root.querySelectorAll<HTMLElement>('[data-role="direction"], [data-role="shelter"]')].map((c) => ({ role: c.dataset.role!, text: c.innerText })),
        }
      })
    } finally {
      await page.close()
    }
  }

  for (const level of [3, 5]) {
    for (const screen of fixture(level)) {
      test(`level ${level} ${screen.shape}`, async () => {
        const read = await render(screen)
        const scale = typeScale(screen.shape)
        assert.deepEqual([read.overflow, read.missing, read.dropped], ['', '', ''], 'overflow / missing / dropped')
        assert.equal(read.word, screen.cells.find((c) => c.role === 'direction')!.text.ja)
        assert.equal(read.rotation, ROTATION[read.word], `the drawn arrow points ${read.word}`)
        for (const text of ['N', '北']) {
          const mark = read.marks.find((m) => m.text === text)
          assert.ok(mark?.visible && mark.onDial, `${text} is shown on the circle`)
          assert.ok(mark.px + 0.5 >= TYPE_PX.fine * scale, `${text} is ${mark.px}px, under the label floor`)
        }
        for (const px of read.directionPx) assert.ok(px + 0.5 >= TYPE_PX.guide * scale, `direction text ${px}px is under the guide floor`)
        const showing = read.distances.filter((c) => /570\s?m/.test(c.text)).map((c) => c.role)
        const expected = screen.cells.find((c) => c.distance_m !== undefined)!.role
        assert.deepEqual(showing, [expected], 'the distance is shown once, where the layout puts it')
      })
    }
  }

  test('the drawn arrow follows the layout, so an arrow that contradicts its word is visible to the Verifier', async () => {
    const [screen] = fixture(3)
    const turned = { ...screen, cells: screen.cells.map((c) => (c.role === 'direction' ? { ...c, rotation: 45 } : c)) }
    const read = await render(turned)
    assert.equal(read.word, '南西へ')
    assert.equal(read.rotation, 45)
    assert.notEqual(read.rotation, ROTATION[read.word])
  })
})
