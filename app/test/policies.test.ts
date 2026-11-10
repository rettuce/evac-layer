import assert from 'node:assert/strict'
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { sourceLines } from '../layout/sources.ts'
import { isDemoSitePath, isTrustedLayoutSrc, resolveLayoutSrc } from '../layout/trust.ts'
import { type AdminRequest, type FacilityToken, adminPrincipal, clientAddressFor, facilityRouteAllowed, tokenLedgerFrom, tokenSha256 } from '../server/utils/adminPolicy.ts'
import { serialQueue } from '../server/utils/serialQueue.ts'
import { type CheckReport, classDigest, layoutDigest, liveLayoutGate, liveLayoutGateWith, passedBrowserCheck, revokeClasses, screenClass } from '../layout/gate.ts'
import { checkRepoJsonPath } from '../server/utils/repoJson.ts'
import { checkWebhookUrl, isPublicAddress } from '../server/utils/webhookPolicy.ts'
import { WEBHOOK_RETRIES, webhookRetryDelayMs } from '../layout/feed.ts'
import { firstDeliverable, nextLiveState } from '../layout/liveState.ts'

test('dev layout bridge serves only .json files inside the repository', async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'evac-repo-'))
  const repo = join(sandbox, 'repo')
  const outside = join(sandbox, 'outside')
  await mkdir(join(repo, 'data'), { recursive: true })
  await mkdir(outside)
  await writeFile(join(repo, 'data', 'ok.json'), '{}')
  await writeFile(join(repo, '.env'), 'ANTHROPIC_API_KEY=secret')
  await writeFile(join(repo, 'notes.txt'), 'x')
  await writeFile(join(outside, 'leak.json'), '{}')
  await symlink(join(outside, 'leak.json'), join(repo, 'data', 'escape.json'))
  await symlink(join(repo, '.env'), join(repo, 'data', 'env.json'))

  assert.equal((await checkRepoJsonPath(join(repo, 'data', 'ok.json'), repo)).ok, true)
  for (const file of [join(repo, '.env'), join(repo, 'notes.txt'), 'data/ok.json', undefined]) {
    assert.deepEqual(await checkRepoJsonPath(file, repo).then((r) => !r.ok && r.status), 403, String(file))
  }
  assert.equal(await checkRepoJsonPath(join(repo, '..', 'outside', 'leak.json'), repo).then((r) => !r.ok && r.status), 403)
  assert.equal(await checkRepoJsonPath(join(repo, 'data', 'escape.json'), repo).then((r) => !r.ok && r.status), 403)
  assert.equal(await checkRepoJsonPath(join(repo, 'data', 'env.json'), repo).then((r) => !r.ok && r.status), 403)
  assert.equal(await checkRepoJsonPath(join(repo, 'data', 'missing.json'), repo).then((r) => !r.ok && r.status), 404)

  const ledgers = ['tokens.json', 'subscriptions.json', 'approvals.json', 'tokens.json.123.tmp', 'approvals.json.123.tmp', 'tokens.json.lock', 'tokens.json.123.tmp.json']
  for (const name of ledgers) await writeFile(join(repo, 'data', name), '{}')
  await symlink(join(repo, 'data', 'tokens.json'), join(repo, 'data', 'innocent.json'))
  for (const name of [...ledgers, 'innocent.json', 'TOKENS.json']) {
    assert.equal(await checkRepoJsonPath(join(repo, 'data', name), repo).then((r) => !r.ok && r.status), 403, name)
  }
})

test('production screens accept only the layout store as src', () => {
  for (const src of ['/api/live-layout?municipality=05210', '/api/admin/preview-layout?municipality=05210']) {
    assert.equal(isTrustedLayoutSrc(src, false), true, src)
  }
  for (const src of ['/api/layout?file=/x.json', '/api/admin/catalog', '//evil.example/x.json', 'https://evil.example/x.json', undefined, ['/api/live-layout?']]) {
    assert.equal(isTrustedLayoutSrc(src, false), false, String(src))
  }
  assert.equal(isTrustedLayoutSrc('/api/layout?file=/x.json', true), true)
  assert.equal(isTrustedLayoutSrc('//evil.example/x.json', true), false)
})

