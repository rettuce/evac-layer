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
const SIZES: Partial<Record<Shape, [number, number]>> = { '9x16': [1080, 1920], '1x1': [1080, 1080] }
const LONG_NAMES = [
  ['15205-demo', 'VPWW56-202610311653-b3fa1b3a2ced', 'レベル４ 土砂災害危険警報'],
  ['17204-demo', 'VPWW56-202610220000-d13b2ada2646', 'レベル２ 土砂災害注意報解除'],
] as const
const LONGER_THAN_A_LINE = 'レベル５ 大雨特別警報（土砂災害・浸水害）'
const READY_MS = 30000
// TYPE_PX.guide in layout/typography.ts: the floor the Verifier holds a headline to.
const GUIDE_STEP_PX = 64

const skip = (!existsSync(SERVER_ENTRY) && 'run `pnpm -F app build` first') || (!existsSync(CHROME_PATH) && `no Chrome at ${CHROME_PATH}`)

interface Headline {
  text: string
  designPx: number
  lines: number
  overflow: string
  dropped: string
  labelBelowText: boolean
}

describe('a long JMA headline on the stacked bands stays at or above the guide step', { skip }, () => {
  let base = ''
  let child: ChildProcess | undefined
  let browser: import('puppeteer-core').Browser | undefined

  before(async () => {
    ;({ base, child } = await startServer({ NUXT_ADMIN_TOKEN: '' }))
    browser = await puppeteer.launch({ executablePath: CHROME_PATH, args: ['--disable-gpu-rasterization'] })
  })
  after(async () => {
    await browser?.close()
    child?.kill()
  })

  async function render(site: string, bulletin: string, shape: Shape, headline?: string): Promise<Headline> {
    const [width, height] = SIZES[shape]!
    const page = await browser!.newPage()
    try {
      await page.setViewport({ width, height, deviceScaleFactor: 0.25 })
      if (headline) {
        await page.evaluateOnNewDocument((text: string) => {
          const original = window.fetch
          window.fetch = async (input, init) => {
            const response = await original(input, init)
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
            if (!url.includes('/api/admin/preview-layout')) return response
            const screen = await response.json()
            for (const cell of screen.cells) if (cell.role === 'headline') cell.text = { ...cell.text, ja: text }
            return new Response(JSON.stringify(screen), { status: 200, headers: { 'content-type': 'application/json' } })
          }
        }, headline)
      }
      const src = encodeURIComponent(`/api/admin/preview-layout?site=${site}&bulletin=${bulletin}&shape=${shape}`)
      await page.goto(`${base}/screen?shape=${shape}&clock=virtual&t=14480&src=${src}`, { waitUntil: 'networkidle0' })
      await page.waitForSelector('.evac-screen[data-ready="1"]', { timeout: READY_MS })
      return await page.evaluate(() => {
        const root = document.querySelector<HTMLElement>('.evac-screen')!
        const text = root.querySelector<HTMLElement>('.headline-text')!
        const label = root.querySelector<HTMLElement>('[data-role="headline"] .level-label')
        const px = parseFloat(getComputedStyle(root).getPropertyValue('--px')) || 1
        const range = document.createRange()
        range.selectNodeContents(text)
        const rects = [...range.getClientRects()]
        return {
          text: text.textContent ?? '',
          designPx: parseFloat(getComputedStyle(text).fontSize) / px,
          lines: new Set(rects.map((rect) => Math.round(rect.top))).size,
          overflow: root.dataset.overflow ?? '',
          dropped: root.dataset.dropped ?? '',
          labelBelowText: !label || rects.every((rect) => rect.bottom <= label.getBoundingClientRect().top + 1),
        }
      })
    } finally {
      await page.close()
    }
  }

  for (const shape of Object.keys(SIZES) as Shape[]) {
    for (const [site, bulletin, name] of LONG_NAMES) {
      test(`${shape} ${name} is set at the guide step on one line`, async () => {
        const headline = await render(site, bulletin, shape)
        assert.equal(headline.text.replace(/\s+/g, ' ').trim(), name)
        assert.ok(headline.designPx >= GUIDE_STEP_PX - 0.5, `${headline.designPx}px`)
        assert.equal(headline.lines, 1)
        assert.equal(headline.overflow, '')
      })
    }
  }

  test('9x16 a headline longer than the band at the guide step takes another line instead of shrinking', async () => {
    const [site, bulletin] = LONG_NAMES[0]
    const headline = await render(site, bulletin, '9x16', LONGER_THAN_A_LINE)
    assert.equal(headline.text.replace(/\s+/g, ' ').trim(), LONGER_THAN_A_LINE)
    assert.ok(headline.designPx >= GUIDE_STEP_PX - 0.5, `${headline.designPx}px`)
    assert.equal(headline.lines, 2)
    assert.ok(headline.labelBelowText, 'the level label sits under the second line')
    assert.equal(headline.overflow, '')
    assert.ok(!headline.dropped.includes('headline'), headline.dropped)
  })
})
