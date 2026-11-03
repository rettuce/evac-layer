import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { after, before, describe, test } from 'node:test'
import { shapeForViewport, viewportFromQuery } from '../layout/shapes.ts'
import type { Shape } from '../layout/types.ts'
import { SERVER_ENTRY, startServer } from './helpers.ts'

const require = createRequire(import.meta.url)
const puppeteer = require('puppeteer-core') as typeof import('puppeteer-core')

const CHROME_PATH = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const MUNICIPALITY = '05210'
const BULLETIN = 'VXKOii-202610211815-e713da0e3c05'
const NATIVE: Record<string, string> = { '32x9': '32:9', '16x9': '16:9', '1x1': '1:1', '9x16': '9:16' }
const SWEEP = ['3:1', '21:9', '2:1', '16:10', '3:2', '4:3', '5:4', '4:5', '3:4', '10:16', '1:2']
const READY_MS = 30000

const skip = (!existsSync(SERVER_ENTRY) && 'run `pnpm -F app build` first') || (!existsSync(CHROME_PATH) && `no Chrome at ${CHROME_PATH}`)

test('aspect queries resolve to a viewport and its base shape', () => {
  assert.deepEqual(viewportFromQuery(undefined, undefined, '4:3'), { width: 1440, height: 1080 })
  assert.deepEqual(viewportFromQuery(undefined, undefined, '10:16'), { width: 1080, height: 1728 })
  assert.deepEqual(viewportFromQuery('1366', '768', '4:3'), { width: 1366, height: 768 })
  for (const bad of ['4/3', '0:1', '-4:3', 'x', '4:3:2']) assert.equal(viewportFromQuery(undefined, undefined, bad), undefined, bad)
  const boundaries: [number, Shape][] = [[2800, '32x9'], [2799, '16x9'], [1250, '16x9'], [1249, '1x1'], [751, '1x1'], [750, '9x16']]
  for (const [width, family] of boundaries) assert.equal(shapeForViewport(width, 1000), family, `${width}:1000`)
})

describe('any aspect keeps the guidance', { skip }, () => {
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

  async function render(aspect: string) {
    const { width, height } = viewportFromQuery(undefined, undefined, aspect)!
    const family = shapeForViewport(width, height)
    const page = await browser!.newPage()
    try {
      await page.setViewport({ width, height, deviceScaleFactor: 0.25 })
      const src = encodeURIComponent(`/api/admin/preview-layout?municipality=${MUNICIPALITY}&bulletin=${BULLETIN}&shape=${family}`)
      await page.goto(`${base}/screen?aspect=${aspect}&clock=virtual&t=5000&src=${src}`, { waitUntil: 'networkidle0' })
      await page.waitForSelector('.evac-screen[data-ready="1"]', { timeout: READY_MS })
      const sources = await page.$$eval('footer[data-sources] li', (items) => items.length)
      const state = await page.$eval('.evac-screen', (el) => ({
        shape: (el as HTMLElement).dataset.shape as Shape,
        overflow: (el as HTMLElement).dataset.overflow ?? '',
        missing: (el as HTMLElement).dataset.missingRequired ?? '',
        dropped: (el as HTMLElement).dataset.dropped ?? '',
      }))
      return { ...state, sources }
    } finally {
      await page.close()
    }
  }

  test('no overflow and no missing cell at any aspect, and no base shape drops more than at its own aspect', async () => {
    const nativeDropped = new Map<string, Set<string>>()
    for (const [shape, aspect] of Object.entries(NATIVE)) {
      const state = await render(aspect)
      assert.equal(state.shape, shape, aspect)
      assert.deepEqual([state.overflow, state.missing], ['', ''], aspect)
      assert.ok(state.sources >= 2, `${aspect} keeps every source in the document`)
      nativeDropped.set(shape, new Set(state.dropped.split(',').filter(Boolean)))
    }
    for (const aspect of SWEEP) {
      const state = await render(aspect)
      assert.deepEqual([state.overflow, state.missing], ['', ''], `${aspect} (${state.shape})`)
      const extra = state.dropped.split(',').filter((d) => d && !nativeDropped.get(state.shape)!.has(d))
      assert.deepEqual(extra, [], `${aspect} (${state.shape}) drops more than ${NATIVE[state.shape]}`)
    }
  })
})