test('demo/sites layouts resolve in production, and nothing outside demo/sites does', () => {
  assert.deepEqual(resolveLayoutSrc('demo/sites/tsurumai-kaikan/16x9.json', false), {
    url: '/api/demo-site-layout?path=demo%2Fsites%2Ftsurumai-kaikan%2F16x9.json',
    origin: 'demo-sites',
  })
  assert.equal(isDemoSitePath('demo/sites/tsurumai-kaikan/16x9.json'), true)
  for (const path of ['demo/sites/../../.env.json', 'demo/sites/a/../../b.json', '/demo/sites/a/16x9.json', 'data/sites/a.json', 'demo/sites/a/16x9.txt', 'demo/sites//a.json', 'demo/sites/a\\..\\b.json', undefined]) {
    assert.equal(isDemoSitePath(path), false, String(path))
  }
})

const localPost: AdminRequest = {
  method: 'POST',
  clientAddress: '127.0.0.1',
  host: '127.0.0.1:3160',
  origin: 'http://127.0.0.1:3160',
  secFetchSite: 'same-origin',
  contentType: 'application/json',
}

const OPERATOR = { kind: 'operator' }

test('admin without a token accepts only local, same-origin JSON requests', () => {
  assert.deepEqual(adminPrincipal(localPost, '', []), OPERATOR)
  assert.deepEqual(adminPrincipal({ ...localPost, origin: undefined, secFetchSite: undefined }, '', []), OPERATOR)
  assert.deepEqual(adminPrincipal({ method: 'GET', clientAddress: '::1', host: 'localhost:3160' }, '', []), OPERATOR)
  const refused: [string, AdminRequest][] = [
    ['LAN client', { ...localPost, clientAddress: '192.168.0.92' }],
    ['rebound Host', { ...localPost, host: 'evil.example:3160', origin: 'http://evil.example:3160' }],
    ['foreign Origin', { ...localPost, origin: 'http://evil.example' }],
    ['malformed Origin', { ...localPost, origin: 'not a url' }],
    ['cross-site fetch', { ...localPost, secFetchSite: 'cross-site' }],
    ['form post', { ...localPost, contentType: 'text/plain' }],
    ['missing Host', { ...localPost, host: undefined }],
  ]
  for (const [label, req] of refused) assert.equal(adminPrincipal(req, '', []), 403, label)
})

test('admin with a token requires it as a Bearer credential, from anywhere', () => {
  const remote = { ...localPost, clientAddress: '192.168.0.92', host: 'signage.example' }
  assert.equal(adminPrincipal(remote, 'secret', []), 401)
  assert.equal(adminPrincipal({ ...remote, authorization: 'Bearer wrong' }, 'secret', []), 401)
  assert.equal(adminPrincipal({ ...localPost, authorization: 'Bearer secre' }, 'secret', []), 401)
  assert.deepEqual(adminPrincipal({ ...remote, authorization: 'Bearer secret' }, 'secret', []), OPERATOR)
})

const NOW = Date.parse('2026-11-11T00:00:00Z')

function facilityToken(token: string, facility_id: string, expires_at?: string): FacilityToken {
  return { id: `id-${facility_id}`, label: `${facility_id} signage`, facility_id, sha256: tokenSha256(token), created_at: '2026-11-01T00:00:00Z', ...(expires_at ? { expires_at } : {}) }
}

const tokens = [
  facilityToken('token-alpha', 'alpha-fac'),
  facilityToken('token-beta', 'beta-fac', '2026-12-01T00:00:00Z'),
  facilityToken('token-old', 'alpha-fac', '2026-11-10T00:00:00Z'),
]

