// Cut 5b: the operator opens 由利本荘's bulletins in /admin, reads the Verifier report, approves the
// Lv4 set and turns auto-publish on for the demo site. Recorded in real time with a drawn cursor.
//
//   node demo/capture/admin_5b.mjs [--base-url http://127.0.0.1:3151]
//
// Starts from no approvals: data/approvals.json is removed first. Output: demo/capture/out/cut05b.mp4
// (1920x1080, 30 fps, no audio).
import { execFile } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { parseArgs, promisify } from 'node:util'

const require = createRequire(new URL('../../app/package.json', import.meta.url))
const puppeteer = require('puppeteer-core')
const run = promisify(execFile)

const APPROVALS = fileURLToPath(new URL('../../data/approvals.json', import.meta.url))
const OUT = fileURLToPath(new URL('./out/cut05b.mp4', import.meta.url))
const FRAMES_DIR = fileURLToPath(new URL('../cache/admin_frames/', import.meta.url))
const CHROME_PATH = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VIEW = { width: 1920, height: 1080 }
const SHOT_INTERVAL_MS = 66
const MUNICIPALITY = '05210'
const BULLETIN = 'VXKOii-202610211815-e713da0e3c05'
const SITE = '05210-demo-honjo-station'
const MOVE_STEPS = 24

const { values: opts } = parseArgs({ options: { 'base-url': { type: 'string', default: 'http://127.0.0.1:3151' } } })

const CURSOR_SCRIPT = `
addEventListener('DOMContentLoaded', () => {
  const cursor = document.createElement('div')
  cursor.innerHTML = '<svg width="28" height="28" viewBox="0 0 28 28"><path d="M3 2 L3 23 L9 17 L13 26 L17 24 L13 15 L21 15 Z" fill="#111" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>'
  Object.assign(cursor.style, { position: 'fixed', left: '0', top: '0', zIndex: 2147483647, pointerEvents: 'none' })
  document.body.appendChild(cursor)
  addEventListener('mousemove', (e) => { cursor.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)' }, true)
})`

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function recorder(page) {
  const frames = []
  let recording = true
  const loop = (async () => {
    while (recording) {
      const shotAt = performance.now()
      const path = `${FRAMES_DIR}${String(frames.length).padStart(5, '0')}.png`
      await page.screenshot({ path })
      frames.push({ t: shotAt / 1000, path })
      await pause(Math.max(0, SHOT_INTERVAL_MS - (performance.now() - shotAt)))
    }
  })()
  return { frames, stop: async () => { recording = false; await loop } }
}

async function moveTo(page, selector) {
  const element = await page.waitForSelector(selector, { visible: true })
  const box = await element.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: MOVE_STEPS })
  return element
}

async function clickOn(page, selector) {
  await moveTo(page, selector)
  await pause(250)
  await page.mouse.down()
  await pause(80)
  await page.mouse.up()
}

// The bulletin list scrolls on its own; wheel it like an operator until the entry is in view.
async function scrollListTo(page, selector) {
  const list = await page.$('nav.list')
  const listBox = await list.boundingBox()
  await page.mouse.move(listBox.x + listBox.width / 2, listBox.y + listBox.height / 2, { steps: MOVE_STEPS })
  for (let i = 0; i < 60; i++) {
    const box = await (await page.$(selector)).boundingBox()
    if (box.y + box.height < listBox.y + listBox.height - 80) return
    await page.mouse.wheel({ deltaY: 90 })
    await pause(70)
  }
  throw new Error(`could not scroll ${selector} into the list`)
}

async function act(page) {
  await page.mouse.move(VIEW.width * 0.55, VIEW.height * 0.5)
  await pause(1500)
  await moveTo(page, '[data-control="municipality"]')
  await page.select('[data-control="municipality"]', MUNICIPALITY)
  await pause(1500)
  await scrollListTo(page, `[data-bulletin="${BULLETIN}"]`)
  await pause(500)
  await clickOn(page, `[data-bulletin="${BULLETIN}"]`)
  await pause(3000)
  await moveTo(page, '.report [data-outcome]')
  await pause(2200)
  await clickOn(page, '[data-action="approve"]')
  await page.waitForSelector('[data-action="approve"][aria-pressed="true"]')
  await pause(2200)
  await moveTo(page, `[data-site="${SITE}"]`)
  await pause(500)
  await clickOn(page, `[data-site="${SITE}"]`)
  await page.waitForFunction((site) => document.querySelector(`[data-site="${site}"]`)?.checked, {}, SITE)
  await pause(3000)
}

async function encode(frames) {
  const listing = frames.map((frame, i) => {
    const next = frames[i + 1]?.t ?? frame.t + SHOT_INTERVAL_MS / 1000
    return `file '${frame.path}'\nduration ${(next - frame.t).toFixed(4)}\n`
  })
  const listPath = `${FRAMES_DIR}frames.txt`
  await writeFile(listPath, listing.join('') + `file '${frames.at(-1).path}'\n`)
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listPath,
    '-vf', 'fps=30', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-an', OUT])
}

async function main() {
  await rm(APPROVALS, { force: true })
  await rm(FRAMES_DIR, { recursive: true, force: true })
  await mkdir(FRAMES_DIR, { recursive: true })
  await mkdir(fileURLToPath(new URL('./out/', import.meta.url)), { recursive: true })
  const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true })
  const page = await browser.newPage()
  await page.setViewport({ ...VIEW, deviceScaleFactor: 1 })
  await page.evaluateOnNewDocument(CURSOR_SCRIPT)
  await page.goto(`${opts['base-url']}/admin`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.admin[data-ready="1"]')
  const rec = recorder(page)
  try {
    await act(page)
  } finally {
    await rec.stop()
    await browser.close()
  }
  await encode(rec.frames)
  const seconds = rec.frames.at(-1).t - rec.frames[0].t
  console.log(`ADMIN ${OUT} frames=${rec.frames.length} seconds=${seconds.toFixed(1)}`)
}

await main()
