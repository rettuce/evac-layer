import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { layoutDigest } from '../layout/gate.ts'
import { APP_DIR } from './helpers.ts'

const FIXTURE = JSON.parse(await readFile(join(APP_DIR, 'fixtures', 'wajima-tsunami.json'), 'utf8'))
const DEFAULT_SHAPES = ['16x9', '1x1']

// Stand-ins for `pnpm -F agents generate` and `pnpm -F agents preview`. They take nothing from the environment but
// EVAC_DATA_DIR (the server hands its children an allowlist), copy what a test staged under <root>/source/<site>/
// into the data directory, and log their calls, environment and pid under <root>.
const SCRIPT_HEAD = (root: string) => `#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
const root = ${JSON.stringify(root)}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const log = (entry) => appendFileSync(join(root, 'calls.log'), JSON.stringify({ ...entry, at: Date.now() }) + '\\n')
`

const FAKE_GENERATE = (root: string) => `${SCRIPT_HEAD(root)}
const { values } = parseArgs({ options: { site: { type: 'string' }, writer: { type: 'string' }, verifier: { type: 'string' }, 'base-url': { type: 'string' }, classes: { type: 'string' }, grandchild: { type: 'boolean' } } })
const site = values.site
const source = join(root, 'source', site)
if (values.grandchild) {
  process.on('SIGTERM', () => {
    writeFileSync(join(root, 'term-grandchild-' + site), '')
    if (!existsSync(join(source, 'grandchild-stubborn'))) process.exit(143)
  })
  writeFileSync(join(root, 'grandchild-' + site), String(process.pid))
  while (existsSync(join(root, 'hold', site + '.grandchild'))) await sleep(20)
  process.exit(0)
}
process.on('SIGTERM', () => {
  writeFileSync(join(root, 'term-' + site), '')
  process.exit(143)
})
log({ kind: 'generate', site, argv: process.argv.slice(2) })
writeFileSync(join(root, 'env-generate-' + site + '.json'), JSON.stringify(process.env))
writeFileSync(join(root, 'pid-' + site), String(process.pid))
if (existsSync(join(source, 'pipe-holder'))) {
  const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { detached: true, stdio: ['ignore', 'inherit', 'inherit'] })
  holder.unref()
  writeFileSync(join(root, 'stray-' + site), String(holder.pid))
}
while (existsSync(join(root, 'hold', site))) await sleep(20)
await sleep(100)
const data = process.env.EVAC_DATA_DIR
mkdirSync(join(data, 'layouts', site), { recursive: true })
for (const dir of ['layouts', 'reports']) if (existsSync(join(source, dir))) cpSync(join(source, dir), join(data, dir), { recursive: true })
if (existsSync(join(source, 'index.json'))) {
  const staged = JSON.parse(readFileSync(join(source, 'index.json'), 'utf8'))
  const target = join(data, 'layouts', site, 'index.json')
  const kept = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')).entries : []
  const ids = new Set(staged.entries.map((e) => e.bulletin_id))
  writeFileSync(target, JSON.stringify({ ...staged, entries: [...kept.filter((e) => !ids.has(e.bulletin_id)), ...staged.entries] }))
}
if (existsSync(join(source, 'generation.json'))) {
  const generation = JSON.parse(readFileSync(join(source, 'generation.json'), 'utf8'))
  writeFileSync(join(data, 'layouts', site, 'generation.json'), JSON.stringify({ ...generation, generated_at: new Date().toISOString() }))
}
log({ kind: 'generate-end', site })
if (existsSync(join(source, 'grandchild'))) {
  const member = spawn(process.execPath, [process.argv[1], ...process.argv.slice(2), '--grandchild'], { stdio: 'ignore' })
  member.unref()
  while (!existsSync(join(root, 'grandchild-' + site))) await sleep(10)
  process.exit(0)
}
if (existsSync(join(source, 'exit'))) {
  const message = readFileSync(join(source, 'exit'), 'utf8')
  console.log('composing '.repeat(50) + message)
  console.error(message)
  process.exit(1)
}
`

