import assert from 'node:assert/strict'
import { type ChildProcess, execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { type Server, createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { after, before, describe, test } from 'node:test'
import { promisify } from 'node:util'
import { layoutDigest } from '../layout/gate.ts'
import { guardedSiteWrite, siteLockCount, withSiteLock } from '../server/utils/siteLocks.ts'
import { APP_DIR, REPO_ROOT, SERVER_ENTRY, freePort, postJson, startServer } from './helpers.ts'

const OPERATOR_TOKEN = 'operator-token-for-guard-tests'
const TOKEN_A = 'facility-a-token-for-guard-tests'
const TOKEN_B = 'facility-b-token-for-guard-tests'
const SECRET = 'a-shared-secret-of-enough-length'
const PLACE = { lat: 35.68, lng: 139.76, facing_deg: 90 }
const SOLO_MUNI = '00031'
const TWIN_MUNI = '00032'
const EMPTY_MUNI = '00033'
const LEGACY_BULLETIN = 'TEST-LG-1'

const skip = !existsSync(SERVER_ENTRY) && 'run `pnpm -F app build` first'
const FIXTURE = JSON.parse(await readFile(join(APP_DIR, 'fixtures', 'wajima-tsunami.json'), 'utf8'))

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })
const sha256 = (token: string) => createHash('sha256').update(token).digest('hex')
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, label: string, timeoutMs = 10000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let value = await read()
  while (!done(value)) {
    if (Date.now() > deadline) assert.fail(`${label}: last saw ${JSON.stringify(value)}`)
    await sleep(50)
    value = await read()
  }
  return value
}

function screenBody(bulletin: string): string {
  return JSON.stringify({ ...FIXTURE, shape: '16x9', alert: { ...FIXTURE.alert, bulletin_id: bulletin } })
}

async function writeScreen(dataDir: string, site: string, municipality: string, bulletin: string): Promise<string> {
  const body = screenBody(bulletin)
  const digest = layoutDigest([{ shape: '16x9', body }])
  await mkdir(join(dataDir, 'layouts', site, bulletin), { recursive: true })
  await writeFile(join(dataDir, 'layouts', site, bulletin, '16x9.json'), body)
  await mkdir(join(dataDir, 'reports', site, bulletin), { recursive: true })
  await writeFile(join(dataDir, 'reports', site, bulletin, 'report.json'), JSON.stringify({ outcome: 'pass', verifier: 'browser', layout_digest: digest, attempts: [] }))
  const entries = [{ issued_at: '2026-11-02T10:00:00+09:00', bulletin_id: bulletin, wmo_code: 'VTSE41', raw_title: 'test', municipality_level: 3, screen: true }]
  await writeFile(join(dataDir, 'layouts', site, 'index.json'), JSON.stringify({ municipality, name: site, site, entries }))
  return digest
}

async function agentsApprovalView(dataDir: string): Promise<unknown> {
  const script = "import('./src/delivery/gate.ts').then((m) => console.log(JSON.stringify(m.readApprovals().layouts)))"
  const { stdout } = await promisify(execFile)('pnpm', ['-s', 'exec', 'tsx', '--eval', script], { cwd: join(REPO_ROOT, 'agents'), env: { ...process.env, EVAC_DATA_DIR: dataDir } })
  return JSON.parse(stdout)
}

async function observed(response: Response, askedFor: string) {
  return { status: response.status, body: (await response.text()).replaceAll(askedFor, '<asked>') }
}

describe('site locks', () => {
  test('a write whose site was deleted and registered again by another facility while it prepared does not happen', async () => {
    const owners = new Map([['shared-id', 'alpha']])
    const writes: string[] = []
    let release = () => {}
    const prepared = new Promise<void>((resolve) => (release = resolve))
    const pending = guardedSiteWrite('shared-id', {
      visible: async () => owners.get('shared-id') === 'alpha',
      prepare: () => prepared,
      write: async () => writes.push('alpha'),
    })
    await sleep(10)
    await withSiteLock('shared-id', async () => {
      owners.delete('shared-id')
      owners.set('shared-id', 'beta')
    })
    release()
    assert.equal(await pending, undefined)
    assert.deepEqual(writes, [])

    const allowed = await guardedSiteWrite('shared-id', { visible: async () => true, write: async () => 'written' })
    assert.deepEqual(allowed, { value: 'written' })
  })

  test('a delete waits for a write that holds the lock', async () => {
    const order: string[] = []
    let release = () => {}
    const writing = guardedSiteWrite('held-id', {
      visible: async () => true,
      write: () => new Promise<void>((resolve) => (release = () => (order.push('write'), resolve()))),
    })
    await sleep(10)
    const deleting = withSiteLock('held-id', async () => order.push('delete'))
    await sleep(20)
    assert.deepEqual(order, [])
    release()
    await Promise.all([writing, deleting])
    assert.deepEqual(order, ['write', 'delete'])
  })

  test('the locks of ids nobody waits for any more are dropped', async () => {
    const before = siteLockCount()
    await Promise.allSettled(
      Array.from({ length: 200 }, (_, i) => withSiteLock(`gone-${i}`, async () => {
        if (i % 3 === 0) throw new Error('refused')
      })),
    )
    assert.equal(siteLockCount(), before)
  })
})

