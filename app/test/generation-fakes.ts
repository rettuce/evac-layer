import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { layoutDigest } from '../layout/gate.ts'
import { APP_DIR } from './helpers.ts'

const FIXTURE = JSON.parse(await readFile(join(APP_DIR, 'fixtures', 'wajima-tsunami.json'), 'utf8'))

// Stand-ins for `pnpm -F agents generate` and `pnpm -F agents preview`: they copy what a test staged under
// <root>/source/<site>/ into the data directory, and log their calls and environment under <root>.
const FAKE_GENERATE = `#!/usr/bin/env node
import { appendFileSync, cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
const { values } = parseArgs({ options: { site: { type: 'string' }, writer: { type: 'string' }, verifier: { type: 'string' }, 'base-url': { type: 'string' }, classes: { type: 'string' } } })
const root = process.env.FAKE_ROOT
const site = values.site
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
appendFileSync(join(root, 'calls.log'), JSON.stringify({ kind: 'generate', site, argv: process.argv.slice(2), at: Date.now() }) + '\\n')
writeFileSync(join(root, 'env-generate-' + site + '.json'), JSON.stringify(process.env))
writeFileSync(join(root, 'pid-' + site), String(process.pid))
while (existsSync(join(root, 'hold', site))) await sleep(20)
await sleep(Number(process.env.FAKE_DELAY_MS ?? 100))
const source = join(root, 'source', site)
const data = process.env.EVAC_DATA_DIR
for (const dir of ['layouts', 'reports']) if (existsSync(join(source, dir))) cpSync(join(source, dir), join(data, dir), { recursive: true })
if (existsSync(join(source, 'generation.json'))) {
  const generation = JSON.parse(readFileSync(join(source, 'generation.json'), 'utf8'))
  writeFileSync(join(data, 'layouts', site, 'generation.json'), JSON.stringify({ ...generation, generated_at: new Date().toISOString() }))
}
appendFileSync(join(root, 'calls.log'), JSON.stringify({ kind: 'generate-end', site, at: Date.now() }) + '\\n')
if (existsSync(join(source, 'exit'))) {
  console.log('composing '.repeat(400))
  console.error(readFileSync(join(source, 'exit'), 'utf8'))
  process.exit(1)
}
`

const FAKE_PREVIEW = `#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
const { values } = parseArgs({ options: { site: { type: 'string' }, bulletin: { type: 'string' }, out: { type: 'string' }, 'base-url': { type: 'string' } } })
const root = process.env.FAKE_ROOT
const { site, bulletin, out } = values
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
appendFileSync(join(root, 'calls.log'), JSON.stringify({ kind: 'preview', site, bulletin, argv: process.argv.slice(2), at: Date.now() }) + '\\n')
writeFileSync(join(root, 'env-preview-' + site + '.json'), JSON.stringify(process.env))
writeFileSync(join(root, 'pid-preview-' + site), String(process.pid))
while (existsSync(join(root, 'hold', site + '.preview'))) await sleep(20)
if (existsSync(join(root, 'source', site, 'preview-fail'))) {
  console.error('[preview stopped] no Chrome found')
  process.exit(3)
}
mkdirSync(out, { recursive: true })
for (const file of readdirSync(join(process.env.EVAC_DATA_DIR, 'layouts', site, bulletin))) {
  if (file.endsWith('.json')) writeFileSync(join(out, file.replace(/\\.json$/, '.png')), Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from(site + ' ' + bulletin)]))
}
`

export interface StagedClass {
  bulletin: string
  level: number
  outcome: 'pass' | 'fail'
  variant?: string
  shapes?: string[]
}

export function layoutBody(spec: StagedClass, shape: string): string {
  return JSON.stringify({ ...FIXTURE, shape, alert: { ...FIXTURE.alert, bulletin_id: spec.bulletin, issued_at: spec.variant ?? '2026-11-01T00:00:00+09:00', level: spec.level } })
}

export function stagedDigest(spec: StagedClass): string {
  return layoutDigest((spec.shapes ?? ['16x9', '1x1']).map((shape) => ({ shape, body: layoutBody(spec, shape) })))
}

export function classOf(spec: StagedClass): string {
  return `${FIXTURE.alert.hazard}/${FIXTURE.template}/${spec.level}`
}

export async function makeFakes(root: string) {
  const generate = join(root, 'fake-generate.mjs')
  const preview = join(root, 'fake-preview.mjs')
  await writeFile(generate, FAKE_GENERATE)
  await writeFile(preview, FAKE_PREVIEW)
  await chmod(generate, 0o755)
  await chmod(preview, 0o755)
  await mkdir(join(root, 'hold'), { recursive: true })
  await writeFile(join(root, 'calls.log'), '')

  async function stage(site: string, specs: StagedClass[], options: { exit?: string; previewFails?: boolean } = {}) {
    const source = join(root, 'source', site)
    await rm(source, { recursive: true, force: true })
    for (const spec of specs) {
      const layouts = join(source, 'layouts', site, spec.bulletin)
      await mkdir(layouts, { recursive: true })
      for (const shape of spec.shapes ?? ['16x9', '1x1']) await writeFile(join(layouts, `${shape}.json`), layoutBody(spec, shape))
      const reports = join(source, 'reports', site, spec.bulletin)
      await mkdir(reports, { recursive: true })
      await writeFile(join(reports, 'report.json'), JSON.stringify({ outcome: spec.outcome, verifier: 'browser', layout_digest: stagedDigest(spec), attempts: [] }))
    }
    const entries = specs.map((s) => ({ issued_at: '2026-11-01T00:00:00+09:00', bulletin_id: s.bulletin, wmo_code: 'VTSE41', raw_title: 'test', municipality_level: s.level, screen: true }))
    await mkdir(join(source, 'layouts', site), { recursive: true })
    await writeFile(join(source, 'layouts', site, 'index.json'), JSON.stringify({ municipality: '13101', name: site, site, entries }))
    const classes = specs.map((s) => ({ class: classOf(s), outcome: s.outcome, approvable: s.outcome === 'pass', bulletin_id: s.bulletin, screen: true, reasons: s.outcome === 'pass' ? [] : ['the headline overflows'] }))
    await writeFile(join(source, 'generation.json'), JSON.stringify({ site, municipality: '13101', generated_at: '', verifier: 'browser', writer: 'live', classes }))
    if (options.exit) await writeFile(join(source, 'exit'), options.exit)
    if (options.previewFails) await writeFile(join(source, 'preview-fail'), '')
  }

  async function calls(): Promise<Record<string, any>[]> {
    return (await readFile(join(root, 'calls.log'), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line))
  }

  const hold = (name: string) => writeFile(join(root, 'hold', name), '')
  const release = (name: string) => rm(join(root, 'hold', name), { force: true })

  return { generate, preview, stage, calls, hold, release }
}
