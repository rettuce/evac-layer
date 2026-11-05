import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { after, before, describe, test } from 'node:test'
import type { Shape } from '../layout/types.ts'
import { SERVER_ENTRY, startServer } from './helpers.ts'

const require = createRequire(import.meta.url)
const puppeteer = require('puppeteer-core') as typeof import('puppeteer-core')

const CHROME_PATH = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const AGENTS_DIR = fileURLToPath(new URL('../../agents/', import.meta.url))
const TSX = `${AGENTS_DIR}node_modules/.bin/tsx`
const MUNICIPALITY = '22424'
const BULLETIN = 'VTSE41-201609010726-05a7380a3e46'
const SIZES: Record<Shape, [number, number]> = { '16x9': [1920, 1080], '9x16': [1080, 1920], '32x9': [3840, 1080], '1x1': [1080, 1080], pillar: [6616, 5046] }
const READY_MS = 30000
const FLOOR_PX: Record<Shape, number> = { '16x9': 53, '9x16': 64, '32x9': 64, '1x1': 43, pillar: 64 }

// app/test runs on node's type stripping, which cannot follow the layout modules' extensionless imports; tsx can.
describe('the shelter floor matches the Verifier', { skip: !existsSync(TSX) && 'agents dependencies are not installed' }, () => {
  test('every shape', () => {
    const script = `
      import { shelterFloorPx, shelterSizes } from ${JSON.stringify(fileURLToPath(new URL('../layout/shelterFit.ts', import.meta.url)))}
      import { requiredPx } from ${JSON.stringify(`${AGENTS_DIR}src/verifier/checks.ts`)}
      const shapes = ${JSON.stringify(Object.keys(SIZES))}
      console.log(JSON.stringify({
        app: shapes.map((s) => shelterFloorPx(s)),
        verifier: shapes.map((s) => requiredPx('shelter', 1, 'primary', s).px),
        ribbon: shelterSizes(112, 64),
        landscape: shelterSizes(63, shelterFloorPx('16x9')),
        square: shelterSizes(51, shelterFloorPx('1x1')),
      }))`
    const out = JSON.parse(execFileSync(TSX, ['-e', script], { cwd: AGENTS_DIR, encoding: 'utf8' }))
    assert.deepEqual(out.app, out.verifier)
    assert.deepEqual(out.app, [53, 64, 64, 43, 64])
    assert.deepEqual(out.ribbon, [112, 103, 94, 86, 79, 72, 66])
    assert.deepEqual(out.landscape, [63, 57, 53])
    assert.deepEqual(out.square, [51, 46, 43])
  })
})

const skip = (!existsSync(SERVER_ENTRY) && 'run `pnpm -F app build` first') || (!existsSync(CHROME_PATH) && `no Chrome at ${CHROME_PATH}`)

// 吉田's 津波避難タワーＭ broke into two lines on 32:9 at the single narrow step (田中 2026-11-05).
describe('a shelter name is set smaller until it fits on one line', { skip }, () => {
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

  for (const shape of Object.keys(SIZES) as Shape[]) {
    test(shape, async () => {
      const [width, height] = SIZES[shape]
      const page = await browser!.newPage()
      try {
        await page.setViewport({ width, height, deviceScaleFactor: shape === 'pillar' ? 0.15 : 0.25 })
        const src = encodeURIComponent(`/api/admin/preview-layout?municipality=${MUNICIPALITY}&bulletin=${BULLETIN}&shape=${shape}`)
        await page.goto(`${base}/screen?shape=${shape}&clock=virtual&t=14480&src=${src}`, { waitUntil: 'networkidle0' })
        await page.waitForSelector('.evac-screen[data-ready="1"]', { timeout: READY_MS })
        const name = await page.evaluate(() => {
          const root = document.querySelector('[data-face="0"]') ?? document
          const el = root.querySelector('.shelter-name-text, .shelter-text > p.t-guide') as HTMLElement
          const range = document.createRange()
          range.selectNodeContents(el)
          return {
            text: el.textContent!.trim(),
            lines: new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size,
            clipped: el.scrollWidth > el.clientWidth + 1,
            px: parseFloat(getComputedStyle(el).fontSize),
          }
        })
        assert.match(name.text, /タワー/)
        assert.equal(name.lines, 1, `${shape}: ${name.text} on ${name.lines} lines`)
        assert.equal(name.clipped, false, `${shape}: ${name.text} clipped`)
        assert.ok(name.px >= FLOOR_PX[shape] - 0.5, `${shape}: ${name.px}px is under the Verifier floor`)
      } finally {
        await page.close()
      }
    })
  }
})

// 田中 2026-11-06: 輪島市立港公民館 fits one 16:9 line once the distance beside it takes one step down.
describe('the distance gives way only to a name that still breaks at its floor', { skip }, () => {
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

  const CASES: [string, string, Shape, { lines: number; distancePx: number }][] = [
    ['17204', 'VPWW55-202610200500-e9e69c6c3b73', '16x9', { lines: 1, distancePx: 73 }],
    [MUNICIPALITY, BULLETIN, '32x9', { lines: 1, distancePx: 150 }],
  ]
  for (const [municipality, bulletin, shape, expected] of CASES) {
    test(`${municipality} ${shape}`, async () => {
      const [width, height] = SIZES[shape]
      const page = await browser!.newPage()
      try {
        await page.setViewport({ width, height, deviceScaleFactor: 0.25 })
        const src = encodeURIComponent(`/api/admin/preview-layout?municipality=${municipality}&bulletin=${bulletin}&shape=${shape}`)
        await page.goto(`${base}/screen?shape=${shape}&clock=virtual&t=14480&src=${src}`, { waitUntil: 'networkidle0' })
        await page.waitForSelector('.evac-screen[data-ready="1"]', { timeout: READY_MS })
        const got = await page.evaluate(() => {
          const el = document.querySelector('.shelter-name-text, .shelter-text > p.t-guide') as HTMLElement
          const range = document.createRange()
          range.selectNodeContents(el)
          return {
            lines: new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size,
            distancePx: parseFloat(getComputedStyle(document.querySelector('.distance')!).fontSize),
          }
        })
        assert.deepEqual(got, expected)
      } finally {
        await page.close()
      }
    })
  }
})