const FAKE_PREVIEW = (root: string) => `${SCRIPT_HEAD(root)}
const { values } = parseArgs({ options: { site: { type: 'string' }, bulletin: { type: 'string' }, out: { type: 'string' }, 'base-url': { type: 'string' } } })
const { site, bulletin, out } = values
process.on('SIGTERM', () => {
  writeFileSync(join(root, 'term-preview-' + site), '')
  if (!existsSync(join(root, 'source', site, 'late-chrome'))) process.exit(143)
  const late = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { detached: true, stdio: 'ignore' })
  late.unref()
  if (process.env.EVAC_CHROME_PID_FILE) appendFileSync(process.env.EVAC_CHROME_PID_FILE, late.pid + '\\n')
  writeFileSync(join(root, 'chrome-late-' + site), String(late.pid))
  setTimeout(() => process.exit(143), 800)
})
log({ kind: 'preview', site, bulletin, argv: process.argv.slice(2) })
writeFileSync(join(root, 'env-preview-' + site + '.json'), JSON.stringify(process.env))
writeFileSync(join(root, 'pid-preview-' + site), String(process.pid))
const source = join(root, 'source', site)
const chromeMode = existsSync(join(source, 'chrome-mode')) ? readFileSync(join(source, 'chrome-mode'), 'utf8') : ''
if (chromeMode.startsWith('stderr:')) console.error('[chrome-pid] ' + chromeMode.slice('stderr:'.length))
if (chromeMode.startsWith('file:') && process.env.EVAC_CHROME_PID_FILE) writeFileSync(process.env.EVAC_CHROME_PID_FILE, chromeMode.slice('file:'.length))
if (chromeMode === 'own') {
  const browser = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { detached: true, stdio: 'ignore' })
  browser.unref()
  if (process.env.EVAC_CHROME_PID_FILE) writeFileSync(process.env.EVAC_CHROME_PID_FILE, String(browser.pid))
  writeFileSync(join(root, 'chrome-' + site), String(browser.pid))
}
while (existsSync(join(root, 'hold', site + '.preview'))) await sleep(20)
if (existsSync(join(source, 'preview-fail'))) {
  console.error('[preview stopped] no Chrome found at /opt/secret/chrome')
  process.exit(3)
}
const failing = existsSync(join(source, 'preview-fail-shapes')) ? JSON.parse(readFileSync(join(source, 'preview-fail-shapes'), 'utf8')) : []
mkdirSync(out, { recursive: true })
for (const file of readdirSync(join(process.env.EVAC_DATA_DIR, 'layouts', site, bulletin))) {
  const shape = file.replace(/\\.json$/, '')
  if (!file.endsWith('.json') || failing.includes(shape)) continue
  writeFileSync(join(out, shape + '.png'), Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from(site + ' ' + bulletin)]))
}
if (failing.length) {
  console.error('[preview incomplete] ' + failing.join(', '))
  process.exit(1)
}
`

const FAKE_EXPORT = (root: string) => `${SCRIPT_HEAD(root)}
const { values } = parseArgs({ options: { site: { type: 'string' }, bulletin: { type: 'string' }, out: { type: 'string' }, 'base-url': { type: 'string' } } })
const { site, bulletin, out } = values
process.on('SIGTERM', () => {
  writeFileSync(join(root, 'term-export-' + site), '')
  process.exit(143)
})
log({ kind: 'export', site, bulletin, argv: process.argv.slice(2) })
writeFileSync(join(root, 'env-export-' + site + '.json'), JSON.stringify(process.env))
writeFileSync(join(root, 'pid-export-' + site), String(process.pid))
while (existsSync(join(root, 'hold', site + '.export'))) await sleep(20)
if (existsSync(join(root, 'source', site, 'export-fail'))) {
  console.error(readFileSync(join(root, 'source', site, 'export-fail'), 'utf8'))
  process.exit(3)
}
mkdirSync(join(out, site, bulletin), { recursive: true })
writeFileSync(join(out, site, bulletin, '16x9.png'), 'png')
`

export interface StagedClass {
  bulletin: string
  level: number
  outcome: 'pass' | 'fail' | 'unsupported'
  variant?: string
  shapes?: string[]
  reason?: string
  issued_at?: string
}

export function layoutBody(spec: StagedClass, shape: string): string {
  return JSON.stringify({ ...FIXTURE, shape, alert: { ...FIXTURE.alert, bulletin_id: spec.bulletin, issued_at: spec.variant ?? '2026-11-01T00:00:00+09:00', level: spec.level } })
}

export function stagedDigest(spec: StagedClass): string {
  return layoutDigest((spec.shapes ?? DEFAULT_SHAPES).map((shape) => ({ shape, body: layoutBody(spec, shape) })))
}

export function classOf(spec: Pick<StagedClass, 'level'>): string {
  return `${FIXTURE.alert.hazard}/${FIXTURE.template}/${spec.level}`
}

const indexRow = (s: StagedClass) => ({ issued_at: s.issued_at ?? '2026-11-01T00:00:00+09:00', bulletin_id: s.bulletin, wmo_code: 'VTSE41', raw_title: 'test', municipality_level: s.level, screen: true })

