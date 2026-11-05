import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { after, before, describe, test } from 'node:test'
import type { Shape } from '../layout/types.ts'
import { SERVER_ENTRY, startServer } from './helpers.ts'

const require = createRequire(import.meta.url)
const puppeteer = require('puppeteer-core') as typeof import('puppeteer-core')

const CHROME_PATH = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const MUNICIPALITY = '05210'
const LONG_SOURCE = '気象庁・国土交通省 10/21 15:55 発表・由利本荘市'
const BULLETIN = 'VXKOii-202610211555-d5ccc7c6b547'
const SIZES: Record<Shape, [number, number]> = { '16x9': [1920, 1080], '9x16': [1080, 1920], '32x9': [3840, 1080], '1x1': [1080, 1080], pillar: [6616, 5046] }
const READY_MS = 30000

const skip = (!existsSync(SERVER_ENTRY) && 'run `pnpm -F app build` first') || (!existsSync(CHROME_PATH) && `no Chrome at ${CHROME_PATH}`)

// The source line never wraps: one that does not fit is set one step smaller (SOURCE_STEP_DOWN).
describe('the source line stays on one line on every shape', { skip }, () => {
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
        await page.evaluateOnNewDocument((source: string) => {
          const original = window.fetch
          window.fetch = async (input, init) => {
            const response = await original(input, init)
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
            if (!url.includes('/api/admin/preview-layout')) return response
            const screen = await response.json()
            const cell = screen.cells.find((c: { role: string }) => c.role === 'source')
            if (cell) cell.text = { ...cell.text, ja: source }
            else screen.cells.push({ id: 'source', role: 'source', priority: 9, text: { ja: source }, motion: 'static' })
            return new Response(JSON.stringify(screen), { status: 200, headers: { 'content-type': 'application/json' } })
          }
        }, LONG_SOURCE)
        const src = encodeURIComponent(`/api/admin/preview-layout?municipality=${MUNICIPALITY}&bulletin=${BULLETIN}&shape=${shape}`)
        await page.goto(`${base}/screen?shape=${shape}&clock=virtual&t=14480&src=${src}`, { waitUntil: 'networkidle0' })
        await page.waitForSelector('.evac-screen[data-ready="1"]', { timeout: READY_MS })
        const lines = await page.evaluate(() =>
          [...document.querySelectorAll('.evac-screen')].map((el) => {
            const source = el.querySelector('.source-text') as HTMLElement
            const rect = source.getBoundingClientRect()
            return { overflow: (el as HTMLElement).dataset.overflow ?? '', missing: (el as HTMLElement).dataset.missingRequired ?? '', text: source.textContent?.trim() ?? '', lines: Math.round(rect.height / parseFloat(getComputedStyle(source).lineHeight)), fits: source.scrollWidth <= source.clientWidth + 1 }
          }),
        )
        for (const line of lines) {
          assert.equal(line.text, '気象庁・国土交通省 10/21 15:55 発表・由利本荘市', `${shape} shows the whole source`)
          assert.equal(line.lines, 1, `${shape} keeps the source on one line`)
          assert.ok(line.fits, `${shape} fits the source in its line`)
          assert.deepEqual([line.overflow, line.missing], ['', ''], `${shape} overflow/missing`)
        }
      } finally {
        await page.close()
      }
    })
  }
})