test('a facility token is matched by its SHA-256 and names its facility; the operator token still wins', () => {
  const remote = { ...localPost, clientAddress: '192.168.0.92', host: 'signage.example' }
  assert.equal(tokenSha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.deepEqual(adminPrincipal({ ...remote, authorization: 'Bearer token-alpha' }, 'secret', tokens, NOW), { kind: 'facility', facility_id: 'alpha-fac', label: 'alpha-fac signage' })
  assert.deepEqual(adminPrincipal({ ...remote, authorization: 'Bearer token-beta' }, '', tokens, NOW), { kind: 'facility', facility_id: 'beta-fac', label: 'beta-fac signage' })
  assert.deepEqual(adminPrincipal({ ...remote, authorization: 'Bearer secret' }, 'secret', tokens, NOW), OPERATOR)
})

test('an expired, unknown or missing facility token answers 401 alike', () => {
  const remote = { ...localPost, clientAddress: '192.168.0.92', host: 'signage.example' }
  for (const operator of ['', 'secret']) {
    assert.equal(adminPrincipal({ ...remote, authorization: 'Bearer token-old' }, operator, tokens, NOW), 401, `expired, operator "${operator}"`)
    assert.equal(adminPrincipal({ ...remote, authorization: 'Bearer token-unknown' }, operator, tokens, NOW), 401, `unknown, operator "${operator}"`)
    assert.equal(adminPrincipal(remote, operator, tokens, NOW), 401, `none, operator "${operator}"`)
  }
  assert.equal(adminPrincipal({ ...remote, authorization: 'Bearer token-beta' }, '', tokens, Date.parse('2026-12-01T00:00:00Z')), 401, 'expires at that instant')
  const unreadable = [{ ...facilityToken('token-alpha', 'alpha-fac'), expires_at: 'someday' }]
  assert.equal(adminPrincipal({ ...remote, authorization: 'Bearer token-alpha' }, '', unreadable, NOW), 401, 'an unreadable expiry counts as expired')
})

test('loopback without a token is the operator only while no facility token is registered', () => {
  assert.deepEqual(adminPrincipal(localPost, '', [], NOW), OPERATOR)
  assert.equal(adminPrincipal(localPost, '', tokens, NOW), 401)
  assert.equal(adminPrincipal(localPost, '', [facilityToken('token-old', 'alpha-fac', '2026-11-10T00:00:00Z')], NOW), 401, 'an expired token still switches loopback off')
  assert.deepEqual(adminPrincipal({ ...localPost, authorization: 'Bearer token-alpha' }, '', tokens, NOW), { kind: 'facility', facility_id: 'alpha-fac', label: 'alpha-fac signage' })
})

const BROKEN_LEDGERS: [string, unknown][] = [
  ['an empty object', {}],
  ['null', null],
  ['tokens null', { tokens: null }],
  ['tokens an object', { tokens: {} }],
  ['a number', 3],
  ['a record without a label', { tokens: [facilityToken('token-alpha', 'alpha-fac'), { id: 'x', facility_id: 'beta-fac', sha256: tokenSha256('token-beta'), created_at: '2026-11-01T00:00:00Z' }] }],
  ['a hash that is not 64 hex', { tokens: [{ ...facilityToken('token-alpha', 'alpha-fac'), sha256: 'abc' }] }],
  ['a numeric expiry', { tokens: [{ ...facilityToken('token-alpha', 'alpha-fac'), expires_at: 1 }] }],
  ['a record that is null', { tokens: [null] }],
]

test('the token ledger is a list of well-formed records, or no file at all; anything else is broken', () => {
  assert.deepEqual(tokenLedgerFrom(undefined), [])
  assert.deepEqual(tokenLedgerFrom({ version: '0.1', tokens: [] }), [])
  assert.deepEqual(tokenLedgerFrom({ version: '0.1', tokens }), tokens)
  for (const [label, doc] of BROKEN_LEDGERS) assert.equal(tokenLedgerFrom(doc), 'broken', label)
})

test('a broken ledger admits no facility and no loopback, and the operator token still works', () => {
  const remote = { ...localPost, clientAddress: '192.168.0.92', host: 'signage.example' }
  assert.equal(adminPrincipal(localPost, '', 'broken', NOW), 401)
  assert.equal(adminPrincipal({ ...localPost, authorization: 'Bearer token-alpha' }, '', 'broken', NOW), 401)
  assert.equal(adminPrincipal({ ...remote, authorization: 'Bearer token-alpha' }, 'secret', 'broken', NOW), 401)
  assert.deepEqual(adminPrincipal({ ...remote, authorization: 'Bearer secret' }, 'secret', 'broken', NOW), OPERATOR)
  assert.deepEqual(adminPrincipal({ ...remote, authorization: 'secret' }, 'secret', 'broken', NOW), OPERATOR)
})

test('a facility token counts only as a Bearer credential; the operator token keeps its old leniency', () => {
  const remote = { ...localPost, clientAddress: '192.168.0.92', host: 'signage.example' }
  assert.equal(adminPrincipal({ ...remote, authorization: 'token-alpha' }, 'secret', tokens, NOW), 401)
  assert.equal(adminPrincipal({ ...remote, authorization: 'Basic token-alpha' }, '', tokens, NOW), 401)
  assert.deepEqual(adminPrincipal({ ...remote, authorization: 'bearer token-alpha' }, '', tokens, NOW), { kind: 'facility', facility_id: 'alpha-fac', label: 'alpha-fac signage' })
  assert.deepEqual(adminPrincipal({ ...remote, authorization: 'secret' }, 'secret', tokens, NOW), OPERATOR)
})

test('a serial queue keeps both of two read-modify-write updates started together', async () => {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5))
  const store = { value: { a: 0, b: 0 } }
  const update = async (key: 'a' | 'b') => {
    const read = { ...store.value }
    await tick()
    read[key] += 1
    await tick()
    store.value = read
  }
  await Promise.all([update('a'), update('b')])
  assert.notDeepEqual(store.value, { a: 1, b: 1 }, 'without the queue one update is lost, so this test can tell')

  store.value = { a: 0, b: 0 }
  const queue = serialQueue()
  const failing = queue(async () => {
    throw new Error('a failed update')
  })
  await Promise.all([queue(() => update('a')), failing.catch(() => undefined), queue(() => update('b'))])
  assert.deepEqual(store.value, { a: 1, b: 1 })
  await assert.rejects(failing, /a failed update/)
})

