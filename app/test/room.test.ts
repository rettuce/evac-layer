import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { after, before, describe, test } from 'node:test'
import { formatCoords } from '../layout/ambient/overlay.ts'
import { AMBIENT_SCENES } from '../layout/ambient/registry.ts'
import { parseCrop, parseRoom, roomSeedKey } from '../layout/ambient/room.ts'
import { SERVER_ENTRY, startServer } from './helpers.ts'

const require = createRequire(import.meta.url)
const puppeteer = require('puppeteer-core') as typeof import('puppeteer-core')

const CHROME_PATH = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ROOM = { width: 960, height: 540 }
const READY_MS = 30000

const skip = (!existsSync(SERVER_ENTRY) && 'run `pnpm -F app build` first') || (!existsSync(CHROME_PATH) && `no Chrome at ${CHROME_PATH}`)

test('a room and its crops are read from the query, and the seed belongs to the room', () => {
  assert.deepEqual(parseRoom('7680x2160'), { width: 7680, height: 2160 })
  for (const bad of ['7680', '7680x', 'x2160', '7680x2160x1', '-1x5', undefined]) assert.equal(parseRoom(bad), undefined, String(bad))
  const room = { width: 7680, height: 2160 }
  assert.deepEqual(parseCrop('1920,540,1920,1080', room), { x: 1920, y: 540, width: 1920, height: 1080 })
  for (const bad of ['7000,0,1920,1080', '0,0,0,10', '0,0,10', '-1,0,10,10']) assert.equal(parseCrop(bad, room), undefined, bad)
  assert.equal(roomSeedKey(room, 'hall'), roomSeedKey(room, 'hall'))
  assert.notEqual(roomSeedKey(room, 'hall'), roomSeedKey(room, 'lobby'))
  assert.equal(formatCoords(39.38634, 140.05628), '39.3863° N, 140.0563° E')
  assert.equal(formatCoords(-33.8688, -151.2093), '33.8688° S, 151.2093° W')
})

describe('screens cut from one room canvas', { skip }, () => {
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

  async function pixels(scene: string, crop: [number, number, number, number]): Promise<Buffer> {
    const page = await browser!.newPage()
    try {
      await page.setViewport({ width: crop[2], height: crop[3], deviceScaleFactor: 1 })
      const query = `clock=virtual&t=5000&mode=scenario&scenario=ambient&scene=${scene}&canvas=${ROOM.width}x${ROOM.height}&crop=${crop.join(',')}&canvas_id=test&overlay=none`
      await page.goto(`${base}/screen?shape=16x9&${query}`, { waitUntil: 'networkidle0' })
      await page.waitForSelector('.ambient[data-ready="1"]', { timeout: READY_MS })
      const encoded = await page.$eval('.ambient-canvas', (canvas) => {
        const data = (canvas as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, (canvas as HTMLCanvasElement).width, (canvas as HTMLCanvasElement).height).data
        let text = ''
        for (let i = 0; i < data.length; i += 0x8000) text += String.fromCharCode(...data.subarray(i, i + 0x8000))
        return btoa(text)
      })
      return Buffer.from(encoded, 'base64')
    } finally {
      await page.close()
    }
  }

  test('two neighbouring crops match the whole room drawn at once, in every scene', async () => {
    const half = ROOM.width / 2
    for (const scene of AMBIENT_SCENES) {
      const whole = await pixels(scene.id, [0, 0, ROOM.width, ROOM.height])
      const parts = [await pixels(scene.id, [0, 0, half, ROOM.height]), await pixels(scene.id, [half, 0, half, ROOM.height])]
      let worst = 0
      for (let y = 0; y < ROOM.height; y++) {
        for (let x = 0; x < ROOM.width; x++) {
          const part = parts[x < half ? 0 : 1]!
          const p = (y * half + (x % half)) * 4
          const w = (y * ROOM.width + x) * 4
          for (let c = 0; c < 4; c++) worst = Math.max(worst, Math.abs(whole[w + c]! - part[p + c]!))
        }
      }
      assert.ok(worst <= 1, `${scene.id}: crops differ from the whole room by up to ${worst}`)
    }
  })
})
