import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { APP_DIR, SERVER_ENTRY, freePort, postJson, startServer } from './helpers.ts'

const BULLETIN = 'TEST-FAC-1'
const OPERATOR_TOKEN = 'operator-token-for-tests'
const TOKEN_A = 'facility-a-token-for-tests'
const TOKEN_B = 'facility-b-token-for-tests'
const TOKEN_EXPIRED = 'facility-a-expired-token-for-tests'
const SECRET = 'a-shared-secret-of-enough-length'
const OWN = { id: 'alpha-hall', facility_id: 'alpha-fac', municipality_id: '00021' }
const OTHER = { id: 'beta-hall', facility_id: 'beta-fac', municipality_id: '00022' }
const UNOWNED = { id: 'loose-site', municipality_id: '00023' }
const MISSING = 'no-such-site'

const skip = !existsSync(SERVER_ENTRY) && 'run `pnpm -F app build` first'

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })
const sha256 = (token: string) => createHash('sha256').update(token).digest('hex')

function tokenRecord(token: string, facility_id: string, expires_at?: string) {
  return { id: randomUUID().slice(0, 8), label: `${facility_id} signage`, facility_id, sha256: sha256(token), created_at: '2026-11-01T00:00:00Z', ...(expires_at ? { expires_at } : {}) }
}

const TOKENS_FILE = {
  version: '0.1',
  tokens: [tokenRecord(TOKEN_A, OWN.facility_id), tokenRecord(TOKEN_B, OTHER.facility_id, '2099-01-01T00:00:00Z'), tokenRecord(TOKEN_EXPIRED, OWN.facility_id, '2020-01-01T00:00:00Z')],
}

async function addSite(dataDir: string, site: { id: string; municipality_id: string; facility_id?: string }) {
  const fixture = JSON.parse(await readFile(join(APP_DIR, 'fixtures', 'wajima-tsunami.json'), 'utf8'))
  const layoutDir = join(dataDir, 'layouts', site.id, BULLETIN)
  await mkdir(layoutDir, { recursive: true })
  await writeFile(join(layoutDir, '16x9.json'), JSON.stringify({ ...fixture, shape: '16x9', alert: { ...fixture.alert, bulletin_id: BULLETIN } }))
  await writeFile(
    join(dataDir, 'layouts', site.id, 'index.json'),
    JSON.stringify({
      municipality: site.municipality_id,
      name: `${site.id} town`,
      site: site.id,
      entries: [{ issued_at: '2026-10-21T15:55:00+09:00', bulletin_id: BULLETIN, wmo_code: 'VXKO50', raw_title: 'test', municipality_level: 4, screen: true }],
    }),
  )
  await writeFile(join(dataDir, 'sites', `${site.id}.json`), JSON.stringify({ ...site, lat: 35, lng: 139, facing_deg: 0 }))
}

async function makeDataDir(): Promise<{ root: string; dataDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'evac-facility-'))
  const dataDir = join(root, 'data')
  await mkdir(join(dataDir, 'sites'), { recursive: true })
  for (const site of [OWN, OTHER, UNOWNED]) await addSite(dataDir, site)
  return { root, dataDir }
}

// What a caller can observe of an answer, with the id it asked for taken out: the id is its own input.
async function observed(response: Response, askedFor: string) {
  return { status: response.status, body: (await response.text()).replaceAll(askedFor, '<asked>') }
}