test('a facility credential reaches only the admin paths that have a facility rule', () => {
  const admitted: [string, string][] = [
    ['GET', '/api/admin/catalog'],
    ['POST', '/api/admin/approve'],
    ['POST', '/api/admin/site'],
    ['GET', '/api/admin/preview-layout'],
    ['GET', '/api/admin/subscriptions'],
    ['POST', '/api/admin/subscriptions'],
    ['DELETE', '/api/admin/subscriptions/0b6c3e1e-5f0e-4c1a-9c55-3f1f0f6f2a10'],
  ]
  for (const [method, path] of admitted) assert.equal(facilityRouteAllowed(method, path), true, `${method} ${path}`)
  const refused: [string, string][] = [
    ['POST', '/api/admin/live'],
    ['GET', '/api/admin/live'],
    ['POST', '/api/admin/catalog'],
    ['DELETE', '/api/admin/subscriptions'],
    ['DELETE', '/api/admin/subscriptions/a/b'],
    ['GET', '/api/admin/catalog/'],
    ['GET', '/api/admin/some-later-path'],
    ['HEAD', '/api/admin/catalog'],
  ]
  for (const [method, path] of refused) assert.equal(facilityRouteAllowed(method, path), false, `${method} ${path}`)
})

test('live screens get a layout only for a bulletin approved at that site, with auto publish on', () => {
  const at = '2026-11-02T00:00:00Z'
  const none = { version: '0.1' as const, layouts: {}, sites: {} }
  const siteOn = { ...none, sites: { s1: { auto_publish: true, updated_at: at } } }
  const siteOff = { ...none, sites: { s1: { auto_publish: false, updated_at: at } } }
  const approved = { ...siteOn, layouts: { 's1/B1': { approved: true, updated_at: at } } }
  const revoked = { ...siteOn, layouts: { 's1/B1': { approved: false, updated_at: at } } }
  assert.equal(liveLayoutGate(none, 's1', 'B1'), 'auto-publish-off')
  assert.equal(liveLayoutGate(siteOff, 's1', 'B1'), 'auto-publish-off')
  const twoSites = { ...approved, sites: { ...approved.sites, s2: { auto_publish: true, updated_at: at } } }
  assert.equal(liveLayoutGate(twoSites, 's2', 'B1'), 'unapproved', 'an approval at one site does not open another site in the same municipality')
  assert.equal(liveLayoutGate(siteOn, 's1', 'B1'), 'unapproved')
  assert.equal(liveLayoutGate(revoked, 's1', 'B1'), 'unapproved')
  assert.equal(liveLayoutGate(approved, 's1', 'B2'), 'unapproved')
  assert.equal(liveLayoutGate(approved, 's1', 'B1'), 'ok')
})

