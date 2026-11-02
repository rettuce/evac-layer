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
const MUNICIPALITY = '00003'
const BULLETIN = 'TEST-LIVE-1'
const SITE = 'live-site'
const STALE_AFTER_MS = 1500
const WAIT_MS = 15000

const skip = (!existsSync(SERVER_ENTRY) && 'run `pnpm -F app build` first') || (!existsSync(CHROME_PATH) && `no Chrome at ${CHROME_PATH}`)

async function makeData(): Promise<string> {
  const dataDir = join(await mkdtemp(join(tmpdir(), 'evac-live-')), 'data')
  const layoutDir = join(dataDir, 'layouts', MUNICIPALITY, BULLETIN)
  await mkdir(layoutDir, { recursive: true })
  await mkdir(join(dataDir, 'sites'))
  const fixture = JSON.parse(await readFile(join(APP_DIR, 'fixtures', 'wajima-tsunami.json'), 'utf8'))
  await writeFile(join(layoutDir, '16x9.json'), JSON.stringify({ ...fixture, alert: { ...fixture.alert, bulletin_id: BULLETIN } }))
  await writeFile(
    join(dataDir, 'layouts', MUNICIPALITY, 'index.json'),
    JSON.stringify({
      municipality: MUNICIPALITY,
      name: 'ライブ市',
      site: SITE,
      entries: [{ issued_at: '2026-10-21T15:55:00+09:00', bulletin_id: BULLETIN, wmo_code: 'VXKO50', raw_title: 'test', municipality_level: 4, screen: true }],
    }),
  )
  await writeFile(join(dataDir, 'sites', `${SITE}.json`), JSON.stringify({ id: SITE, municipality_id: MUNICIPALITY }))
  return dataDir
}

describe('live screen when the server goes away', { skip }, () => {
  let base = ''
  let child: ChildProcess | undefined
  let dataDir = ''
  let browser: import('puppeteer-core').Browser | undefined

  before(async () => {
    dataDir = await makeData()
    ;({ base, child } = await startServer({ NUXT_DATA_DIR: dataDir, NUXT_ADMIN_TOKEN: '' }))
    assert.equal((await postJson(base, '/api/admin/site', { site_id: SITE, auto_publish: true })).status, 200)
    assert.equal((await postJson(base, '/api/admin/approve', { municipality: MUNICIPALITY, bulletin_id: BULLETIN, approved: true })).status, 200)
    browser = await puppeteer.launch({ executablePath: CHROME_PATH })
  })
  after(async () => {
    await browser?.close()
    child?.kill()
  })

  test('keeps showing the alert, marks itself stale, and resyncs when the server returns', async () => {
    const page = await browser!.newPage()
    await page.setViewport({ width: 1920, height: 1080 })
    await page.goto(`${base}/screen?shape=16x9&mode=live&municipality=${MUNICIPALITY}&site=${SITE}&speed=1200&stale_after=${STALE_AFTER_MS}`)
    await page.waitForSelector(`[data-mode="live"][data-ready="1"][data-showing="${BULLETIN}"]`, { timeout: WAIT_MS })
    assert.match(await page.$eval('.sync-stamp', (el) => el.textContent ?? ''), /更新 \d\d:\d\d/)
    assert.equal(await page.$eval('[data-mode="live"]', (el) => el.getAttribute('data-stale')), null)

    const port = new URL(base).port
    child!.kill()
    await new Promise((resolve) => child!.once('exit', resolve))
    await page.waitForSelector('[data-mode="live"][data-stale="1"]', { timeout: WAIT_MS })
    const held = await page.$eval('[data-mode="live"]', (el) => ({
      showing: el.getAttribute('data-showing'),
      error: el.getAttribute('data-sync-error'),
      alertOpacity: getComputedStyle(el.querySelector(`[data-layer-bulletin]`)!).opacity,
      stamp: el.querySelector('.sync-stamp')?.textContent ?? '',
    }))
    assert.equal(held.showing, BULLETIN)
    assert.equal(held.alertOpacity, '1')
    assert.ok(held.error, 'the failed poll is recorded')
    assert.match(held.stamp, /○/)
    assert.equal(await page.$('[data-error]'), null)

    ;({ child } = await startServer({ NUXT_DATA_DIR: dataDir, NUXT_ADMIN_TOKEN: '' }, Number(port)))
    await page.waitForFunction(() => !document.querySelector('[data-mode="live"]')?.hasAttribute('data-stale'), { timeout: WAIT_MS })
    await page.waitForSelector(`[data-mode="live"][data-showing="${BULLETIN}"]`, { timeout: WAIT_MS })
  })
})
