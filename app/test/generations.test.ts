import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { SERVER_ENTRY, postJson, startServer } from './helpers.ts'
import { type StagedClass, classOf, makeFakes, stagedDigest } from './generation-fakes.ts'

const OPERATOR_TOKEN = 'operator-token-for-generation-tests'
const TOKEN_A = 'facility-a-token-for-generation-tests'
const TOKEN_B = 'facility-b-token-for-generation-tests'
const TOKEN_C = 'facility-c-token-for-generation-tests'
const ALL_TOKENS = [OPERATOR_TOKEN, TOKEN_A, TOKEN_B, TOKEN_C]
const PREPARED = '13101'
const NOT_PREPARED = '13102'
const WAIT_MS = 15000

const skip = !existsSync(SERVER_ENTRY) && 'run `pnpm -F app build` first'
const sha256 = (token: string) => createHash('sha256').update(token).digest('hex')
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

async function appears(file: string): Promise<void> {
  const deadline = Date.now() + WAIT_MS
  while (!existsSync(file)) {
    if (Date.now() > deadline) assert.fail(`${file} never appeared`)
    await sleep(20)
  }
}

const TOKENS_FILE = {
  version: '0.1',
  tokens: [
    { id: 'tok-a', label: 'alpha signage', facility_id: 'alpha-fac', sha256: sha256(TOKEN_A), created_at: '2026-11-01T00:00:00Z' },
    { id: 'tok-b', label: 'beta signage', facility_id: 'beta-fac', sha256: sha256(TOKEN_B), created_at: '2026-11-01T00:00:00Z' },
    { id: 'tok-c', label: 'gamma signage', facility_id: 'gamma-fac', sha256: sha256(TOKEN_C), created_at: '2026-11-01T00:00:00Z' },
  ],
}

const SYN_PASS: StagedClass = { bulletin: 'SYN-VTSE41-202611010000-0000000000a1', level: 3, outcome: 'pass' }
const SYN_FAIL: StagedClass = { bulletin: 'SYN-VTSE41-202611010000-0000000000a2', level: 4, outcome: 'fail' }
const REAL_PASS: StagedClass = { bulletin: 'VTSE41-202611010000-0000000000a3', level: 5, outcome: 'pass' }

async function makeData() {
  const root = await mkdtemp(join(tmpdir(), 'evac-generations-'))
  const dataDir = join(root, 'data')
  const distDir = join(root, 'dist')
  await mkdir(join(dataDir, 'sites'), { recursive: true })
  await mkdir(join(dataDir, 'municipalities'), { recursive: true })
  await writeFile(join(dataDir, 'municipalities', `${PREPARED}.json`), '{}')
  await writeFile(join(dataDir, 'tokens.json'), JSON.stringify(TOKENS_FILE), { mode: 0o600 })
  const fakes = await makeFakes(root)
  const writeSite = (id: string, facility?: string, municipality = PREPARED, located = '2026-11-01T00:00:00.000Z') =>
    writeFile(join(dataDir, 'sites', `${id}.json`), JSON.stringify({ id, municipality_id: municipality, lat: 35.68, lng: 139.76, facing_deg: 90, ...(facility ? { facility_id: facility } : {}), location_updated_at: located }))
  const env = { NUXT_DATA_DIR: dataDir, NUXT_DIST_DIR: distDir, NUXT_ADMIN_TOKEN: OPERATOR_TOKEN, NUXT_GENERATE_COMMAND: fakes.generate, NUXT_PREVIEW_COMMAND: fakes.preview, FAKE_ROOT: root }
  return { root, dataDir, distDir, fakes, writeSite, env }
}

function client(baseOf: () => string) {
  const start = (site: string, token: string, body: unknown = {}) => postJson(baseOf(), `/api/admin/sites/${site}/generations`, body, bearer(token))
  const get = (path: string, token: string) => fetch(`${baseOf()}${path}`, { headers: bearer(token) })
  async function job(site: string, id: string, token: string, until: (status: string) => boolean = (s) => s === 'done' || s === 'failed') {
    const deadline = Date.now() + WAIT_MS
    let last: any
    while (Date.now() < deadline) {
      const response = await get(`/api/admin/sites/${site}/generations/${id}`, token)
      assert.equal(response.status, 200)
      last = await response.json()
      if (until(last.status)) return last
      await sleep(50)
    }
    assert.fail(`job ${id} of ${site} stayed ${JSON.stringify(last)}`)
  }
  async function run(site: string, token: string): Promise<any> {
    const response = await start(site, token)
    assert.equal(response.status, 202, await response.clone().text())
    return job(site, (await response.json()).generation_id, token)
  }
  async function state(site: string, token = OPERATOR_TOKEN) {
    const response = await get(`/api/admin/sites/${site}`, token)
    assert.equal(response.status, 200)
    return response.json()
  }
  return { start, get, job, run, state }
}