test('an approval is bound to the layout files it was given for; regenerated files are stale until re-approved', () => {
  const at = '2026-11-05T00:00:00Z'
  const files = [{ shape: '16x9', body: '{"a":1}' }, { shape: '9x16', body: '{"b":2}' }]
  const digest = layoutDigest(files)
  assert.equal(digest, layoutDigest([...files].reverse()))
  assert.notEqual(digest, layoutDigest([{ shape: '16x9', body: '{"a":2}' }, { shape: '9x16', body: '{"b":2}' }]))
  const sites = { s1: { auto_publish: true, updated_at: at } }
  const bound = { version: '0.1' as const, sites, layouts: { 's1/B1': { approved: true, updated_at: at, digest } } }
  const unbound = { version: '0.1' as const, sites, layouts: { 's1/B1': { approved: true, updated_at: at } } }
  assert.equal(liveLayoutGate(bound, 's1', 'B1', digest), 'ok')
  assert.equal(liveLayoutGate(bound, 's1', 'B1', layoutDigest([{ shape: '16x9', body: '{"a":2}' }])), 'stale')
  assert.equal(liveLayoutGate(unbound, 's1', 'B1', digest), 'stale')
  assert.equal(liveLayoutGate(bound, 's1', 'B1'), 'ok')
})

function floodScreen(bulletin: string, issuedAt: string, action = '高い ところへ にげて', headlineEn = 'Koyoshi River Flood Lv 4') {
  return {
    version: '0.1', kind: 'evac-screen', municipality: { id: '05210', name: '由利本荘市' },
    alert: { source: 'jma', bulletin_id: bulletin, hazard: 'flood', level: 4, issued_at: issuedAt },
    shape: '16x9', template: 'evac-now', palette: 'cabinet-office-5',
    cells: [
      { id: 'headline', role: 'headline', text: { ja: `見出し ${bulletin}`, en: headlineEn } },
      { id: 'action', role: 'action', text: { ja_easy: action } },
      { id: 'source', role: 'source', text: { ja: `気象庁 ${issuedAt} 発表` } },
    ],
    sources: [{ type: 'gsi', file: '05210_2.csv' }, { type: 'jma', bulletin_id: bulletin }],
  }
}

function classOf(screen: ReturnType<typeof floodScreen>, report: CheckReport = {}) {
  const files = [{ shape: '16x9', body: JSON.stringify(screen) }]
  const digest = layoutDigest(files)
  const checked = passedBrowserCheck({ outcome: 'pass', verifier: 'browser (http://127.0.0.1:3150)', layout_digest: digest, browser_skipped: [], ...report }, digest)
  return { files, digest, cls: { key: screenClass(screen), digest: classDigest(files), checked } }
}

