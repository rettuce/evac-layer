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
const BULLETIN = 'VXKOii-202610211815-e713da0e3c05'
const SIZES: Record<Shape, [number, number]> = { '16x9': [1920, 1080], '9x16': [1080, 1920], '32x9': [3840, 1080], '1x1': [1080, 1080], pillar: [6616, 5046] }
const READY_MS = 30000

const skip = (!existsSync(SERVER_ENTRY) && 'run `pnpm -F app build` first') || (!existsSync(CHROME_PATH) && `no Chrome at ${CHROME_PATH}`)

describe('level 5 (secure-now) keeps the shelter and the direction on every shape', { skip }, () => {
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

  async function render(shape: Shape) {
    const [width, height] = SIZES[shape]
    const page = await browser!.newPage()
    try {
      await page.setViewport({ width, height, deviceScaleFactor: shape === 'pillar' ? 0.15 : 0.25 })
      await page.evaluateOnNewDocument(() => {
        const original = window.fetch
        window.fetch = async (input, init) => {
          const response = await original(input, init)
          const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
          if (!url.includes('/api/admin/preview-layout')) return response
          const screen = await response.json()
          screen.template = 'secure-now'
          screen.alert = { ...screen.alert, level: 5 }
          if (!screen.cells.some((cell: { role: string }) => cell.role === 'source')) screen.cells.push({ id: 'source', role: 'source', priority: 9, text: { ja: '気象庁 10/21 18:15 発表・由利本荘市', en: 'JMA 18:15, Oct 21 · Yurihonjo' }, motion: 'static' })
          return new Response(JSON.stringify(screen), { status: 200, headers: { 'content-type': 'application/json' } })
        }
      })
      const src = encodeURIComponent(`/api/admin/preview-layout?municipality=${MUNICIPALITY}&bulletin=${BULLETIN}&shape=${shape}`)
      await page.goto(`${base}/screen?shape=${shape}&clock=virtual&t=14480&src=${src}`, { waitUntil: 'networkidle0' })
      await page.waitForSelector('.evac-screen[data-ready="1"]', { timeout: READY_MS })
      return await page.evaluate(() =>
        [...document.querySelectorAll('.evac-screen')].map((el) => ({
          template: (el as HTMLElement).dataset.template ?? '',
          level: (el as HTMLElement).dataset.level ?? '',
          overflow: (el as HTMLElement).dataset.overflow ?? '',
          missing: (el as HTMLElement).dataset.missingRequired ?? '',
          dropped: (el as HTMLElement).dataset.dropped ?? '',
          shelters: el.querySelectorAll('[data-role="shelter"] .shelter-name-text').length,
          arrows: el.querySelectorAll('[data-role="direction"] .pictogram svg').length,
        })),
      )
    } finally {
      await page.close()
    }
  }

  for (const shape of Object.keys(SIZES) as Shape[]) {
    test(shape, async () => {
      const screens = await render(shape)
      assert.equal(screens.length, shape === 'pillar' ? 5 : 1, 'the screen and, on a pillar, its four faces rendered')
      for (const screen of screens) {
        assert.deepEqual([screen.template, screen.level], ['secure-now', '5'], `${shape} renders the level 5 template`)
        assert.ok(screen.shelters >= 1, `${shape} draws the shelter`)
        assert.ok(screen.arrows >= 1, `${shape} draws the direction arrow`)
        assert.ok(!/shelter|direction/.test(screen.dropped), `${shape} dropped: ${screen.dropped}`)
        assert.deepEqual([screen.overflow, screen.missing], ['', ''], `${shape} overflow/missing`)
      }
    })
  }
})
