import assert from 'node:assert/strict'
import { type ChildProcess, execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { type Server, createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { promisify } from 'node:util'
import { layoutDigest } from '../layout/gate.ts'
import { APP_DIR, REPO_ROOT, SERVER_ENTRY, freePort, postJson, startServer } from './helpers.ts'

const OPERATOR_TOKEN = 'operator-token-for-site-tests'
const TOKEN_A = 'facility-a-token-for-site-tests'
const TOKEN_B = 'facility-b-token-for-site-tests'
const FACILITY_A = 'alpha-fac'
const FACILITY_B = 'beta-fac'
const GSI_CODE = '13101'
const OTHER_CODE = '13102'
const SECRET = 'a-shared-secret-of-enough-length'
const PLACE = { lat: 35.68, lng: 139.76, facing_deg: 90 }

const skip = !existsSync(SERVER_ENTRY) && 'run `pnpm -F app build` first'
const FIXTURE = JSON.parse(await readFile(join(APP_DIR, 'fixtures', 'wajima-tsunami.json'), 'utf8'))

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })
const sha256 = (token: string) => createHash('sha256').update(token).digest('hex')
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const TOKENS_FILE = {
  version: '0.1',
  tokens: [
    { id: 'tok-a', label: 'alpha signage', facility_id: FACILITY_A, sha256: sha256(TOKEN_A), created_at: '2026-11-01T00:00:00Z' },
    { id: 'tok-b', label: 'beta signage', facility_id: FACILITY_B, sha256: sha256(TOKEN_B), created_at: '2026-11-01T00:00:00Z' },
  ],
}

interface ScreenSpec {
  bulletin: string
  issued_at: string
  level: number
  outcome?: 'pass' | 'fail'
}

function screenBody(spec: ScreenSpec): string {
  return JSON.stringify({ ...FIXTURE, shape: '16x9', alert: { ...FIXTURE.alert, bulletin_id: spec.bulletin, issued_at: spec.issued_at, level: spec.level } })
}

async function writeScreens(dataDir: string, site: string, municipality: string, specs: ScreenSpec[]) {
  for (const spec of specs) {
    const dir = join(dataDir, 'layouts', site, spec.bulletin)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, '16x9.json'), screenBody(spec))
    if (spec.outcome) {
      const reportDir = join(dataDir, 'reports', site, spec.bulletin)
      await mkdir(reportDir, { recursive: true })
      const report = { outcome: spec.outcome, verifier: 'browser', layout_digest: layoutDigest([{ shape: '16x9', body: screenBody(spec) }]), attempts: [] }
      await writeFile(join(reportDir, 'report.json'), JSON.stringify(report))
    }
  }
  const entries = specs.map((s) => ({ issued_at: s.issued_at, bulletin_id: s.bulletin, wmo_code: 'VTSE41', raw_title: 'test', municipality_level: s.level, screen: true }))
  await writeFile(join(dataDir, 'layouts', site, 'index.json'), JSON.stringify({ municipality, name: site, site, entries }))
}

async function validateWithAgents(file: string): Promise<string> {
  const { stdout } = await promisify(execFile)('pnpm', ['-s', '-F', 'agents', 'validate', file], { cwd: REPO_ROOT })
  return stdout
}

// A stand-in for the GSI reverse geocoder: answers GSI_CODE unless a place is mapped to another code.
function fakeGeocoder() {
  const codes = new Map<string, string>()
  const state = { down: false, calls: 0 }
  const server: Server = createServer((req, res) => {
    state.calls++
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (state.down) {
      res.statusCode = 503
      res.end('unavailable')
      return
    }
    const code = codes.get(`${url.searchParams.get('lat')},${url.searchParams.get('lon')}`) ?? GSI_CODE
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ results: { muniCd: code, lv01Nm: 'test' } }))
  })
  return { server, codes, state }
}

async function observed(response: Response, askedFor: string) {
  return { status: response.status, body: (await response.text()).replaceAll(askedFor, '<asked>') }
}