test('a class approval opens a new bulletin of the same class whose headline, time and id alone differ', () => {
  const at = '2026-11-07T00:00:00Z'
  const approved = classOf(floodScreen('B1', '2026-10-21T18:15:00+09:00'))
  const next = classOf(floodScreen('B2', '2026-10-22T09:30:00+09:00'))
  assert.equal(approved.cls.key, 'flood/evac-now/4')
  assert.equal(next.cls.digest, approved.cls.digest)
  assert.notEqual(next.digest, approved.digest)
  const approvals = {
    version: '0.1' as const, sites: { s1: { auto_publish: true, updated_at: at } },
    layouts: { 's1/B1': { approved: true, updated_at: at, digest: approved.digest } },
    classes: { 's1/flood/evac-now/4': { approved: true, updated_at: at, digest: approved.cls.digest, approved_from: 'B1' } },
  }
  assert.deepEqual(liveLayoutGateWith(approvals, 's1', 'B2', next.digest, next.cls), { gate: 'ok', by: 'class' })
  assert.deepEqual(liveLayoutGateWith(approvals, 's1', 'B1', approved.digest, approved.cls), { gate: 'ok', by: 'bulletin' })
  const bothSitesOn = { ...approvals, sites: { ...approvals.sites, s2: { auto_publish: true, updated_at: at } } }
  assert.equal(liveLayoutGate(bothSitesOn, 's2', 'B2', next.digest, next.cls), 'unapproved', 'a class approved at one site does not open another site')
  assert.equal(liveLayoutGate(bothSitesOn, 's1', 'B2', next.digest, next.cls), 'ok')

  const failedCheck = classOf(floodScreen('B5', '2026-10-22T11:00:00+09:00'), { outcome: 'fail', verifier: 'browser (http://127.0.0.1:3150)' })
  assert.equal(failedCheck.cls.digest, approved.cls.digest)
  assert.equal(liveLayoutGate(approvals, 's1', 'B5', failedCheck.digest, failedCheck.cls), 'unapproved', 'a class approval needs the bulletin\'s own screens to pass the browser check')
  const staticOnly = classOf(floodScreen('B6', '2026-10-22T11:30:00+09:00'), { outcome: 'pass', verifier: 'static' })
  assert.equal(liveLayoutGate(approvals, 's1', 'B6', staticOnly.digest, staticOnly.cls), 'unapproved', 'a pass without a browser does not count')
  const skippedShape = classOf(floodScreen('B7', '2026-10-22T12:00:00+09:00'), { browser_skipped: ['pillar'] })
  assert.equal(liveLayoutGate(approvals, 's1', 'B7', skippedShape.digest, skippedShape.cls), 'unapproved', 'a shape the browser did not open was not checked')
  const otherFiles = classOf(floodScreen('B8', '2026-10-22T12:30:00+09:00'), { layout_digest: approved.digest })
  assert.equal(liveLayoutGate(approvals, 's1', 'B8', otherFiles.digest, otherFiles.cls), 'unapproved', 'a report about other layout files does not vouch for these')

  const edited = classOf(floodScreen('B3', '2026-10-22T10:00:00+09:00', '高い ところへ にげで'))
  assert.notEqual(edited.cls.digest, approved.cls.digest)
  assert.equal(liveLayoutGate(approvals, 's1', 'B3', edited.digest, edited.cls), 'unapproved', 'one changed letter in the action is not the approved screen')
  const retranslated = classOf(floodScreen('B4', '2026-10-22T10:30:00+09:00', '高い ところへ にげて', 'Koyoshi River Flood Lv 5'))
  assert.equal(liveLayoutGate(approvals, 's1', 'B4', retranslated.digest, retranslated.cls), 'unapproved', 'one changed letter in a translated headline is not the approved screen')

  const revoked = {
    ...approvals,
    layouts: { 's1/B1': { approved: false, updated_at: at } },
    classes: { 's1/flood/evac-now/4': { ...approvals.classes['s1/flood/evac-now/4'], approved: false } },
  }
  assert.equal(liveLayoutGate(revoked, 's1', 'B2', next.digest, next.cls), 'unapproved', 'revoking the bulletin revokes its class')
  const revokedWithoutFiles = {
    ...approvals,
    layouts: { 's1/B1': { approved: false, updated_at: at } },
    classes: revokeClasses(approvals.classes, 's1', 'B1', undefined, at),
  }
  assert.equal(revokedWithoutFiles.classes['s1/flood/evac-now/4']!.approved, false, 'the class approved from a bulletin falls with it even when its layout files are gone')
  assert.equal(liveLayoutGate(revokedWithoutFiles, 's1', 'B2', next.digest, next.cls), 'unapproved')
  assert.equal(revokeClasses(approvals.classes, 's2', 'B1', undefined, at)['s1/flood/evac-now/4']!.approved, true, 'revoking at another site leaves this site alone')
  const bulletinRevoked = { ...approvals, layouts: { ...approvals.layouts, 's1/B2': { approved: false, updated_at: at } } }
  assert.equal(liveLayoutGate(bulletinRevoked, 's1', 'B2', next.digest, next.cls), 'unapproved', 'a bulletin the operator turned off stays off')
})

