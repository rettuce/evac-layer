import assert from 'node:assert/strict'
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { isTrustedLayoutSrc } from '../layout/trust.ts'
import { adminAccess, clientAddressFor, type AdminRequest } from '../server/utils/adminPolicy.ts'
import { liveLayoutGate } from '../layout/gate.ts'
import { checkRepoJsonPath } from '../server/utils/repoJson.ts'
import { checkWebhookUrl, isPublicAddress } from '../server/utils/webhookPolicy.ts'
import { WEBHOOK_RETRIES, webhookRetryDelayMs } from '../layout/feed.ts'

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

const localPost: AdminRequest = {
  method: 'POST',
  clientAddress: '127.0.0.1',
  host: '127.0.0.1:3160',
  origin: 'http://127.0.0.1:3160',
  secFetchSite: 'same-origin',
  contentType: 'application/json',
}

test('admin without a token accepts only local, same-origin JSON requests', () => {
  assert.equal(adminAccess(localPost, ''), 'allow')
  assert.equal(adminAccess({ ...localPost, origin: undefined, secFetchSite: undefined }, ''), 'allow')
  assert.equal(adminAccess({ method: 'GET', clientAddress: '::1', host: 'localhost:3160' }, ''), 'allow')
  const refused: [string, AdminRequest][] = [
    ['LAN client', { ...localPost, clientAddress: '192.168.0.92' }],
    ['rebound Host', { ...localPost, host: 'evil.example:3160', origin: 'http://evil.example:3160' }],
    ['foreign Origin', { ...localPost, origin: 'http://evil.example' }],
    ['malformed Origin', { ...localPost, origin: 'not a url' }],
    ['cross-site fetch', { ...localPost, secFetchSite: 'cross-site' }],
    ['form post', { ...localPost, contentType: 'text/plain' }],
    ['missing Host', { ...localPost, host: undefined }],
  ]
  for (const [label, req] of refused) assert.equal(adminAccess(req, ''), 403, label)
})

test('admin with a token requires it as a Bearer credential, from anywhere', () => {
  const remote = { ...localPost, clientAddress: '192.168.0.92', host: 'signage.example' }
  assert.equal(adminAccess(remote, 'secret'), 401)
  assert.equal(adminAccess({ ...remote, authorization: 'Bearer wrong' }, 'secret'), 401)
  assert.equal(adminAccess({ ...localPost, authorization: 'Bearer secre' }, 'secret'), 401)
  assert.equal(adminAccess({ ...remote, authorization: 'Bearer secret' }, 'secret'), 'allow')
})

test('live screens get a layout only for an approved bulletin at an auto-publish site', () => {
  const at = '2026-11-02T00:00:00Z'
  const none = { version: '0.1' as const, layouts: {}, sites: {} }
  const siteOn = { ...none, sites: { s1: { auto_publish: true, updated_at: at } } }
  const siteOff = { ...none, sites: { s1: { auto_publish: false, updated_at: at } } }
  const approved = { ...siteOn, layouts: { '05210/B1': { approved: true, updated_at: at } } }
  const revoked = { ...siteOn, layouts: { '05210/B1': { approved: false, updated_at: at } } }
  assert.equal(liveLayoutGate(none, 's1', '05210', 'B1'), 'auto-publish-off')
  assert.equal(liveLayoutGate(siteOff, 's1', '05210', 'B1'), 'auto-publish-off')
  assert.equal(liveLayoutGate(approved, undefined, '05210', 'B1'), 'auto-publish-off')
  assert.equal(liveLayoutGate(siteOn, 's1', '05210', 'B1'), 'unapproved')
  assert.equal(liveLayoutGate(revoked, 's1', '05210', 'B1'), 'unapproved')
  assert.equal(liveLayoutGate(approved, 's1', '05210', 'B2'), 'unapproved')
  assert.equal(liveLayoutGate(approved, 's1', '05210', 'B1'), 'ok')
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