describe('generation jobs over HTTP', { skip }, () => {
  let base = ''
  let child: ChildProcess | undefined
  let data: Awaited<ReturnType<typeof makeData>>
  const api = client(() => base)
  const previewPath = (site: string, bulletin: string, shape: string) => `/api/admin/sites/${site}/previews/${bulletin}/${shape}.png`

  before(async () => {
    data = await makeData()
    for (const id of ['alpha-one', 'alpha-two', 'alpha-fresh', 'alpha-fail', 'alpha-nopng', 'del-running', 'del-queued', 'del-done', 'del-reborn']) await data.writeSite(id, 'alpha-fac')
    await data.writeSite('alpha-cold', 'alpha-fac', NOT_PREPARED)
    await data.writeSite('beta-one', 'beta-fac')
    await data.writeSite('op-site')
    ;({ base, child } = await startServer({ ...data.env, NUXT_GENERATIONS_PER_HOUR: '1000' }))
  })
  after(async () => {
    child?.kill()
    await rm(join(data.root, 'hold'), { recursive: true, force: true })
    await sleep(300)
    await rm(data.root, { recursive: true, force: true })
  })

  test('a job answers 202 with its Location, runs, and ends done with the classes the agents wrote', async () => {
    await data.fakes.stage('alpha-one', [SYN_PASS, SYN_FAIL, REAL_PASS])
    await data.fakes.hold('alpha-one')
    const response = await api.start('alpha-one', TOKEN_A, { actor: { id: 'u-1', name: 'Ito' } })
    assert.equal(response.status, 202)
    const queued = await response.json()
    assert.match(queued.generation_id, /^[a-z0-9]{8,32}$/)
    assert.equal(response.headers.get('location'), `/api/admin/sites/alpha-one/generations/${queued.generation_id}`)
    assert.deepEqual({ ...queued, created_at: undefined }, { generation_id: queued.generation_id, site_id: 'alpha-one', status: 'queued', created_at: undefined, classes: [], started_by: { token_label: 'alpha signage', actor: { id: 'u-1', name: 'Ito' } } })
    assert.ok(!Number.isNaN(Date.parse(queued.created_at)))
    await api.job('alpha-one', queued.generation_id, TOKEN_A, (s) => s === 'running')
    await data.fakes.release('alpha-one')
    const done = await api.job('alpha-one', queued.generation_id, TOKEN_A)
    assert.equal(done.status, 'done')
    assert.ok(done.finished_at)
    assert.deepEqual(done.classes.map(({ preview_error, ...c }: any) => c), [
      { class: classOf(SYN_PASS), bulletin_id: SYN_PASS.bulletin, synthetic: true, outcome: 'pass' },
      { class: classOf(SYN_FAIL), bulletin_id: SYN_FAIL.bulletin, synthetic: true, outcome: 'fail', reason: 'the headline overflows' },
      { class: classOf(REAL_PASS), bulletin_id: REAL_PASS.bulletin, synthetic: false, outcome: 'pass' },
    ])
    const generate = (await data.fakes.calls()).find((c) => c.kind === 'generate' && c.site === 'alpha-one')!
    assert.deepEqual(generate.argv, ['--site=alpha-one', '--writer=live', '--verifier=browser', `--base-url=${base}`])
  })

  test('the start of a job is one line of the audit log', async () => {
    const lines = (await readFile(join(data.dataDir, 'audit.jsonl'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l))
    const starts = lines.filter((l) => l.method === 'POST' && l.path === '/api/admin/sites/alpha-one/generations')
    assert.equal(starts.length, 1)
    assert.deepEqual({ ...starts[0], at: undefined }, { at: undefined, method: 'POST', path: '/api/admin/sites/alpha-one/generations', site_id: 'alpha-one', principal: { kind: 'facility', facility_id: 'alpha-fac', label: 'alpha signage' }, actor: { id: 'u-1', name: 'Ito' }, status: 202 })
  })

  test('the site state carries the last job and, per class, synthetic, previews and unchanged', async () => {
    const state = await api.state('alpha-one', TOKEN_A)
    const id = state.last_generation.generation_id
    assert.deepEqual(state.last_generation, await (await api.get(`/api/admin/sites/alpha-one/generations/${id}`, TOKEN_A)).json())
    const byClass = Object.fromEntries(state.classes.map((c: any) => [c.class, c]))
    const shapes = (spec: StagedClass) => ({ '16x9': previewPath('alpha-one', spec.bulletin, '16x9'), '1x1': previewPath('alpha-one', spec.bulletin, '1x1') })
    assert.deepEqual(byClass[classOf(SYN_PASS)].previews, shapes(SYN_PASS))
    assert.deepEqual(byClass[classOf(REAL_PASS)].previews, shapes(REAL_PASS), 'an unapproved real bulletin has previews too')
    assert.deepEqual(byClass[classOf(SYN_FAIL)].previews, {})
    assert.equal(byClass[classOf(SYN_PASS)].synthetic, true)
    assert.equal(byClass[classOf(REAL_PASS)].synthetic, false)
    for (const c of state.classes) assert.equal(c.unchanged, false, 'the first job found no screens to compare with')
    assert.equal(state.needs_generation, false)
  })

  test('a preview answers its own facility with the layout digest as ETag and is reachable nowhere else', async () => {
    const own = await api.get(previewPath('alpha-one', SYN_PASS.bulletin, '16x9'), TOKEN_A)
    assert.equal(own.status, 200)
    assert.equal(own.headers.get('content-type'), 'image/png')
    assert.equal(own.headers.get('etag'), `"${stagedDigest(SYN_PASS)}"`)
    assert.equal(own.headers.get('cache-control'), 'no-store')
    assert.equal(Buffer.from(await own.arrayBuffer()).subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    assert.equal((await api.get(previewPath('alpha-one', REAL_PASS.bulletin, '1x1'), OPERATOR_TOKEN)).status, 200)
    for (const [path, token] of [
      [previewPath('alpha-one', SYN_PASS.bulletin, '16x9'), TOKEN_B],
      [previewPath('alpha-one', SYN_PASS.bulletin, '9x16'), TOKEN_A],
      [previewPath('alpha-one', SYN_FAIL.bulletin, '16x9'), TOKEN_A],
      [`/api/admin/sites/alpha-one/previews/${SYN_PASS.bulletin}/16x9.jpg`, TOKEN_A],
      [`/api/admin/sites/alpha-one/previews/${SYN_PASS.bulletin}/x.png`, TOKEN_A],
    ] as const) assert.equal((await api.get(path, token)).status, 404, `${path} ${token}`)
    for (const call of (await data.fakes.calls()).filter((c) => c.kind === 'preview')) {
      const out = call.argv.find((a: string) => a.startsWith('--out='))!.slice('--out='.length)
      assert.ok(out.startsWith(join(data.dataDir, 'previews', call.site) + '/'), out)
    }
    assert.ok(!existsSync(data.distDir) || !(await readdir(data.distDir, { recursive: true })).some((f) => String(f).endsWith('.png')))
    for (const spec of [SYN_PASS, REAL_PASS]) assert.equal((await fetch(`${base}/delivery/alpha-one/${spec.bulletin}/16x9.png`)).status, 404)
    assert.equal((await fetch(`${base}${previewPath('alpha-one', SYN_PASS.bulletin, '16x9')}`)).status, 401)
  })

  test('the same screens again are unchanged; a class whose screens changed is not', async () => {
    const previewsBefore = (await data.fakes.calls()).filter((c) => c.kind === 'preview').length
    await api.run('alpha-one', TOKEN_A)
    let state = await api.state('alpha-one')
    for (const c of state.classes) assert.equal(c.unchanged, true, c.class)
    assert.equal((await data.fakes.calls()).filter((c) => c.kind === 'preview').length, previewsBefore, 'previews of the same screens are kept')
    const changed = { ...SYN_PASS, variant: '2026-11-02T00:00:00+09:00' }
    await data.fakes.stage('alpha-one', [changed, SYN_FAIL, REAL_PASS])
    await api.run('alpha-one', TOKEN_A)
    state = await api.state('alpha-one')
    const unchanged = Object.fromEntries(state.classes.map((c: any) => [c.class, c.unchanged]))
    assert.deepEqual(unchanged, { [classOf(SYN_PASS)]: false, [classOf(SYN_FAIL)]: true, [classOf(REAL_PASS)]: true })
    const preview = await api.get(previewPath('alpha-one', SYN_PASS.bulletin, '16x9'), TOKEN_A)
    assert.equal(preview.headers.get('etag'), `"${stagedDigest(changed)}"`)
  })

  test('needs_generation: no screens, a move after the last successful job, or no successful job and a move after the screens', async () => {
    assert.equal((await api.state('alpha-two')).needs_generation, true, 'no screens')
    const siteFile = join(data.dataDir, 'sites', 'alpha-one.json')
    const site = JSON.parse(await readFile(siteFile, 'utf8'))
    await writeFile(siteFile, JSON.stringify({ ...site, location_updated_at: new Date().toISOString() }))
    const future = new Date(Date.now() + 3600_000)
    await utimes(join(data.dataDir, 'layouts', 'alpha-one', 'index.json'), future, future)
    assert.equal((await api.state('alpha-one')).needs_generation, true, 'moved after the last successful job, whatever the index time says')
    await data.fakes.stage('alpha-fresh', [SYN_PASS], { exit: '[generate stopped] the Writer did not answer' })
    assert.equal((await api.run('alpha-fresh', TOKEN_A)).status, 'failed')
    assert.equal((await api.state('alpha-fresh')).needs_generation, false, 'screens written after the move, no successful job')
    await data.writeSite('alpha-fresh', 'alpha-fac', PREPARED, new Date(Date.now() + 1000).toISOString())
    assert.equal((await api.state('alpha-fresh')).needs_generation, true, 'moved after the screens, no successful job')
    await sleep(1100)
    await data.fakes.stage('alpha-fresh', [SYN_PASS])
    assert.equal((await api.run('alpha-fresh', TOKEN_A)).status, 'done')
    assert.equal((await api.state('alpha-fresh')).needs_generation, false)
  })

  test('a site with a job queued or running answers 409 with its id; jobs of different sites run one at a time', async () => {
    await data.fakes.stage('alpha-two', [SYN_PASS])
    await data.fakes.stage('beta-one', [SYN_PASS])
    await data.fakes.hold('alpha-two')
    const first = await (await api.start('alpha-two', TOKEN_A)).json()
    const again = await api.start('alpha-two', TOKEN_A)
    assert.equal(again.status, 409)
    const problem = await again.json()
    assert.equal(problem.data.code, 'generation-running')
    assert.equal(problem.data.generation_id, first.generation_id)
    const other = await api.start('beta-one', TOKEN_B)
    assert.equal(other.status, 202)
    const otherId = (await other.json()).generation_id
    await api.job('alpha-two', first.generation_id, TOKEN_A, (s) => s === 'running')
    await sleep(300)
    assert.equal((await (await api.get(`/api/admin/sites/beta-one/generations/${otherId}`, TOKEN_B)).json()).status, 'queued')
    await data.fakes.release('alpha-two')
    assert.equal((await api.job('beta-one', otherId, TOKEN_B)).status, 'done')
    let open: string | undefined
    for (const call of await data.fakes.calls()) {
      if (call.kind === 'generate') {
        assert.equal(open, undefined, `${call.site} started while ${open} was running`)
        open = call.site
      }
      if (call.kind === 'generate-end') open = undefined
    }
  })

  test('a municipality that is not prepared answers 409', async () => {
    const response = await api.start('alpha-cold', TOKEN_A)
    assert.equal(response.status, 409)
    assert.equal((await response.json()).data.code, 'municipality-not-prepared')
  })

  test('a body with anything but actor answers 400', async () => {
    const response = await api.start('alpha-two', TOKEN_A, { classes: ['x'] })
    assert.equal(response.status, 400)
  })

  test('a command that exits non-zero ends the job failed with the end of its output', async () => {
    await data.fakes.stage('alpha-fail', [SYN_PASS, SYN_FAIL], { exit: '[generate stopped] the Writer did not answer' })
    const failed = await api.run('alpha-fail', TOKEN_A)
    assert.equal(failed.status, 'failed')
    assert.match(failed.error, /the Writer did not answer/)
    assert.ok(failed.error.length <= 2000)
    assert.deepEqual(failed.classes.map((c: any) => c.outcome), ['pass', 'fail'])
  })

  test('a preview that cannot be rendered leaves the job done and says why', async () => {
    await data.fakes.stage('alpha-nopng', [SYN_PASS], { previewFails: true })
    const done = await api.run('alpha-nopng', TOKEN_A)
    assert.equal(done.status, 'done')
    assert.match(done.classes[0].preview_error, /no Chrome found/)
    assert.deepEqual((await api.state('alpha-nopng')).classes[0].previews, {})
  })

  test('another facility\'s site and a missing site answer the three paths alike; the operator passes', async () => {
    const id = (await api.state('alpha-one')).last_generation.generation_id
    const paths = (site: string) => [
      ['POST', `/api/admin/sites/${site}/generations`],
      ['GET', `/api/admin/sites/${site}/generations/${id}`],
      ['GET', previewPath(site, SYN_PASS.bulletin, '16x9')],
    ]
    const ask = async ([method, path]: string[], token: string, site: string) => {
      const response = method === 'POST' ? await postJson(base, path!, {}, bearer(token)) : await api.get(path!, token)
      return { status: response.status, body: (await response.text()).replaceAll(site, '<site>') }
    }
    for (const [i, path] of paths('alpha-one').entries()) {
      const other = await ask(path, TOKEN_B, 'alpha-one')
      assert.equal(other.status, 404, path.join(' '))
      assert.deepEqual(other, await ask(paths('no-such-site')[i]!, TOKEN_B, 'no-such-site'))
    }
    assert.equal((await ask(paths('op-site')[0]!, TOKEN_A, 'op-site')).status, 404)
    assert.equal((await api.get(`/api/admin/sites/alpha-one/generations/${id}`, OPERATOR_TOKEN)).status, 200)
    await data.fakes.stage('op-site', [SYN_PASS])
    assert.equal((await api.run('op-site', OPERATOR_TOKEN)).started_by.token_label, 'operator')
  })

  test('no credential reaches the children, and none shows in records, answers or the audit log', async () => {
    for (const file of (await readdir(data.root)).filter((f) => f.startsWith('env-'))) {
      const env = JSON.parse(await readFile(join(data.root, file), 'utf8'))
      assert.equal(env.NUXT_ADMIN_TOKEN, undefined, file)
      for (const token of ALL_TOKENS) assert.ok(!JSON.stringify(env).includes(token), file)
    }
    const preview = `/api/admin/preview-layout?${new URLSearchParams({ site: 'alpha-one', bulletin: SYN_PASS.bulletin, shape: '16x9' })}`
    assert.equal((await fetch(`${base}${preview}`)).status, 401)
    const texts = [
      ...(await Promise.all((await readdir(join(data.dataDir, 'live'))).map((f) => readFile(join(data.dataDir, 'live', f), 'utf8')))),
      await readFile(join(data.dataDir, 'audit.jsonl'), 'utf8'),
      JSON.stringify(await api.state('alpha-one')),
    ]
    for (const text of texts) for (const token of ALL_TOKENS) assert.ok(!text.includes(token))
  })

  test('DELETE: a queued job never runs, a running one is stopped, and the job record goes', async () => {
    await data.fakes.stage('del-running', [SYN_PASS])
    await data.fakes.stage('del-queued', [SYN_PASS])
    await data.fakes.hold('del-running')
    const running = (await (await api.start('del-running', TOKEN_A)).json()).generation_id
    assert.equal((await api.start('del-queued', TOKEN_A)).status, 202)
    await api.job('del-running', running, TOKEN_A, (s) => s === 'running')
    await appears(join(data.root, 'pid-del-running'))
    const pid = Number(await readFile(join(data.root, 'pid-del-running'), 'utf8'))
    assert.equal((await fetch(`${base}/api/admin/sites/del-queued`, { method: 'DELETE', headers: bearer(TOKEN_A) })).status, 204)
    assert.equal((await fetch(`${base}/api/admin/sites/del-running`, { method: 'DELETE', headers: bearer(TOKEN_A) })).status, 204)
    assert.throws(() => process.kill(pid, 0), 'the generate process is gone when DELETE answers')
    await data.fakes.release('del-running')
    await sleep(500)
    assert.ok(!(await data.fakes.calls()).some((c) => c.site === 'del-queued'))
    for (const site of ['del-running', 'del-queued']) assert.ok(!existsSync(join(data.dataDir, 'live', `${site}.generation.json`)), site)
  })

  test('DELETE removes the job record and the previews of a finished job', async () => {
    await data.fakes.stage('del-done', [SYN_PASS])
    await api.run('del-done', TOKEN_A)
    assert.ok(existsSync(join(data.dataDir, 'previews', 'del-done')))
    assert.equal((await fetch(`${base}/api/admin/sites/del-done`, { method: 'DELETE', headers: bearer(TOKEN_A) })).status, 204)
    assert.ok(!existsSync(join(data.dataDir, 'previews', 'del-done')))
    assert.ok(!existsSync(join(data.dataDir, 'live', 'del-done.generation.json')))
  })

  test('a site deleted while its previews render and taken by another facility gets nothing of the old job', async () => {
    await data.fakes.stage('del-reborn', [SYN_PASS])
    await data.fakes.hold('del-reborn.preview')
    const id = (await (await api.start('del-reborn', TOKEN_A)).json()).generation_id
    await appears(join(data.root, 'pid-preview-del-reborn'))
    assert.equal((await fetch(`${base}/api/admin/sites/del-reborn`, { method: 'DELETE', headers: bearer(TOKEN_A) })).status, 204)
    await data.writeSite('del-reborn', 'beta-fac')
    await data.fakes.release('del-reborn.preview')
    await sleep(500)
    const state = await api.state('del-reborn', TOKEN_B)
    assert.equal(state.last_generation, undefined)
    assert.deepEqual(state.classes, [])
    assert.ok(!existsSync(join(data.dataDir, 'previews', 'del-reborn')))
    assert.equal((await api.get(`/api/admin/sites/del-reborn/generations/${id}`, TOKEN_B)).status, 404)
  })
})

describe('generation limits and restarts', { skip }, () => {
  let base = ''
  let child: ChildProcess | undefined
  let data: Awaited<ReturnType<typeof makeData>>
  const api = client(() => base)

  before(async () => {
    data = await makeData()
    for (let n = 1; n <= 7; n++) {
      await data.writeSite(`gamma-${n}`, 'gamma-fac')
      await data.fakes.stage(`gamma-${n}`, [SYN_PASS])
    }
    ;({ base, child } = await startServer(data.env))
  })
  after(async () => {
    child?.kill()
    await rm(join(data.root, 'hold'), { recursive: true, force: true })
    await sleep(300)
    await rm(data.root, { recursive: true, force: true })
  })

  test('a facility may start six jobs an hour over all its sites; the operator is counted per site', async () => {
    const ids: [string, string][] = []
    for (let n = 1; n <= 6; n++) {
      const response = await api.start(`gamma-${n}`, TOKEN_C)
      assert.equal(response.status, 202)
      ids.push([`gamma-${n}`, (await response.json()).generation_id])
    }
    const limited = await api.start('gamma-7', TOKEN_C)
    assert.equal(limited.status, 429)
    assert.equal((await limited.json()).data.code, 'generation-rate-limited')
    const retry = Number(limited.headers.get('retry-after'))
    assert.ok(Number.isInteger(retry) && retry > 0 && retry <= 3600, String(retry))
    for (const [site, id] of ids) assert.equal((await api.job(site, id, TOKEN_C)).status, 'done')
    assert.equal((await api.run('gamma-7', OPERATOR_TOKEN)).status, 'done')
  })

  test('a job running when the server stops reads as failed after the restart', async () => {
    await data.fakes.hold('gamma-1')
    const id = (await (await api.start('gamma-1', OPERATOR_TOKEN)).json()).generation_id
    await api.job('gamma-1', id, OPERATOR_TOKEN, (s) => s === 'running')
    const stopped = new Promise((resolve) => child!.once('exit', resolve))
    child!.kill()
    await stopped
    ;({ base, child } = await startServer({ ...data.env, NUXT_GENERATE_COMMAND: 'off' }))
    const job = await (await api.get(`/api/admin/sites/gamma-1/generations/${id}`, OPERATOR_TOKEN)).json()
    assert.equal(job.status, 'failed')
    assert.equal(job.error, 'server restarted')
    assert.equal((await api.state('gamma-1')).last_generation.status, 'failed')
    await data.fakes.release('gamma-1')
  })

  test('with the command off, a start answers generation-disabled', async () => {
    const response = await api.start('gamma-2', OPERATOR_TOKEN)
    assert.equal(response.status, 503)
    assert.equal((await response.json()).data.code, 'generation-disabled')
  })
})
