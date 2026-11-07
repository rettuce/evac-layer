import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { APP_DIR, SERVER_ENTRY, postJson, startServer } from './helpers.ts'

const require = createRequire(import.meta.url)
const puppeteer = require('puppeteer-core') as typeof import('puppeteer-core')

const CHROME_PATH = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const MUNICIPALITY = '00004'
const BULLETIN = 'TEST-NO-WEBGL-1'
const SITE = 'no-webgl-site'
const WEBGL_SCENE = 'brush-flow'
const STILL_GROUND = [17, 17, 17]
const WAIT_MS = 15000

const skip = (!existsSync(SERVER_ENTRY) && 'run `pnpm -F app build` first') || (!existsSync(CHROME_PATH) && `no Chrome at ${CHROME_PATH}`)

async function makeData(): Promise<string> {
  const dataDir = join(await mkdtemp(join(tmpdir(), 'evac-no-webgl-')), 'data')
  const layoutDir = join(dataDir, 'layouts', SITE, BULLETIN)
  await mkdir(layoutDir, { recursive: true })
  await mkdir(join(dataDir, 'sites'))
  const fixture = JSON.parse(await readFile(join(APP_DIR, 'fixtures', 'wajima-tsunami.json'), 'utf8'))
  await writeFile(join(layoutDir, '16x9.json'), JSON.stringify({ ...fixture, alert: { ...fixture.alert, bulletin_id: BULLETIN } }))
  await writeFile(
    join(dataDir, 'layouts', SITE, 'index.json'),
    JSON.stringify({
      municipality: MUNICIPALITY,
      name: 'ウェブジーエル無し市',
      site: SITE,
      entries: [{ issued_at: '2026-10-21T15:55:00+09:00', bulletin_id: BULLETIN, wmo_code: 'VXKO50', raw_title: 'test', municipality_level: 4, screen: true }],
    }),
  )
  await writeFile(join(dataDir, 'sites', `${SITE}.json`), JSON.stringify({ id: SITE, municipality_id: MUNICIPALITY }))
  return dataDir
}

describe('live screen on a player without WebGL', { skip }, () => {
  let base = ''
  let child: ChildProcess | undefined
  let browser: import('puppeteer-core').Browser | undefined

  before(async () => {
    ;({ base, child } = await startServer({ NUXT_DATA_DIR: await makeData(), NUXT_ADMIN_TOKEN: '' }))
    assert.equal((await postJson(base, '/api/admin/site', { site_id: SITE, auto_publish: true })).status, 200)
    browser = await puppeteer.launch({ executablePath: CHROME_PATH })
  })
  after(async () => {
    await browser?.close()
    child?.kill()
  })

  test('shows a still ambient screen without throwing, then the alert when one is approved', async () => {
    const page = await browser!.newPage()
    const pageErrors: string[] = []
    const warnings: string[] = []
    page.on('pageerror', (error) => pageErrors.push(String(error)))
    page.on('console', (message) => {
      if (message.type() === 'warn' && message.text().includes('ambient scene')) warnings.push(message.text())
    })
    await page.evaluateOnNewDocument(() => {
      const getContext = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, id: string, ...rest: unknown[]) {
        if (id.startsWith('webgl')) return null
        return (getContext as (...args: unknown[]) => RenderingContext | null).call(this, id, ...rest)
      } as typeof getContext
    })
    await page.setViewport({ width: 960, height: 540 })
    await page.goto(`${base}/screen?shape=16x9&mode=live&municipality=${MUNICIPALITY}&site=${SITE}&scene=${WEBGL_SCENE}`)
    await page.waitForSelector(`.ambient[data-scene="${WEBGL_SCENE}"][data-ready="1"]`, { timeout: WAIT_MS })
    await page.waitForFunction(() => {
      const canvas = document.querySelector('.ambient-canvas') as HTMLCanvasElement | null
      return !!canvas && canvas.width > 0
    }, { timeout: WAIT_MS })
    const corner = await page.$eval('.ambient-canvas', (canvas) => Array.from((canvas as HTMLCanvasElement).getContext('2d')!.getImageData(2, 2, 1, 1).data.slice(0, 3)))
    assert.deepEqual(corner, STILL_GROUND)

    assert.equal((await postJson(base, '/api/admin/approve', { municipality: MUNICIPALITY, bulletin_id: BULLETIN, approved: true })).status, 200)
    await page.waitForSelector(`[data-mode="live"][data-showing="${BULLETIN}"]`, { timeout: WAIT_MS })
    await page.waitForFunction((id) => getComputedStyle(document.querySelector(`[data-layer-bulletin="${id}"]`)!).opacity === '1', { timeout: WAIT_MS }, BULLETIN)
    assert.match(await page.$eval(`[data-layer-bulletin="${BULLETIN}"]`, (el) => el.textContent ?? ''), /\S/)

    assert.deepEqual(pageErrors, [])
    assert.equal(warnings.length, 1)
    await page.close()
  })
})
