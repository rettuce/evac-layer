import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { after, before, describe, test } from 'node:test'
import { SERVER_ENTRY, startServer } from './helpers.ts'

const require = createRequire(import.meta.url)
const puppeteer = require('puppeteer-core') as typeof import('puppeteer-core')

const CHROME_PATH = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const MUNICIPALITY = '05210'
const BULLETIN = 'VXKOii-202610211815-e713da0e3c05'
const READY_MS = 30000

const skip = (!existsSync(SERVER_ENTRY) && 'run `pnpm -F app build` first') || (!existsSync(CHROME_PATH) && `no Chrome at ${CHROME_PATH}`)

// The layouts in data/ may predate the 1:1 source slot; the tests supply the cell so they check the face, not the data.
describe('the 1:1 face carries its source line on the language band', { skip }, () => {
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

  for (const [aspect, width, height] of [['1:1', 1080, 1080], ['4:5', 1080, 1350]] as const) {
    test(aspect, async () => {
      const page = await browser!.newPage()
      try {
        await page.setViewport({ width, height, deviceScaleFactor: 0.5 })
        await page.evaluateOnNewDocument(() => {
          const original = window.fetch
          window.fetch = async (input, init) => {
            const response = await original(input, init)
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
            if (!url.includes('/api/admin/preview-layout')) return response
            const screen = await response.json()
  if (!screen.cells.some((cell: { role: string }) => cell.role === 'source')) screen.cells.push({ id: 'source', role: 'source', priority: 9, text: { ja: '気象庁 10/21 18:15 発表・由利本荘市', en: 'JMA 18:15, Oct 21 · Yurihonjo' }, motion: 'static' })
            return new Response(JSON.stringify(screen), { status: 200, headers: { 'content-type': 'application/json' } })
          }
        })
        const src = encodeURIComponent(`/api/admin/preview-layout?municipality=${MUNICIPALITY}&bulletin=${BULLETIN}&shape=1x1`)
        await page.goto(`${base}/screen?aspect=${aspect}&clock=virtual&t=14480&src=${src}`, { waitUntil: 'networkidle0' })
        await page.waitForSelector('.evac-screen[data-ready="1"]', { timeout: READY_MS })
        const state = await page.evaluate(() => {
          const el = document.querySelector('.evac-screen') as HTMLElement
          const band = el.querySelector('[data-role="languages"]')!.getBoundingClientRect()
          const source = el.querySelector('[data-role="source"] .source-text')!
          const rect = source.getBoundingClientRect()
          return { overflow: el.dataset.overflow ?? '', missing: el.dataset.missingRequired ?? '', text: source.textContent?.trim() ?? '', inBand: rect.top >= band.top && rect.bottom <= band.bottom && rect.right <= band.right, color: getComputedStyle(source).color }
        })
        assert.ok(state.text.includes('気象庁'), `${aspect} names the source: ${state.text}`)
        assert.ok(state.inBand, `${aspect} draws the source inside the language band`)
        assert.equal(state.color, 'rgb(255, 255, 255)', `${aspect} draws the source in the band's ink`)
        assert.deepEqual([state.overflow, state.missing], ['', ''], `${aspect} overflow/missing`)
      } finally {
        await page.close()
      }
    })
  }
})