describe('site registration over HTTP on a server that holds facilities', { skip }, () => {
  let base = ''
  let child: ChildProcess | undefined
  let root = ''
  let dataDir = ''
  let distDir = ''
  let hook = ''
  const gsi = fakeGeocoder()

  const put = (id: string, body: unknown, token: string, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/admin/sites/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json', ...bearer(token), ...headers }, body: JSON.stringify(body) })
  const get = (path: string, token: string) => fetch(`${base}${path}`, { headers: bearer(token) })
  const del = (path: string, token: string, headers: Record<string, string> = {}) => fetch(`${base}${path}`, { method: 'DELETE', headers: { ...bearer(token), ...headers } })
  const siteFile = (id: string) => join(dataDir, 'sites', `${id}.json`)
  const readSiteFile = async (id: string) => JSON.parse(await readFile(siteFile(id), 'utf8'))
  const state = async (id: string, token = OPERATOR_TOKEN) => {
    const response = await get(`/api/admin/sites/${id}`, token)
    assert.equal(response.status, 200)
    return response.json()
  }

  async function auditLines(): Promise<Record<string, any>[]> {
    const text = await readFile(join(dataDir, 'audit.jsonl'), 'utf8').catch(() => '')
    return text.split('\n').filter(Boolean).map((line) => JSON.parse(line))
  }

  // The audit line is written once the answer is on its way, so a test waits for it.
  async function auditLine(match: (line: Record<string, any>) => boolean): Promise<Record<string, any>> {
    for (let i = 0; i < 40; i++) {
      const found = (await auditLines()).filter(match)
      if (found.length) {
        assert.equal(found.length, 1, `one line per request: ${JSON.stringify(found)}`)
        return found[0]!
      }
      await sleep(50)
    }
    throw new Error('no audit line')
  }

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'evac-sites-api-'))
    dataDir = join(root, 'data')
    distDir = join(root, 'dist')
    await mkdir(join(dataDir, 'sites'), { recursive: true })
    await mkdir(join(dataDir, 'municipalities'), { recursive: true })
    await writeFile(join(dataDir, 'municipalities', `${GSI_CODE}.json`), '{}')
    await writeFile(join(dataDir, 'tokens.json'), JSON.stringify(TOKENS_FILE), { mode: 0o600 })
    const gsiPort = await freePort()
    await new Promise<void>((resolve) => gsi.server.listen(gsiPort, '127.0.0.1', resolve))
    hook = `http://127.0.0.1:${await freePort()}/hook`
    ;({ base, child } = await startServer({
      NUXT_DATA_DIR: dataDir,
      NUXT_DIST_DIR: distDir,
      NUXT_ADMIN_TOKEN: OPERATOR_TOKEN,
      NUXT_WEBHOOK_ALLOW_PRIVATE: '1',
      NUXT_REVERSE_GEOCODER_URL: `http://127.0.0.1:${gsiPort}/reverse-geocoder/LonLatToAddress`,
    }))
  })
  after(async () => {
    child?.kill()
    await new Promise((resolve) => gsi.server.close(resolve))
    await rm(root, { recursive: true, force: true })
  })

  test('a facility registers a new site: 201, its facility, the municipality from the geocoder, a file that validates', async () => {
    const response = await put('alpha-lobby', { ...PLACE, name: 'Lobby' }, TOKEN_A)
    assert.equal(response.status, 201)
    const body = await response.json()
    assert.equal(body.facility_id, FACILITY_A)
    assert.deepEqual(body.warnings, [])
    const stored = await readSiteFile('alpha-lobby')
    assert.deepEqual(body.site, stored)
    const { location_updated_at, ...rest } = stored
    assert.deepEqual(rest, { id: 'alpha-lobby', municipality_id: GSI_CODE, ...PLACE, name: 'Lobby', facility_id: FACILITY_A })
    assert.ok(!Number.isNaN(Date.parse(location_updated_at)))
    assert.match(await validateWithAgents(siteFile('alpha-lobby')), /^OK /)
  })

  test('the same body again answers 200 and leaves the site file as it was', async () => {
    const before = await readFile(siteFile('alpha-lobby'), 'utf8')
    const response = await put('alpha-lobby', { ...PLACE, name: 'Lobby' }, TOKEN_A)
    assert.equal(response.status, 200)
    assert.equal(await readFile(siteFile('alpha-lobby'), 'utf8'), before)
    assert.deepEqual((await readdir(join(dataDir, 'sites'))).filter((f) => f.startsWith('alpha-lobby')), ['alpha-lobby.json'])
  })

  test('new coordinates answer 200 and move the site', async () => {
    const before = await readSiteFile('alpha-lobby')
    await sleep(5)
    const response = await put('alpha-lobby', { ...PLACE, lat: 35.69 }, TOKEN_A)
    assert.equal(response.status, 200)
    const after = await readSiteFile('alpha-lobby')
    assert.equal(after.lat, 35.69)
    assert.equal(after.name, 'Lobby', 'a field the body leaves out is kept')
    assert.ok(Date.parse(after.location_updated_at) > Date.parse(before.location_updated_at))
  })

  test('a body or id that does not validate answers 400 invalid-request and writes nothing', async () => {
    const bad: [string, string, unknown][] = [
      ['no facing', 'alpha-bad', { lat: 35, lng: 139 }],
      ['lat out of range', 'alpha-bad', { ...PLACE, lat: 91 }],
      ['lat as a string', 'alpha-bad', { ...PLACE, lat: '35' }],
      ['facing out of range', 'alpha-bad', { ...PLACE, facing_deg: 361 }],
      ['an unknown field', 'alpha-bad', { ...PLACE, colour: 'red' }],
      ['an empty name', 'alpha-bad', { ...PLACE, name: '' }],
      ['a municipality that is not 5 digits', 'alpha-bad', { ...PLACE, municipality_id: '1310' }],
      ['an array', 'alpha-bad', [PLACE]],
      ['an id the schema refuses', 'Alpha_Bad', PLACE],
      ['an id too short', 'ab', PLACE],
    ]
    for (const [label, id, body] of bad) {
      const response = await put(id, body, TOKEN_A)
      assert.equal(response.status, 400, label)
      assert.equal((await response.json()).data?.code, 'invalid-request', label)
      assert.equal(existsSync(siteFile(id)), false, label)
    }
  })

  test('without the geocoder a new site answers 502 geocoder-unavailable, unless the body names the municipality', async () => {
    gsi.state.down = true
    try {
      const refused = await put('alpha-offline', PLACE, TOKEN_A)
      assert.equal(refused.status, 502)
      assert.equal((await refused.json()).data?.code, 'geocoder-unavailable')
      assert.equal(existsSync(siteFile('alpha-offline')), false)

      const given = await put('alpha-offline', { ...PLACE, municipality_id: OTHER_CODE }, TOKEN_A)
      assert.equal(given.status, 201)
      const body = await given.json()
      assert.equal(body.site.municipality_id, OTHER_CODE)
      assert.equal(body.warnings.length, 1)
    } finally {
      gsi.state.down = false
    }
  })

  test('a municipality that differs from the geocoder is kept and reported in warnings', async () => {
    const response = await put('alpha-mismatch', { ...PLACE, municipality_id: OTHER_CODE }, TOKEN_A)
    assert.equal(response.status, 201)
    const body = await response.json()
    assert.equal(body.site.municipality_id, OTHER_CODE)
    assert.equal(body.warnings.length, 1)
    assert.match(body.warnings[0], new RegExp(`${OTHER_CODE}.*${GSI_CODE}`))
    assert.equal(body.municipality_prepared, false)
  })

  test('a facility gets 409 site-id-taken for a site of another facility or of none, without its owner, and nothing changes', async () => {
    assert.equal((await put('beta-hall', PLACE, TOKEN_B)).status, 201)
    await writeFile(siteFile('loose-site'), JSON.stringify({ id: 'loose-site', municipality_id: GSI_CODE, ...PLACE, note: 'kept', replay: { from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z', speed: 60 } }))
    for (const id of ['beta-hall', 'loose-site']) {
      const before = await readFile(siteFile(id), 'utf8')
      const response = await put(id, { ...PLACE, lat: 35.7 }, TOKEN_A)
      assert.equal(response.status, 409, id)
      const text = await response.text()
      assert.equal(JSON.parse(text).data?.code, 'site-id-taken')
      for (const secret of [FACILITY_B, 'beta signage', 'facility_id', 'kept']) assert.ok(!text.includes(secret), `${id}: ${text}`)
      assert.equal(await readFile(siteFile(id), 'utf8'), before, id)
    }
  })

  test('the operator updates any site and keeps its facility, its replay and its note', async () => {
    const beta = await put('beta-hall', { ...PLACE, lat: 35.7 }, OPERATOR_TOKEN)
    assert.equal(beta.status, 200)
    assert.equal((await readSiteFile('beta-hall')).facility_id, FACILITY_B)
    assert.equal((await beta.json()).facility_id, FACILITY_B)

    assert.equal((await put('loose-site', { ...PLACE, lng: 139.77 }, OPERATOR_TOKEN)).status, 200)
    const loose = await readSiteFile('loose-site')
    assert.equal(loose.lng, 139.77)
    assert.equal(loose.note, 'kept')
    assert.deepEqual(loose.replay, { from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z', speed: 60 })
    assert.equal(loose.facility_id, undefined)

    const created = await put('operator-made', PLACE, OPERATOR_TOKEN)
    assert.equal(created.status, 201)
    assert.equal((await created.json()).facility_id, null)
    assert.equal((await readSiteFile('operator-made')).facility_id, undefined)
  })

  test('a facility reads its own sites only; others and missing ids answer the same 404', async () => {
    assert.equal((await state('alpha-lobby', TOKEN_A)).site.id, 'alpha-lobby')
    const missing = await observed(await get('/api/admin/sites/no-such-site', TOKEN_A), 'no-such-site')
    assert.equal(missing.status, 404)
    assert.equal(JSON.parse(missing.body).data?.code, 'not-found')
    for (const id of ['beta-hall', 'loose-site']) assert.deepEqual(await observed(await get(`/api/admin/sites/${id}`, TOKEN_A), id), missing, id)

    const own = await (await get('/api/admin/sites', TOKEN_A)).json()
    assert.deepEqual(own.sites.map((s: any) => s.site.id).sort(), ['alpha-lobby', 'alpha-mismatch', 'alpha-offline'])
    const all = await (await get('/api/admin/sites', OPERATOR_TOKEN)).json()
    assert.ok(['beta-hall', 'loose-site', 'operator-made', 'alpha-lobby'].every((id) => all.sites.some((s: any) => s.site.id === id)))
    const beta = await (await get(`/api/admin/sites?facility_id=${FACILITY_B}`, OPERATOR_TOKEN)).json()
    assert.deepEqual(beta.sites.map((s: any) => s.site.id), ['beta-hall'])
  })

  test('SiteState: one class per screen class, from the index, the reports and the approvals', async () => {
    assert.equal((await put('alpha-state', PLACE, TOKEN_A)).status, 201)
    const fresh = await state('alpha-state', TOKEN_A)
    assert.equal(fresh.needs_generation, true, 'no screens yet')
    assert.equal(fresh.municipality_prepared, true)
    assert.deepEqual(fresh.classes, [])

    await sleep(5)
    const specs: ScreenSpec[] = [
      { bulletin: 'TEST-ST-1', issued_at: '2026-11-02T10:00:00+09:00', level: 3, outcome: 'pass' },
      { bulletin: 'TEST-ST-2', issued_at: '2026-11-02T11:00:00+09:00', level: 3, outcome: 'pass' },
      { bulletin: 'TEST-ST-3', issued_at: '2026-11-02T10:30:00+09:00', level: 4, outcome: 'fail' },
      { bulletin: 'TEST-ST-4', issued_at: '2026-11-02T10:40:00+09:00', level: 5 },
    ]
    await writeScreens(dataDir, 'alpha-state', GSI_CODE, specs)
    const composed = await state('alpha-state', TOKEN_A)
    assert.equal(composed.needs_generation, false)
    assert.deepEqual(
      composed.classes.map((c: any) => [c.class, c.bulletin_id, c.outcome, c.approved, c.live]),
      [
        ['tsunami/evac-now/3', 'TEST-ST-2', 'pass', false, false],
        ['tsunami/evac-now/4', 'TEST-ST-3', 'fail', false, false],
        ['tsunami/evac-now/5', 'TEST-ST-4', 'pending', false, false],
      ],
    )
    assert.equal(composed.classes[0].digest, layoutDigest([{ shape: '16x9', body: screenBody(specs[1]!) }]))
    assert.deepEqual(composed.classes[0].previews, {})
    assert.deepEqual(composed.approved_classes, { approved: 0, total: 3 })
    assert.equal(composed.auto_publish, false)

    assert.equal((await postJson(base, '/api/admin/approve', { site_id: 'alpha-state', bulletin_id: 'TEST-ST-2', approved: true }, bearer(TOKEN_A))).status, 200)
    assert.equal((await postJson(base, '/api/admin/site', { site_id: 'alpha-state', auto_publish: true }, bearer(TOKEN_A))).status, 200)
    assert.equal((await postJson(base, '/api/admin/live', { site_id: 'alpha-state', bulletin_id: 'TEST-ST-2' }, bearer(OPERATOR_TOKEN))).status, 200)
    const approved = await state('alpha-state', TOKEN_A)
    assert.equal(approved.classes[0].approved, true)
    assert.ok(!Number.isNaN(Date.parse(approved.classes[0].approved_at)))
    assert.equal(approved.classes[0].live, true)
    assert.equal(approved.classes[1].live, false)
    assert.deepEqual(approved.approved_classes, { approved: 1, total: 3 })
    assert.equal(approved.auto_publish, true)

    await sleep(5)
    assert.equal((await put('alpha-state', { ...PLACE, facing_deg: 180 }, TOKEN_A)).status, 200)
    assert.equal((await state('alpha-state', TOKEN_A)).needs_generation, true, 'the place changed after the screens were made')
  })

  test('SiteState.exports reflects the export records of the site', async () => {
    await mkdir(join(dataDir, 'live'), { recursive: true })
    const jobs = {
      'TEST-ST-1': { status: 'ok', digest: 'sha256:a', updated_at: '2026-11-02T01:00:00.000Z' },
      'TEST-ST-2': { status: 'running', digest: 'sha256:b', updated_at: '2026-11-02T01:01:00.000Z' },
      'TEST-ST-3': { status: 'failed', digest: 'sha256:c', updated_at: '2026-11-02T01:02:00.000Z', message: 'chrome exited' },
    }
    await writeFile(join(dataDir, 'live', 'alpha-state.export.json'), JSON.stringify({ site_id: 'alpha-state', jobs }))
    const { exports } = await state('alpha-state', TOKEN_A)
    assert.deepEqual(exports, { pending: ['TEST-ST-2'], failed: [{ bulletin_id: 'TEST-ST-3', reason: 'chrome exited', at: '2026-11-02T01:02:00.000Z' }] })
  })

  test('DELETE removes everything of the site and nothing of the others', async () => {
    const gone = 'alpha-gone'
    const stay = 'alpha-stay'
    const bulletin = 'TEST-DEL-1'
    for (const id of [gone, stay]) {
      assert.equal((await put(id, PLACE, TOKEN_A)).status, 201)
      await writeScreens(dataDir, id, GSI_CODE, [{ bulletin, issued_at: '2026-11-02T10:00:00+09:00', level: 3, outcome: 'pass' }])
      assert.equal((await postJson(base, '/api/admin/approve', { site_id: id, bulletin_id: bulletin, approved: true }, bearer(TOKEN_A))).status, 200)
      assert.equal((await postJson(base, '/api/admin/site', { site_id: id, auto_publish: true }, bearer(TOKEN_A))).status, 200)
      assert.equal((await postJson(base, '/api/admin/live', { site_id: id, bulletin_id: bulletin }, bearer(OPERATOR_TOKEN))).status, 200)
      assert.equal((await postJson(base, '/api/admin/subscriptions', { site_id: id, url: hook, secret: SECRET }, bearer(TOKEN_A))).status, 201)
      await writeFile(join(dataDir, 'live', `${id}.receiver.json`), JSON.stringify({ received_at: '2026-11-02T01:00:00Z' }))
      await writeFile(join(dataDir, 'live', `${id}.export.json`), JSON.stringify({ site_id: id, jobs: {} }))
      await mkdir(join(distDir, id, bulletin), { recursive: true })
      await writeFile(join(distDir, id, bulletin, '16x9.png'), 'png')
    }
    assert.equal((await fetch(`${base}/api/feed/${gone}`)).status, 200)

    const response = await del(`/api/admin/sites/${gone}`, TOKEN_A)
    assert.equal(response.status, 204)

    for (const path of [
      siteFile(gone),
      join(dataDir, 'layouts', gone),
      join(dataDir, 'reports', gone),
      join(dataDir, 'live', `${gone}.json`),
      join(dataDir, 'live', `${gone}.receiver.json`),
      join(dataDir, 'live', `${gone}.export.json`),
      join(distDir, gone),
    ]) assert.equal(existsSync(path), false, path)
    const approvals = JSON.parse(await readFile(join(dataDir, 'approvals.json'), 'utf8'))
    for (const section of ['layouts', 'classes']) {
      assert.ok(!Object.keys(approvals[section]).some((key) => key.startsWith(`${gone}/`)), section)
      assert.ok(Object.keys(approvals[section]).some((key) => key.startsWith(`${stay}/`)), section)
    }
    assert.equal(approvals.sites[gone], undefined)
    assert.equal(approvals.sites[stay].auto_publish, true)
    const subscriptions = JSON.parse(await readFile(join(dataDir, 'subscriptions.json'), 'utf8')).subscriptions
    assert.ok(!subscriptions.some((s: any) => s.site_id === gone))
    assert.ok(subscriptions.some((s: any) => s.site_id === stay))
    assert.equal((await fetch(`${base}/api/feed/${gone}`)).status, 404)
    assert.equal((await fetch(`${base}/api/feed/${stay}`)).status, 200)
    assert.equal((await get(`/api/admin/sites/${gone}`, TOKEN_A)).status, 404)
  })

  test('DELETE of a site of another facility answers 404 and removes nothing', async () => {
    const before = await readFile(siteFile('beta-hall'), 'utf8')
    const approvals = await readFile(join(dataDir, 'approvals.json'), 'utf8')
    for (const id of ['beta-hall', 'loose-site']) {
      const response = await del(`/api/admin/sites/${id}`, TOKEN_A)
      assert.equal(response.status, 404, id)
      assert.equal((await response.json()).data?.code, 'not-found')
    }
    assert.equal(await readFile(siteFile('beta-hall'), 'utf8'), before)
    assert.ok(existsSync(siteFile('loose-site')))
    assert.equal(await readFile(join(dataDir, 'approvals.json'), 'utf8'), approvals)
  })

  test('twenty PUTs of one site at the same moment leave one whole site file', async () => {
    const bodies = Array.from({ length: 20 }, (_, i) => ({ ...PLACE, lat: 35 + i / 1000, name: `Rush ${i}` }))
    const responses = await Promise.all(bodies.map((body) => put('alpha-rush', body, TOKEN_A)))
    const statuses = responses.map((r) => r.status).sort()
    assert.deepEqual(statuses, [200, ...Array(18).fill(200), 201].sort())
    const stored = await readSiteFile('alpha-rush')
    assert.ok(bodies.some((b) => b.lat === stored.lat && b.name === stored.name), JSON.stringify(stored))
    assert.equal(stored.facility_id, FACILITY_A)
    assert.deepEqual((await readdir(join(dataDir, 'sites'))).filter((f) => f.startsWith('alpha-rush')), ['alpha-rush.json'])
  })

  test('every change is audited with its principal, actor and outcome; 401 is not', async () => {
    const actor = { id: 'staff-17', name: '山田 花子' }
    assert.equal((await put('alpha-audit', { ...PLACE, actor }, TOKEN_A)).status, 201)
    const created = await auditLine((l) => l.path === '/api/admin/sites/alpha-audit' && l.method === 'PUT')
    assert.equal(created.status, 201)
    assert.equal(created.site_id, 'alpha-audit')
    assert.deepEqual(created.principal, { kind: 'facility', facility_id: FACILITY_A, label: 'alpha signage' })
    assert.deepEqual(created.actor, actor)
    assert.ok(!Number.isNaN(Date.parse(created.at)))
    assert.equal((await readSiteFile('alpha-audit')).actor, undefined, 'the actor is not stored in the site')

    const headers = { 'x-evaclayer-actor-id': 'staff-18', 'x-evaclayer-actor-name': encodeURIComponent('佐藤') }
    assert.equal((await del('/api/admin/sites/no-such-audit', TOKEN_A, headers)).status, 404)
    const missing = await auditLine((l) => l.path === '/api/admin/sites/no-such-audit')
    assert.equal(missing.status, 404)
    assert.deepEqual(missing.actor, { id: 'staff-18', name: '佐藤' })

    assert.equal((await put('beta-hall', { ...PLACE, actor: { id: 'staff-19' } }, TOKEN_A)).status, 409)
    const taken = await auditLine((l) => l.path === '/api/admin/sites/beta-hall' && l.actor?.id === 'staff-19')
    assert.equal(taken.status, 409)
    assert.equal(taken.principal.facility_id, FACILITY_A)

    assert.equal((await put('alpha-audit-bad', { lat: 35 }, TOKEN_A)).status, 400)
    assert.equal((await auditLine((l) => l.path === '/api/admin/sites/alpha-audit-bad')).status, 400)

    assert.equal((await postJson(base, '/api/admin/approve', { site_id: 'alpha-state', bulletin_id: 'TEST-ST-2', approved: true, actor }, bearer(OPERATOR_TOKEN))).status, 200)
    const approve = await auditLine((l) => l.path === '/api/admin/approve' && l.actor?.id === 'staff-17')
    assert.deepEqual(approve.principal, { kind: 'operator' })
    assert.equal(approve.site_id, 'alpha-state')
    assert.equal(approve.status, 200)

    assert.equal((await fetch(`${base}/api/admin/sites/alpha-unauthorized`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(PLACE) })).status, 401)
    assert.equal((await put('alpha-unauthorized', PLACE, 'not-a-token')).status, 401)
    await sleep(300)
    assert.ok(!(await auditLines()).some((l) => l.path === '/api/admin/sites/alpha-unauthorized'))
    assert.ok(!(await auditLines()).some((l) => l.method === 'GET'), 'reads are not audited')
  })

  test('an actor of the wrong shape answers 400', async () => {
    const bad: [string, () => Promise<Response>][] = [
      ['id too long', () => put('alpha-actor', { ...PLACE, actor: { id: 'x'.repeat(121) } }, TOKEN_A)],
      ['name too long', () => put('alpha-actor', { ...PLACE, actor: { id: 'a', name: 'x'.repeat(121) } }, TOKEN_A)],
      ['no id', () => put('alpha-actor', { ...PLACE, actor: { name: 'a' } }, TOKEN_A)],
      ['an unknown field', () => put('alpha-actor', { ...PLACE, actor: { id: 'a', role: 'admin' } }, TOKEN_A)],
      ['not an object', () => put('alpha-actor', { ...PLACE, actor: 'a' }, TOKEN_A)],
      ['approve with a bad actor', () => postJson(base, '/api/admin/approve', { site_id: 'alpha-state', bulletin_id: 'TEST-ST-2', approved: true, actor: { id: 7 } }, bearer(TOKEN_A))],
      ['a header name that is not percent-encoded UTF-8', () => del('/api/admin/sites/alpha-actor', TOKEN_A, { 'x-evaclayer-actor-id': 'a', 'x-evaclayer-actor-name': '%E5%B1' })],
      ['a header id too long', () => del('/api/admin/sites/alpha-actor', TOKEN_A, { 'x-evaclayer-actor-id': 'x'.repeat(121) })],
      ['a header name without an id', () => del('/api/admin/sites/alpha-actor', TOKEN_A, { 'x-evaclayer-actor-name': 'a' })],
    ]
    for (const [label, call] of bad) {
      const response = await call()
      assert.equal(response.status, 400, label)
      assert.equal((await response.json()).data?.code, 'invalid-request', label)
    }
    assert.equal(existsSync(siteFile('alpha-actor')), false)
  })

  test('lookups by place are off: feed by coordinates, site-near, and replay reset', async () => {
    for (const path of [`/api/feed?lat=${PLACE.lat}&lng=${PLACE.lng}`, `/api/site-near?lat=${PLACE.lat}&lng=${PLACE.lng}`]) {
      const response = await fetch(`${base}${path}`)
      assert.equal(response.status, 404, path)
      assert.equal((await response.json()).data?.code, 'place-lookup-disabled', path)
    }
    const replay = { from: '2026-11-02T00:00:00+09:00', to: '2026-11-03T00:00:00+09:00', speed: 1 }
    await writeFile(siteFile('replay-site'), JSON.stringify({ id: 'replay-site', municipality_id: GSI_CODE, ...PLACE, replay }))
    await writeScreens(dataDir, 'replay-site', GSI_CODE, [{ bulletin: 'TEST-RP-1', issued_at: '2026-11-02T10:00:00+09:00', level: 3 }])
    const elapsed = async (query: string) => (await (await fetch(`${base}/api/replay?site=replay-site${query}`)).json()).elapsedMs
    await elapsed('')
    await sleep(300)
    assert.ok((await elapsed('&reset')) >= 250, 'reset is ignored')
  })

  test('one broken site file does not stop the catalog or the approvals of other sites', async () => {
    const broken = siteFile('broken-site')
    await writeFile(broken, '{"id": "broken-site", ')
    try {
      for (const token of [TOKEN_A, OPERATOR_TOKEN]) assert.equal((await get('/api/admin/catalog', token)).status, 200)
      assert.equal((await postJson(base, '/api/admin/approve', { site_id: 'alpha-state', bulletin_id: 'TEST-ST-2', approved: true }, bearer(TOKEN_A))).status, 200)
      assert.equal((await get('/api/admin/sites', TOKEN_A)).status, 200)
    } finally {
      await rm(broken)
    }
  })
})

describe('feed by coordinates on a single-facility server', { skip }, () => {
  let base = ''
  let child: ChildProcess | undefined
  let root = ''
  const SITE = 'only-site'

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'evac-feed-place-'))
    const dataDir = join(root, 'data')
    await mkdir(join(dataDir, 'sites'), { recursive: true })
    await writeFile(join(dataDir, 'sites', `${SITE}.json`), JSON.stringify({ id: SITE, municipality_id: GSI_CODE, ...PLACE, replay: { from: '2026-11-02T00:00:00+09:00', to: '2026-11-03T00:00:00+09:00', speed: 1 } }))
    await writeScreens(dataDir, SITE, GSI_CODE, [{ bulletin: 'TEST-FP-1', issued_at: '2026-11-02T10:00:00+09:00', level: 3 }])
    ;({ base, child } = await startServer({ NUXT_DATA_DIR: dataDir, NUXT_DIST_DIR: join(root, 'dist'), NUXT_ADMIN_TOKEN: '' }))
  })
  after(async () => {
    child?.kill()
    await rm(root, { recursive: true, force: true })
  })

  test('answers the feed of the site within 100 m as /api/feed/<site> does, with Content-Location and 304', async () => {
    const bySite = await fetch(`${base}/api/feed/${SITE}`)
    const byPlace = await fetch(`${base}/api/feed?lat=${PLACE.lat + 0.0005}&lng=${PLACE.lng}`)
    assert.equal(byPlace.status, 200)
    assert.equal(byPlace.headers.get('content-location'), `/api/feed/${SITE}`)
    assert.equal(byPlace.headers.get('etag'), bySite.headers.get('etag'))
    assert.equal(byPlace.headers.get('content-type'), bySite.headers.get('content-type'))
    assert.equal(await byPlace.text(), await bySite.text())

    const etag = byPlace.headers.get('etag')!
    const again = await fetch(`${base}/api/feed?lat=${PLACE.lat}&lng=${PLACE.lng}`, { headers: { 'if-none-match': etag } })
    assert.equal(again.status, 304)
    assert.equal(again.headers.get('content-location'), `/api/feed/${SITE}`)
  })

  test('no site within 100 m answers 404 no-site-near, and bad coordinates 400 invalid-request', async () => {
    const far = await fetch(`${base}/api/feed?lat=${PLACE.lat + 0.01}&lng=${PLACE.lng}`)
    assert.equal(far.status, 404)
    assert.equal((await far.json()).data?.code, 'no-site-near')
    for (const query of ['', '?lat=91&lng=0', '?lat=x&lng=0', '?lat=35']) {
      const response = await fetch(`${base}/api/feed${query}`)
      assert.equal(response.status, 400, query)
      assert.equal((await response.json()).data?.code, 'invalid-request', query)
    }
  })

  test('site-near and replay reset still work', async () => {
    assert.equal((await (await fetch(`${base}/api/site-near?lat=${PLACE.lat}&lng=${PLACE.lng}`)).json()).site, SITE)
    const elapsed = async (query: string) => (await (await fetch(`${base}/api/replay?site=${SITE}${query}`)).json()).elapsedMs
    await elapsed('')
    await sleep(300)
    assert.ok((await elapsed('&reset')) < 250, 'reset restarts the replay')
  })
})
