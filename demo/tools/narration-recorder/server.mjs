import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { mkdir, open, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, promisify } from 'node:util'

const REPO = fileURLToPath(new URL('../../../', import.meta.url))
const EDL = join(REPO, 'demo/compose/edl.json')
const INDEX_HTML = fileURLToPath(new URL('./index.html', import.meta.url))
const HOST = '127.0.0.1'
const MAX_TAKE_BYTES = 200 * 1024 * 1024
const WAV_HEADER_PROBE_BYTES = 4096
const STILL_WIDTH = 640
const CACHE_DIR = fileURLToPath(new URL('./.cache/', import.meta.url))
const run = promisify(execFile)

const { values: opts } = parseArgs({
  options: {
    port: { type: 'string', default: '3190' },
    out: { type: 'string', default: join(REPO, 'demo/compose/audio/narration') },
    cuts: { type: 'string', default: join(homedir(), 'Dropbox/dev/claude-hackathon-2026/review/davinci/video/cuts') },
  },
})
const OUT_DIR = resolve(opts.out)
const PREV_DIR = join(dirname(OUT_DIR), `${basename(OUT_DIR)}-prev`)
const CUTS_DIR = resolve(opts.cuts)

export function narrationFilename(cut) {
  const [, number, suffix] = /^(\d+)(\D*)$/.exec(cut)
  return `cut${number.padStart(2, '0')}${suffix}.wav`
}

export function narratedCuts(edl) {
  const starts = {}
  let t = 0
  for (const segment of edl.segments) {
    starts[segment.cut] = t
    t += segment.seconds
  }
  const total = t
  const narrated = edl.segments.filter((s) => s.narration_ja)
  return narrated.map((segment, i) => {
    const start = starts[segment.cut] + (segment.narration_from_s ?? 0)
    const end = i + 1 < narrated.length ? starts[narrated[i + 1].cut] : total
    return {
      cut: segment.cut,
      file: narrationFilename(segment.cut),
      narration_ja: segment.narration_ja,
      reading_ja: segment.reading_ja ?? '',
      seconds: segment.seconds,
      start: Math.round(start * 100) / 100,
      window: Math.round((end - start) * 100) / 100,
    }
  })
}

function wavSeconds(header) {
  let byteRate = 0
  for (let at = 12; at + 8 <= header.length;) {
    const id = header.toString('ascii', at, at + 4)
    const size = header.readUInt32LE(at + 4)
    if (id === 'fmt ') byteRate = header.readUInt32LE(at + 16)
    if (id === 'data') return byteRate ? size / byteRate : null
    at += 8 + size + (size % 2)
  }
  return null
}

async function savedTake(file) {
  const path = join(OUT_DIR, file)
  const info = await stat(path).catch(() => null)
  if (!info) return null
  const handle = await open(path, 'r')
  const { buffer, bytesRead } = await handle.read(Buffer.alloc(WAV_HEADER_PROBE_BYTES), 0, WAV_HEADER_PROBE_BYTES, 0)
  await handle.close()
  return { bytes: info.size, seconds: wavSeconds(buffer.subarray(0, bytesRead)), mtime: info.mtime.toISOString() }
}

async function cuts() {
  const edl = JSON.parse(await readFile(EDL, 'utf8'))
  return Promise.all(narratedCuts(edl).map(async (entry) => ({ ...entry, saved: await savedTake(entry.file) })))
}

async function cutMovie(cut) {
  const names = await readdir(CUTS_DIR).catch(() => [])
  const name = names.find((n) => n === `cut${cut}.mov` || new RegExp(`^\\d+-cut${cut}\\.mov$`).test(n))
  return name ? join(CUTS_DIR, name) : null
}

const stillJobs = new Map()

async function extractStill(cut) {
  const target = join(CACHE_DIR, `${cut}.png`)
  if (await stat(target).catch(() => null)) return target
  const movie = await cutMovie(cut)
  if (!movie) return null
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', movie])
  await mkdir(CACHE_DIR, { recursive: true })
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(Number(stdout) / 2), '-i', movie, '-frames:v', '1', '-vf', `scale=${STILL_WIDTH}:-2`, target])
  return target
}

function still(cut) {
  if (!stillJobs.has(cut)) stillJobs.set(cut, extractStill(cut).catch(() => null))
  return stillJobs.get(cut)
}

function readBody(req) {
  return new Promise((done, fail) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_TAKE_BYTES) {
        fail(Object.assign(new Error('take too large'), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => done(Buffer.concat(chunks)))
    req.on('error', fail)
  })
}

async function putTake(file, body) {
  if (body.toString('ascii', 0, 4) !== 'RIFF' || body.toString('ascii', 8, 12) !== 'WAVE') {
    throw Object.assign(new Error('body is not a RIFF/WAVE file'), { status: 400 })
  }
  await mkdir(OUT_DIR, { recursive: true })
  const target = join(OUT_DIR, file)
  const temp = join(OUT_DIR, `.${file}.tmp`)
  await writeFile(temp, body)
  if (await stat(target).catch(() => null)) {
    await mkdir(PREV_DIR, { recursive: true })
    await rename(target, join(PREV_DIR, file))
  }
  await rename(temp, target)
  return { file, bytes: body.length, seconds: wavSeconds(body) }
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
}

async function handle(req, res) {
  const { pathname } = new URL(req.url, `http://${HOST}`)
  if (pathname.includes('..')) return send(res, 400, { error: 'bad path' })
  if (req.method === 'GET' && pathname === '/') return send(res, 200, await readFile(INDEX_HTML), 'text/html; charset=utf-8')
  if (req.method === 'GET' && pathname === '/api/cuts') return send(res, 200, await cuts())
  const stillMatch = /^\/api\/still\/([\w-]+)$/.exec(pathname)
  if (req.method === 'GET' && stillMatch) {
    const path = await still(stillMatch[1])
    if (!path) return send(res, 404, { error: `no cut movie for ${stillMatch[1]} in ${CUTS_DIR}` })
    return send(res, 200, await readFile(path), 'image/png')
  }
  const take = /^\/api\/take\/([\w.-]+\.wav)$/.exec(pathname)
  if (take) {
    const file = take[1]
    const known = (await cuts()).some((entry) => entry.file === file)
    if (!known) return send(res, 404, { error: `${file} is not a narrated cut` })
    if (req.method === 'PUT') return send(res, 200, await putTake(file, await readBody(req)))
    if (req.method === 'GET') {
      const path = join(OUT_DIR, file)
      if (!(await stat(path).catch(() => null))) return send(res, 404, { error: `${file} has not been recorded` })
      res.writeHead(200, { 'content-type': 'audio/wav', 'cache-control': 'no-store' })
      return createReadStream(path).pipe(res)
    }
  }
  return send(res, 404, { error: 'not found' })
}

createServer((req, res) => {
  handle(req, res).catch((error) => send(res, error.status ?? 500, { error: error.message }))
}).listen(Number(opts.port), HOST, () => {
  console.log(`NARRATION RECORDER http://${HOST}:${opts.port}/ → ${OUT_DIR}`)
})