test('an unapproved new bulletin keeps the screen that was live before it, one step back', async () => {
  const at = '2026-11-07T00:00:00Z'
  const first = nextLiveState(undefined, 'B1', at)
  assert.deepEqual(first, { bulletin_id: 'B1', fallback_bulletin_id: null, updated_at: at })
  const second = nextLiveState(first, 'B2', at)
  assert.equal(second.fallback_bulletin_id, 'B1')
  assert.equal(nextLiveState(second, 'B2', at).fallback_bulletin_id, 'B1', 'posting the same bulletin again keeps its fallback')
  assert.deepEqual(nextLiveState(second, null, at), { bulletin_id: null, fallback_bulletin_id: null, updated_at: at })

  const approved = (ids: string[]) => async (id: string) => ids.includes(id)
  assert.equal(await firstDeliverable(second, approved(['B1', 'B2'])), 'B2')
  assert.equal(await firstDeliverable(second, approved(['B1'])), 'B1', 'the previous approved screen stays while the new one is unapproved')
  assert.equal(await firstDeliverable(second, approved([])), undefined, 'neither approved: ambient')
  assert.equal(await firstDeliverable({ bulletin_id: 'B2', updated_at: at }, approved(['B1'])), undefined, 'a live file written before fallbacks existed')
})

test('approvals written before classes existed still gate by bulletin', () => {
  const at = '2026-11-07T00:00:00Z'
  const { digest, cls } = classOf(floodScreen('B1', '2026-10-21T18:15:00+09:00'))
  const legacy = { version: '0.1' as const, sites: { s1: { auto_publish: true, updated_at: at } }, layouts: { 's1/B1': { approved: true, updated_at: at, digest } } }
  assert.equal(liveLayoutGate(legacy, 's1', 'B1', digest, cls), 'ok')
  assert.equal(liveLayoutGate(legacy, 's1', 'B1', digest), 'ok')
  assert.equal(liveLayoutGate(legacy, 's1', 'B2', layoutDigest([{ shape: '16x9', body: '{}' }]), cls), 'unapproved')
})

test('dev trusts only the forwarded address appended by a local relay', () => {
  assert.equal(clientAddressFor('192.168.0.92', '127.0.0.1', true), '192.168.0.92')
  assert.equal(clientAddressFor('127.0.0.1', '8.8.8.8, 127.0.0.1', true), '127.0.0.1')
  assert.equal(clientAddressFor('127.0.0.1', '127.0.0.1, 8.8.8.8', true), '8.8.8.8')
  assert.equal(clientAddressFor(undefined, '127.0.0.1', true), '127.0.0.1')
  assert.equal(clientAddressFor(undefined, undefined, true), '')
  assert.equal(clientAddressFor('10.0.0.5', '127.0.0.1', false), '10.0.0.5')
  assert.equal(clientAddressFor(undefined, '127.0.0.1', false), '')
})

test('webhook targets: only public addresses over http(s)', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.0.92', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:c0a8:5c', '::7f00:1', '2002:c0a8:5c::1', '2001:0:4136:e378::1', '64:ff9b::7f00:1', '2001:db8::1']) {
    assert.equal(isPublicAddress(address), false, address)
  }
  for (const address of ['8.8.8.8', '133.242.0.1', '2001:4860:4860::8888']) assert.equal(isPublicAddress(address), true, address)
  assert.equal(checkWebhookUrl('ftp://example.com/').ok, false)
  assert.equal(checkWebhookUrl('not a url').ok, false)
  assert.equal(checkWebhookUrl('https://cms.example/hooks/evac').ok, true)
})

test('webhook retries back off exponentially, five times', () => {
  assert.equal(WEBHOOK_RETRIES, 5)
  assert.deepEqual([0, 1, 2, 3, 4].map(webhookRetryDelayMs), [1000, 2000, 4000, 8000, 16000])
})

test('every source of a screen stays readable in the document behind the short source line', () => {
  const lines = sourceLines({
    alert: { source: 'jma', bulletin_id: 'VXKOii-1', hazard: 'flood', level: 4, issued_at: '2026-10-21T18:15:00+09:00' },
    sources: [
      { type: 'pdf', file: 'yurihonjo-map-north.pdf', page: 1 },
      { type: 'gsi', file: 'mergeFromCity_05210.csv' },
      { type: 'jma', bulletin_id: 'VXKOii-1' },
    ],
  })
  assert.deepEqual(lines, ['自治体資料 yurihonjo-map-north.pdf p.1', '国土地理院 mergeFromCity_05210.csv', '気象庁 電文 VXKOii-1（2026-10-21T18:15:00+09:00）'])
})
