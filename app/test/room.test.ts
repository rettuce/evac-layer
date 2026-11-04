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

  const SCENE_QUERY = 'clock=virtual&t=5000&mode=scenario&scenario=ambient&overlay=none'

  async function pixels(scene: string, crop: [number, number, number, number]): Promise<Buffer> {
    return grab(scene, crop[2], crop[3], `canvas=${ROOM.width}x${ROOM.height}&crop=${crop.join(',')}&canvas_id=test`)
  }

  async function grab(scene: string, width: number, height: number, extra: string): Promise<Buffer> {
    const page = await browser!.newPage()
    try {
      await page.setViewport({ width, height, deviceScaleFactor: 1 })
      await page.goto(`${base}/screen?shape=16x9&${SCENE_QUERY}&scene=${scene}&${extra}`, { waitUntil: 'networkidle0' })
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

  // The tiles are drawn on a CPU canvas and the one-call screen on a GPU one, so curve and stroke edges differ by a
  // few levels everywhere (and WebGL particles by more); a seam shows instead as those differences crowding the
  // tile edges. The room's own outer edge is cut by the one-call canvas and not by the tiles, so that band is left out.
  test('the room drawn in 512 px tiles matches the same view drawn in one call, in every scene', async () => {
    const seed = encodeURIComponent(roomSeedKey(ROOM, 'test'))
    const TILE = 512
    const BAND_PX = 8
    const CROWDING = 2
    const SLACK_PX = 5
    const failures: string[] = []
    for (const scene of AMBIENT_SCENES) {
      const tiled = await pixels(scene.id, [0, 0, ROOM.width, ROOM.height])
      const single = await grab(scene.id, ROOM.width, ROOM.height, `seed=${seed}`)
      let inBand = 0
      let outside = 0
      let bandArea = 0
      let area = 0
      for (let y = BAND_PX; y < ROOM.height - BAND_PX; y++) {
        for (let x = BAND_PX; x < ROOM.width - BAND_PX; x++) {
          const band = Math.abs(x - TILE) < BAND_PX || Math.abs(y - TILE) < BAND_PX
          area++
          if (band) bandArea++
          const p = (y * ROOM.width + x) * 4
          let d = 0
          for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(tiled[p + c]! - single[p + c]!))
          if (d <= 1) continue
          if (band) inBand++
          else outside++
        }
      }
      const expected = (outside / (area - bandArea)) * bandArea
      if (inBand > CROWDING * expected + SLACK_PX) failures.push(`${scene.id}: ${inBand} px differ along the tile edges where ${expected.toFixed(1)} would be the scene's own noise`)
    }
    assert.deepEqual(failures, [], `tiles show seams — ${failures.join('; ')}`)
  })
})