const SLOW_EXPORTER = `#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
const { values } = parseArgs({ options: { site: { type: 'string' }, bulletin: { type: 'string' }, out: { type: 'string' }, 'base-url': { type: 'string' } } })
appendFileSync(process.env.SLOW_EXPORT_CALLS, 'start ' + values.site + '\\n')
await new Promise((resolve) => setTimeout(resolve, 800))
const dir = join(values.out, values.site, values.bulletin)
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, '16x9.png'), 'old screen')
writeFileSync(join(dir, '16x9.html'), '<!doctype html>')
appendFileSync(process.env.SLOW_EXPORT_CALLS, 'done ' + values.site + '\\n')
`

describe('site registration under contention, on a server that holds facilities', { skip }, () => {
  let base = ''
  let child: ChildProcess | undefined
  let root = ''
  let dataDir = ''
  let distDir = ''
  let calls = ''
  const hookCalls: string[] = []
  let hookServer: Server | undefined
  let hook = ''
  let serverEnv: Record<string, string> = {}

  const put = (id: string, body: unknown, token: string) =>
    fetch(`${base}/api/admin/sites/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json', ...bearer(token) }, body: JSON.stringify(body) })
  const get = (path: string, token: string) => fetch(`${base}${path}`, { headers: bearer(token) })
  const del = (path: string, token: string) => fetch(`${base}${path}`, { method: 'DELETE', headers: bearer(token) })
  const siteFile = (id: string) => join(dataDir, 'sites', `${id}.json`)
  const approvalsFile = () => readFile(join(dataDir, 'approvals.json'), 'utf8').then((text) => JSON.parse(text))
  const placeIn = (municipality_id: string) => ({ ...PLACE, municipality_id })
  const stateOf = async (id: string) => (await get(`/api/admin/sites/${id}`, OPERATOR_TOKEN)).json()

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'evac-sites-guard-'))
    dataDir = join(root, 'data')
    distDir = join(root, 'dist')
    calls = join(root, 'export-calls.txt')
    await mkdir(join(dataDir, 'sites'), { recursive: true })
    await writeFile(join(dataDir, 'tokens.json'), JSON.stringify({
      version: '0.1',
      tokens: [
        { id: 'tok-a', label: 'alpha signage', facility_id: 'alpha-fac', sha256: sha256(TOKEN_A), created_at: '2026-11-01T00:00:00Z' },
        { id: 'tok-b', label: 'beta signage', facility_id: 'beta-fac', sha256: sha256(TOKEN_B), created_at: '2026-11-01T00:00:00Z' },
      ],
    }), { mode: 0o600 })
    for (const [id, municipality_id] of [['legacy-solo', SOLO_MUNI], ['twin-a', TWIN_MUNI], ['twin-b', TWIN_MUNI]]) {
      await writeFile(siteFile(id!), JSON.stringify({ id, municipality_id, ...PLACE }))
    }
    const legacyDigest = await writeScreen(dataDir, 'legacy-solo', SOLO_MUNI, LEGACY_BULLETIN)
    const at = '2026-11-01T00:00:00.000Z'
    const record = { approved: true, updated_at: at, digest: legacyDigest }
    await writeFile(join(dataDir, 'approvals.json'), JSON.stringify({
      version: '0.1',
      layouts: { [`${SOLO_MUNI}/${LEGACY_BULLETIN}`]: record, [`${TWIN_MUNI}/${LEGACY_BULLETIN}`]: record, [`${EMPTY_MUNI}/${LEGACY_BULLETIN}`]: record },
      sites: { 'legacy-solo': { auto_publish: true, updated_at: at } },
      classes: {},
    }))

    const exporter = join(root, 'slow-exporter.mjs')
    await writeFile(exporter, SLOW_EXPORTER)
    await chmod(exporter, 0o755)
    await writeFile(calls, '')

    const hookPort = await freePort()
    hookServer = createServer((req, res) => {
      hookCalls.push(req.headers['x-evaclayer-event'] as string)
      req.resume()
      res.statusCode = 500
      res.end()
    })
    await new Promise<void>((resolve) => hookServer!.listen(hookPort, '127.0.0.1', resolve))
    hook = `http://127.0.0.1:${hookPort}/hook`

    serverEnv = {
      NUXT_DATA_DIR: dataDir,
      NUXT_DIST_DIR: distDir,
      NUXT_ADMIN_TOKEN: OPERATOR_TOKEN,
      NUXT_WEBHOOK_ALLOW_PRIVATE: '1',
      NUXT_EXPORT_COMMAND: exporter,
      SLOW_EXPORT_CALLS: calls,
      NUXT_REVERSE_GEOCODER_URL: `http://127.0.0.1:${await freePort()}/unreachable`,
    }
    ;({ base, child } = await startServer(serverEnv))
  })
  after(async () => {
    child?.kill()
    await new Promise((resolve) => hookServer?.close(resolve))
    await rm(root, { recursive: true, force: true })
  })

  test('with facility tokens, old <municipality>/<bulletin> keys are neither rewritten at startup nor read, by the app or the agents', async () => {
    await sleep(500)
    const stored = await approvalsFile()
    assert.deepEqual(Object.keys(stored.layouts).sort(), [`${SOLO_MUNI}/${LEGACY_BULLETIN}`, `${TWIN_MUNI}/${LEGACY_BULLETIN}`, `${EMPTY_MUNI}/${LEGACY_BULLETIN}`].sort())
    assert.equal((await stateOf('legacy-solo')).classes[0].approved, false)
    assert.deepEqual(await agentsApprovalView(dataDir), {})
  })

  test('an old key of a municipality without sites does not approve the first site registered there', async () => {
    assert.equal((await put('empty-claim', placeIn(EMPTY_MUNI), TOKEN_A)).status, 201)
    await writeScreen(dataDir, 'empty-claim', EMPTY_MUNI, LEGACY_BULLETIN)
    const state = await stateOf('empty-claim')
    assert.equal(state.classes[0].bulletin_id, LEGACY_BULLETIN)
    assert.equal(state.classes[0].approved, false)
    assert.ok(`${EMPTY_MUNI}/${LEGACY_BULLETIN}` in (await approvalsFile()).layouts)
  })

  test('an old key of a two-site municipality does not pass to the site left after a delete, and stays in the file', async () => {
    await writeScreen(dataDir, 'twin-b', TWIN_MUNI, LEGACY_BULLETIN)
    assert.equal((await del('/api/admin/sites/twin-a', OPERATOR_TOKEN)).status, 204)
    assert.equal((await stateOf('twin-b')).classes[0].approved, false)
    assert.ok(`${TWIN_MUNI}/${LEGACY_BULLETIN}` in (await approvalsFile()).layouts)
  })

  test('old keys stay in the file through approvals and auto publish changes', async () => {
    assert.equal((await postJson(base, '/api/admin/site', { site_id: 'twin-b', auto_publish: true }, bearer(OPERATOR_TOKEN))).status, 200)
    assert.equal((await postJson(base, '/api/admin/approve', { site_id: 'legacy-solo', bulletin_id: LEGACY_BULLETIN, approved: true }, bearer(OPERATOR_TOKEN))).status, 200)
    const layouts = (await approvalsFile()).layouts
    for (const key of [`${TWIN_MUNI}/${LEGACY_BULLETIN}`, `${EMPTY_MUNI}/${LEGACY_BULLETIN}`]) assert.ok(key in layouts, key)
  })

  test('a restart does not hand old keys to sites registered or left alone since the last one', async () => {
    const before = (await approvalsFile()).layouts
    const exited = once(child!, 'exit')
    child!.kill()
    await exited
    ;({ base, child } = await startServer(serverEnv))
    await sleep(500)
    for (const id of ['empty-claim', 'twin-b']) assert.equal((await stateOf(id)).classes[0].approved, false, id)
    const layouts = (await approvalsFile()).layouts
    for (const key of [`${TWIN_MUNI}/${LEGACY_BULLETIN}`, `${EMPTY_MUNI}/${LEGACY_BULLETIN}`]) assert.deepEqual(layouts[key], before[key], key)
    assert.ok(!Object.keys(layouts).some((key) => /^(empty-claim|twin-b)\//.test(key)))
  })

  test('the municipality alias is refused on the public paths, without naming any site', async () => {
    for (const path of [
      `/api/replay?municipality=${TWIN_MUNI}`,
      `/api/replay?municipality=${SOLO_MUNI}`,
      `/api/live-layout?municipality=${SOLO_MUNI}&bulletin=${LEGACY_BULLETIN}&shape=16x9`,
    ]) {
      const response = await fetch(`${base}${path}`)
      assert.equal(response.status, 400, path)
      const text = await response.text()
      for (const id of ['legacy-solo', 'twin-a', 'twin-b', 'empty-claim']) assert.ok(!text.includes(id), `${path}: ${text}`)
    }
    assert.equal((await fetch(`${base}/api/live-layout?site=legacy-solo&bulletin=${LEGACY_BULLETIN}&shape=16x9`)).status, 200)
  })

  test('an id of five digits, the shape of an old approval key, cannot be registered; an existing one can be updated', async () => {
    const refused = await put('12345', placeIn(SOLO_MUNI), TOKEN_A)
    assert.equal(refused.status, 400)
    assert.equal((await refused.json()).data?.code, 'invalid-request')
    assert.equal(existsSync(siteFile('12345')), false)
    await writeFile(siteFile('54321'), JSON.stringify({ id: '54321', municipality_id: EMPTY_MUNI, ...PLACE }))
    assert.equal((await put('54321', { ...placeIn(EMPTY_MUNI), lat: 35.7 }, OPERATOR_TOKEN)).status, 200)
    await rm(siteFile('54321'))
  })

  test('two facilities creating one id at the same moment: one 201, one 409, and the file is the winner\'s', async () => {
    const [a, b] = await Promise.all([put('contested-hall', placeIn(SOLO_MUNI), TOKEN_A), put('contested-hall', placeIn(SOLO_MUNI), TOKEN_B)])
    assert.deepEqual([a.status, b.status].sort(), [201, 409])
    const winner = a.status === 201 ? 'alpha-fac' : 'beta-fac'
    assert.equal(JSON.parse(await readFile(siteFile('contested-hall'), 'utf8')).facility_id, winner)
  })

  test('an id that differs from an existing site only in case does not overwrite it', async () => {
    const stored = JSON.stringify({ id: 'Upper-Hall', municipality_id: SOLO_MUNI, ...PLACE, note: 'original' })
    await writeFile(join(dataDir, 'sites', 'Upper-Hall.json'), stored)
    try {
      for (const token of [TOKEN_A, OPERATOR_TOKEN]) {
        const response = await put('upper-hall', placeIn(SOLO_MUNI), token)
        assert.equal(response.status, 409, token)
        assert.equal((await response.json()).data?.code, 'site-id-taken')
      }
      assert.equal(await readFile(join(dataDir, 'sites', 'Upper-Hall.json'), 'utf8'), stored)
      assert.ok(!(await readdir(join(dataDir, 'sites'))).includes('upper-hall.json'))
    } finally {
      await rm(join(dataDir, 'sites', 'Upper-Hall.json'))
    }
  })

  test('after a delete and a new registration by another facility, the old facility reaches nothing of the new site', async () => {
    const id = 'reused-hall'
    assert.equal((await put(id, placeIn(SOLO_MUNI), TOKEN_A)).status, 201)
    await writeScreen(dataDir, id, SOLO_MUNI, 'TEST-RU-1')
    assert.equal((await del(`/api/admin/sites/${id}`, TOKEN_A)).status, 204)
    assert.equal((await put(id, placeIn(SOLO_MUNI), TOKEN_B)).status, 201)
    await writeScreen(dataDir, id, SOLO_MUNI, 'TEST-RU-1')

    assert.equal((await postJson(base, '/api/admin/approve', { site_id: id, bulletin_id: 'TEST-RU-1', approved: true }, bearer(TOKEN_A))).status, 404)
    assert.equal((await postJson(base, '/api/admin/subscriptions', { site_id: id, url: hook, secret: SECRET }, bearer(TOKEN_A))).status, 404)
    assert.equal((await postJson(base, '/api/admin/site', { site_id: id, auto_publish: true }, bearer(TOKEN_A))).status, 404)
    const approvals = await approvalsFile()
    assert.ok(!Object.keys(approvals.layouts).some((key) => key.startsWith(`${id}/`)))
    assert.equal(approvals.sites[id], undefined)
    const subscriptions = await readFile(join(dataDir, 'subscriptions.json'), 'utf8').then((t) => JSON.parse(t).subscriptions, () => [])
    assert.ok(!subscriptions.some((s: { site_id: string }) => s.site_id === id))
  })

  test('DELETE of another facility\'s site answers as DELETE of a missing one', async () => {
    assert.equal((await put('beta-only', placeIn(SOLO_MUNI), TOKEN_B)).status, 201)
    const missing = await observed(await del('/api/admin/sites/never-was', TOKEN_A), 'never-was')
    assert.equal(missing.status, 404)
    assert.deepEqual(await observed(await del('/api/admin/sites/beta-only', TOKEN_A), 'beta-only'), missing)
    assert.ok(existsSync(siteFile('beta-only')))
  })

  test('a change of municipality alone counts as a move', async () => {
    assert.equal((await put('muni-move', placeIn(SOLO_MUNI), TOKEN_A)).status, 201)
    const before = JSON.parse(await readFile(siteFile('muni-move'), 'utf8')).location_updated_at
    await sleep(5)
    assert.equal((await put('muni-move', placeIn(TWIN_MUNI), TOKEN_A)).status, 200)
    const after = JSON.parse(await readFile(siteFile('muni-move'), 'utf8'))
    assert.equal(after.municipality_id, TWIN_MUNI)
    assert.ok(Date.parse(after.location_updated_at) > Date.parse(before))
  })

  test('an export that finishes after its site was deleted and taken by another facility leaves nothing behind', async () => {
    const id = 'export-hall'
    assert.equal((await put(id, placeIn(SOLO_MUNI), TOKEN_A)).status, 201)
    await writeScreen(dataDir, id, SOLO_MUNI, 'TEST-EX-1')
    assert.equal((await postJson(base, '/api/admin/approve', { site_id: id, bulletin_id: 'TEST-EX-1', approved: true }, bearer(TOKEN_A))).status, 200)
    assert.equal((await postJson(base, '/api/admin/site', { site_id: id, auto_publish: true }, bearer(TOKEN_A))).status, 200)
    await until(() => readFile(calls, 'utf8'), (text) => text.includes(`start ${id}`), 'export started')

    assert.equal((await del(`/api/admin/sites/${id}`, TOKEN_A)).status, 204)
    assert.equal((await put(id, placeIn(SOLO_MUNI), TOKEN_B)).status, 201)
    await until(() => readFile(calls, 'utf8'), (text) => text.includes(`done ${id}`), 'export done')
    await sleep(300)
    assert.equal(existsSync(join(distDir, id)), false, 'no screens of the old site')
    assert.equal(existsSync(join(dataDir, 'live', `${id}.export.json`)), false, 'no export record of the old site')
  })

  test('a site deleted while its webhook is being retried gets no further attempts', async () => {
    const id = 'hook-hall'
    assert.equal((await put(id, placeIn(SOLO_MUNI), TOKEN_A)).status, 201)
    await writeScreen(dataDir, id, SOLO_MUNI, 'TEST-WH-1')
    assert.equal((await postJson(base, '/api/admin/approve', { site_id: id, bulletin_id: 'TEST-WH-1', approved: true }, bearer(TOKEN_A))).status, 200)
    assert.equal((await postJson(base, '/api/admin/site', { site_id: id, auto_publish: true }, bearer(TOKEN_A))).status, 200)
    assert.equal((await postJson(base, '/api/admin/subscriptions', { site_id: id, url: hook, secret: SECRET }, bearer(TOKEN_A))).status, 201)
    await sleep(1500)
    hookCalls.length = 0
    assert.equal((await postJson(base, '/api/admin/live', { site_id: id, bulletin_id: 'TEST-WH-1' }, bearer(OPERATOR_TOKEN))).status, 200)
    await until(async () => hookCalls.length, (n) => n >= 1, 'first delivery')
    assert.equal((await del(`/api/admin/sites/${id}`, TOKEN_A)).status, 204)
    const attempts = hookCalls.length
    await sleep(3500)
    assert.equal(hookCalls.length, attempts)
  })
})

describe('the audit log and lookups on a single-facility server', { skip }, () => {
  let base = ''
  let child: ChildProcess | undefined
  let root = ''
  let dataDir = ''
  const AUDIT_MAX_BYTES = 2000
  let agentsViewBefore: unknown

  const auditFiles = async () => (await readdir(dataDir)).filter((f) => f.startsWith('audit.jsonl')).sort()
  async function allAuditLines(): Promise<string[]> {
    const lines: string[] = []
    for (const file of await auditFiles()) lines.push(...(await readFile(join(dataDir, file), 'utf8')).split('\n').filter(Boolean))
    return lines
  }

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'evac-audit-'))
    dataDir = join(root, 'data')
    await mkdir(join(dataDir, 'sites'), { recursive: true })
    await writeFile(join(dataDir, 'sites', 'rot-site.json'), JSON.stringify({ id: 'rot-site', municipality_id: SOLO_MUNI, ...PLACE }))
    const digest = await writeScreen(dataDir, 'rot-site', SOLO_MUNI, 'TEST-RO-1')
    const record = { approved: true, updated_at: '2026-11-01T00:00:00.000Z', digest }
    await writeFile(join(dataDir, 'approvals.json'), JSON.stringify({ version: '0.1', layouts: { [`${SOLO_MUNI}/TEST-RO-1`]: record, [`${EMPTY_MUNI}/TEST-RO-1`]: record }, sites: {}, classes: {} }))
    agentsViewBefore = await agentsApprovalView(dataDir)
    ;({ base, child } = await startServer({ NUXT_DATA_DIR: dataDir, NUXT_DIST_DIR: join(root, 'dist'), NUXT_ADMIN_TOKEN: '', NUXT_AUDIT_MAX_BYTES: String(AUDIT_MAX_BYTES) }))
  })
  after(async () => {
    child?.kill()
    await rm(root, { recursive: true, force: true })
  })

  test('without facility tokens, old keys of a municipality with one site are rewritten at startup and the others stay', async () => {
    const read = () => readFile(join(dataDir, 'approvals.json'), 'utf8').then((text) => JSON.parse(text))
    const migrated = await until(read, (a) => 'rot-site/TEST-RO-1' in a.layouts, 'migration')
    assert.deepEqual(Object.keys(migrated.layouts).sort(), [`${EMPTY_MUNI}/TEST-RO-1`, 'rot-site/TEST-RO-1'])
    assert.deepEqual(await agentsApprovalView(dataDir), agentsViewBefore, 'the agents read the same approvals as before')
  })

  test('an actor name with line breaks still makes one line', async () => {
    const response = await fetch(`${base}/api/admin/sites/nl-missing`, { method: 'DELETE', headers: { 'x-evaclayer-actor-id': 'nl', 'x-evaclayer-actor-name': '%0Afake%0A{"status":200}' } })
    assert.equal(response.status, 404)
    const lines = await until(allAuditLines, (all) => all.some((l) => l.includes('nl-missing')), 'audit line')
    const mine = lines.filter((l) => l.includes('nl-missing'))
    assert.equal(mine.length, 1)
    assert.equal(JSON.parse(mine[0]!).actor.name, '\nfake\n{"status":200}')
    for (const line of lines) JSON.parse(line)
  })

  test('the audit log is rotated past its size limit and keeps five old files', async () => {
    for (let i = 0; i < 80; i++) assert.equal((await postJson(base, '/api/admin/site', { site_id: 'rot-site', auto_publish: i % 2 === 0, actor: { id: `rot-${i}` } })).status, 200)
    await until(allAuditLines, (all) => all.some((l) => l.includes('"rot-79"')), 'last line written')
    assert.deepEqual(await auditFiles(), ['audit.jsonl', 'audit.jsonl.1', 'audit.jsonl.2', 'audit.jsonl.3', 'audit.jsonl.4', 'audit.jsonl.5'])
    for (const file of await auditFiles()) {
      const size = (await readFile(join(dataDir, file))).length
      assert.ok(size <= AUDIT_MAX_BYTES + 400, `${file}: ${size}`)
    }
  })

  test('the municipality alias still works on a single-facility server', async () => {
    assert.equal((await fetch(`${base}/api/replay?municipality=${SOLO_MUNI}`)).status, 200)
    assert.notEqual((await fetch(`${base}/api/live-layout?municipality=${SOLO_MUNI}&bulletin=TEST-RO-1&shape=16x9`)).status, 400)
  })

  test('a token ledger that turns unreadable switches the lookup by place off', async () => {
    const byPlace = `${base}/api/feed?lat=${PLACE.lat}&lng=${PLACE.lng}`
    assert.equal((await fetch(byPlace)).status, 200)
    await writeFile(join(dataDir, 'tokens.json'), 'not json', { mode: 0o600 })
    const response = await fetch(byPlace)
    assert.equal(response.status, 404)
    assert.equal((await response.json()).data?.code, 'place-lookup-disabled')
  })
})