async function writeScreenFiles(base: string, site: string, spec: StagedClass) {
  const layouts = join(base, 'layouts', site, spec.bulletin)
  await mkdir(layouts, { recursive: true })
  for (const shape of spec.shapes ?? DEFAULT_SHAPES) await writeFile(join(layouts, `${shape}.json`), layoutBody(spec, shape))
  const reports = join(base, 'reports', site, spec.bulletin)
  await mkdir(reports, { recursive: true })
  await writeFile(join(reports, 'report.json'), JSON.stringify({ outcome: spec.outcome, verifier: 'browser', layout_digest: stagedDigest(spec), attempts: [] }))
}

// Screens a site already has from elsewhere (a real bulletin received earlier), written straight into the data.
export async function writeExistingScreens(dataDir: string, site: string, specs: StagedClass[]) {
  for (const spec of specs) await writeScreenFiles(dataDir, site, spec)
  const file = join(dataDir, 'layouts', site, 'index.json')
  const kept = await readFile(file, 'utf8').then((text) => JSON.parse(text).entries, () => [])
  await writeFile(file, JSON.stringify({ municipality: '13101', name: site, site, entries: [...kept, ...specs.map(indexRow)] }))
}

export interface StageOptions {
  exit?: string
  previewFails?: boolean
  previewFailShapes?: string[]
  chromeMode?: string
  grandchild?: 'obedient' | 'stubborn'
  pipeHolder?: boolean
  lateChrome?: boolean
  exportFail?: string
  composable?: string[]
  noResult?: boolean
}

export async function makeFakes(root: string) {
  const generate = join(root, 'fake-generate.mjs')
  const preview = join(root, 'fake-preview.mjs')
  const exporter = join(root, 'fake-export.mjs')
  await writeFile(generate, FAKE_GENERATE(root))
  await writeFile(preview, FAKE_PREVIEW(root))
  await writeFile(exporter, FAKE_EXPORT(root))
  for (const script of [generate, preview, exporter]) await chmod(script, 0o755)
  await mkdir(join(root, 'hold'), { recursive: true })
  await writeFile(join(root, 'calls.log'), '')

  async function stage(site: string, specs: StagedClass[], options: StageOptions = {}) {
    const source = join(root, 'source', site)
    await rm(source, { recursive: true, force: true })
    await mkdir(source, { recursive: true })
    const composed = specs.filter((s) => s.outcome !== 'unsupported')
    for (const spec of composed) await writeScreenFiles(source, site, spec)
    await writeFile(join(source, 'index.json'), JSON.stringify({ municipality: '13101', name: site, site, entries: composed.map(indexRow) }))
    const classes = specs.map((s) =>
      s.outcome === 'unsupported'
        ? { class: classOf(s), outcome: 'unsupported', approvable: false, reasons: [s.reason ?? 'not composed yet'] }
        : { class: classOf(s), outcome: s.outcome, approvable: s.outcome === 'pass', bulletin_id: s.bulletin, screen: true, reasons: s.outcome === 'pass' ? [] : [s.reason ?? 'the headline overflows'] },
    )
    if (!options.noResult) await writeFile(join(source, 'generation.json'), JSON.stringify({ site, municipality: '13101', generated_at: '', verifier: 'browser', writer: 'live', composable: options.composable ?? composed.map(classOf), classes }))
    if (options.exit) await writeFile(join(source, 'exit'), options.exit)
    if (options.previewFails) await writeFile(join(source, 'preview-fail'), '')
    if (options.previewFailShapes) await writeFile(join(source, 'preview-fail-shapes'), JSON.stringify(options.previewFailShapes))
    if (options.chromeMode) await writeFile(join(source, 'chrome-mode'), options.chromeMode)
    if (options.grandchild) await writeFile(join(source, 'grandchild'), '')
    if (options.grandchild === 'stubborn') await writeFile(join(source, 'grandchild-stubborn'), '')
    if (options.pipeHolder) await writeFile(join(source, 'pipe-holder'), '')
    if (options.lateChrome) await writeFile(join(source, 'late-chrome'), '')
    if (options.exportFail) await writeFile(join(source, 'export-fail'), options.exportFail)
  }

  async function calls(): Promise<Record<string, any>[]> {
    return (await readFile(join(root, 'calls.log'), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line))
  }

  const hold = (name: string) => writeFile(join(root, 'hold', name), '')
  const release = (name: string) => rm(join(root, 'hold', name), { force: true })

  return { generate, preview, exporter, stage, calls, hold, release }
}