describe('facility credentials', { skip }, () => {
  let base = ''
  let child: ChildProcess | undefined
  let root = ''
  let hook = ''

  const get = (path: string, token: string) => fetch(`${base}${path}`, { headers: bearer(token) })
  const del = (path: string, token: string) => fetch(`${base}${path}`, { method: 'DELETE', headers: bearer(token) })
  const subscribe = (site: string, token: string) => postJson(base, '/api/admin/subscriptions', { site_id: site, url: hook, secret: SECRET }, bearer(token))

  const siteRoutes: [string, (site: string, token: string) => Promise<Response>][] = [
    ['approve', (site, token) => postJson(base, '/api/admin/approve', { site_id: site, bulletin_id: BULLETIN, approved: true }, bearer(token))],
    ['revoke', (site, token) => postJson(base, '/api/admin/approve', { site_id: site, bulletin_id: BULLETIN, approved: false }, bearer(token))],
    ['site', (site, token) => postJson(base, '/api/admin/site', { site_id: site, auto_publish: true }, bearer(token))],
    ['preview-layout', (site, token) => get(`/api/admin/preview-layout?site=${site}&bulletin=${BULLETIN}&shape=16x9`, token)],
    ['preview-layout with a municipality', (site, token) => get(`/api/admin/preview-layout?site=${site}&municipality=${OWN.municipality_id}&bulletin=${BULLETIN}&shape=16x9`, token)],
    ['subscriptions list', (site, token) => get(`/api/admin/subscriptions?site=${site}`, token)],
    ['subscribe', (site, token) => subscribe(site, token)],
  ]

  before(async () => {
    let dataDir = ''
    ;({ root, dataDir } = await makeDataDir())
    await writeFile(join(dataDir, 'tokens.json'), JSON.stringify(TOKENS_FILE), { mode: 0o600 })
    hook = `http://127.0.0.1:${await freePort()}/hook`
    ;({ base, child } = await startServer({ NUXT_DATA_DIR: dataDir, NUXT_ADMIN_TOKEN: OPERATOR_TOKEN, NUXT_WEBHOOK_ALLOW_PRIVATE: '1' }))
  })
  after(async () => {
    child?.kill()
    await rm(root, { recursive: true, force: true })
  })

  test('a facility token acts on the sites of its own facility', async () => {
    for (const [label, call] of siteRoutes) {
      const response = await call(OWN.id, TOKEN_A)
      assert.ok(response.ok, `${label}: ${response.status} ${await response.text()}`)
    }
    const subscription = await (await subscribe(OWN.id, TOKEN_A)).json()
    const listed = await (await get(`/api/admin/subscriptions?site=${OWN.id}`, TOKEN_A)).json()
    assert.ok(listed.subscriptions.some((s: { id: string }) => s.id === subscription.id))
    assert.equal((await del(`/api/admin/subscriptions/${subscription.id}`, TOKEN_A)).status, 204)
    const after = await (await get(`/api/admin/subscriptions?site=${OWN.id}`, TOKEN_A)).json()
    assert.ok(!after.subscriptions.some((s: { id: string }) => s.id === subscription.id))
  })

  test('a site of another facility, or of none, answers exactly as a site that does not exist', async () => {
    for (const [label, call] of siteRoutes) {
      const missing = await observed(await call(MISSING, TOKEN_A), MISSING)
      assert.equal(missing.status, 404, `${label}: ${missing.body}`)
      for (const site of [OTHER.id, UNOWNED.id]) {
        assert.deepEqual(await observed(await call(site, TOKEN_A), site), missing, `${label} on ${site}`)
      }
    }
  })

  test('the catalog of a facility holds its own sites and layouts only', async () => {
    const catalog = await (await get('/api/admin/catalog', TOKEN_A)).json()
    assert.deepEqual(catalog.layouts.map((l: { site_id: string }) => l.site_id), [OWN.id])
    assert.deepEqual(catalog.sites.map((s: { id: string }) => s.id), [OWN.id])
  })

  test('a facility names its site: no municipality alias, no list of every site, and no live bulletin', async () => {
    assert.equal((await postJson(base, '/api/admin/approve', { municipality: OWN.municipality_id, bulletin_id: BULLETIN, approved: true }, bearer(TOKEN_A))).status, 400)
    assert.equal((await get(`/api/admin/preview-layout?municipality=${OWN.municipality_id}&bulletin=${BULLETIN}&shape=16x9`, TOKEN_A)).status, 400)
    assert.equal((await get('/api/admin/subscriptions', TOKEN_A)).status, 400)
    const live = await postJson(base, '/api/admin/live', { site_id: OWN.id, bulletin_id: null }, bearer(TOKEN_A))
    assert.equal(live.status, 403)
    assert.equal((await live.json()).data?.code, 'operator-only')
  })

  test('a facility cannot remove a registration of another facility, and cannot tell it exists', async () => {
    const created = await subscribe(OWN.id, TOKEN_A)
    assert.equal(created.status, 201)
    const { id } = await created.json()
    const missingId = randomUUID()
    const missing = await observed(await del(`/api/admin/subscriptions/${missingId}`, TOKEN_B), missingId)
    assert.equal(missing.status, 404)
    assert.deepEqual(await observed(await del(`/api/admin/subscriptions/${id}`, TOKEN_B), id), missing)
    const listed = await (await get(`/api/admin/subscriptions?site=${OWN.id}`, TOKEN_A)).json()
    assert.ok(listed.subscriptions.some((s: { id: string }) => s.id === id), 'the registration is still there')

    const operatorOwned = await subscribe(UNOWNED.id, OPERATOR_TOKEN)
    assert.equal(operatorOwned.status, 201)
    assert.equal((await del(`/api/admin/subscriptions/${(await operatorOwned.json()).id}`, TOKEN_A)).status, 404)
  })

  test('an expired, unknown or missing token answers 401', async () => {
    for (const headers of [bearer(TOKEN_EXPIRED), bearer('not-a-token-of-anyone'), {}]) {
      assert.equal((await fetch(`${base}/api/admin/catalog`, { headers })).status, 401)
      assert.equal((await postJson(base, '/api/admin/site', { site_id: OWN.id, auto_publish: true }, headers)).status, 401)
    }
  })

  test('the operator token acts on every site as before', async () => {
    for (const site of [OWN.id, OTHER.id, UNOWNED.id]) {
      for (const [label, call] of siteRoutes.filter(([l]) => l !== 'preview-layout with a municipality')) {
        const response = await call(site, OPERATOR_TOKEN)
        assert.ok(response.ok, `${label} on ${site}: ${response.status}`)
      }
    }
    const catalog = await (await get('/api/admin/catalog', OPERATOR_TOKEN)).json()
    assert.deepEqual(catalog.layouts.map((l: { site_id: string }) => l.site_id), [OWN.id, OTHER.id, UNOWNED.id].sort())
    assert.deepEqual(catalog.sites.map((s: { id: string }) => s.id).sort(), [OWN.id, OTHER.id, UNOWNED.id].sort())
    assert.equal((await get('/api/admin/subscriptions', OPERATOR_TOKEN)).status, 200)
    assert.equal((await get(`/api/admin/preview-layout?municipality=${OTHER.municipality_id}&bulletin=${BULLETIN}&shape=16x9`, OPERATOR_TOKEN)).status, 200)
    assert.equal((await postJson(base, '/api/admin/live', { site_id: UNOWNED.id, bulletin_id: null }, bearer(OPERATOR_TOKEN))).status, 200)
  })
})

describe('loopback admin and facility tokens', { skip }, () => {
  let base = ''
  let child: ChildProcess | undefined
  let root = ''
  let tokensFile = ''

  const localCatalog = () => fetch(`${base}/api/admin/catalog`)

  before(async () => {
    let dataDir = ''
    ;({ root, dataDir } = await makeDataDir())
    tokensFile = join(dataDir, 'tokens.json')
    ;({ base, child } = await startServer({ NUXT_DATA_DIR: dataDir, NUXT_ADMIN_TOKEN: '' }))
  })
  after(async () => {
    child?.kill()
    await rm(root, { recursive: true, force: true })
  })

  test('loopback is admitted without a token until a facility token is registered', async () => {
    assert.equal((await localCatalog()).status, 200, 'no tokens.json')
    await writeFile(tokensFile, JSON.stringify({ version: '0.1', tokens: [] }), { mode: 0o600 })
    assert.equal((await localCatalog()).status, 200, 'an empty tokens.json')
    await writeFile(tokensFile, JSON.stringify(TOKENS_FILE), { mode: 0o600 })
    assert.equal((await localCatalog()).status, 401, 'a facility token exists')
    assert.equal((await postJson(base, '/api/admin/site', { site_id: OWN.id, auto_publish: true })).status, 401)
    assert.equal((await fetch(`${base}/api/admin/catalog`, { headers: bearer(TOKEN_A) })).status, 200)
  })

  test('with facility tokens and no operator token, operator-only paths admit no one', async () => {
    await writeFile(tokensFile, JSON.stringify(TOKENS_FILE), { mode: 0o600 })
    assert.equal((await postJson(base, '/api/admin/live', { site_id: OWN.id, bulletin_id: null })).status, 401)
    assert.equal((await postJson(base, '/api/admin/live', { site_id: OWN.id, bulletin_id: null }, bearer(TOKEN_A))).status, 403)
  })
})
