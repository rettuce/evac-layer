import assert from 'node:assert/strict'
import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { agentEnv } from '../server/utils/childProcess.ts'
import { argumentsMatch, parsePsLine, psEnv } from '../server/utils/orphans.ts'
import { advanceSiteGeneration, readWhileOwned, withSiteLock } from '../server/utils/siteLocks.ts'
import { SERVER_ENTRY, postJson, startServer } from './helpers.ts'
import { type StagedClass, classOf, stagedDigest, writeExistingScreens } from './generation-fakes.ts'
import { ALL_SECRETS, API_KEY, GENERATE_ENV, NOT_PREPARED, OPERATOR_TOKEN, PREPARED, REAL_PASS, SECRET_SAMPLE, SHARED_ENV, SYN_FAIL, SYN_PASS, TOKEN_A, TOKEN_B, TOKEN_C, alive, appears, bearer, byClass, client, makeData, previewPath, sleep, until } from './generation-harness.ts'

const skip = !existsSync(SERVER_ENTRY) && 'run `pnpm -F app build` first'

describe('reads and child environments, without a server', () => {
  test('a read whose site was deleted and registered again while it read answers nothing', async () => {
    const read = (id: string, during?: () => Promise<void>) =>
      readWhileOwned(id, {
        visible: async () => ({ id }),
        read: async () => {
          await during?.()
          return `data of ${id}`
        },
      })
    const handOver = async () => {
      await withSiteLock('race-site', async () => advanceSiteGeneration('race-site'))
      await withSiteLock('race-site', async () => advanceSiteGeneration('race-site'))
    }
    assert.equal(await read('race-site', handOver), undefined)
    assert.equal(await read('race-site'), 'data of race-site')
    assert.equal(await readWhileOwned('hidden-site', { visible: async () => undefined, read: async () => assert.fail('read without the site') }), undefined)
  })

  test('each kind of child gets the listed names of the environment; only generate gets the API settings', () => {
    const source: Record<string, string> = {
      PATH: '/bin', HOME: '/home/x', LANG: 'C', LC_ALL: 'C', LC_TERMINAL: 'x', TZ: 'UTC', TMPDIR: '/tmp', EVAC_URL: 'http://127.0.0.1:1', EVAC_RAW_DIR: '/raw', JMA_FEED_DIR: '/feed', CHROME_PATH: '/chrome',
      ANTHROPIC_API_KEY: API_KEY, ANTHROPIC_BASE_URL: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://proxy', NODE_EXTRA_CA_CERTS: '/ca.pem',
      NUXT_ADMIN_TOKEN: OPERATOR_TOKEN, NUXT_WEBHOOK_ALLOW_PRIVATE: '1', SECRET_SAMPLE, AWS_SECRET_ACCESS_KEY: 'x', EVAC_DATA_DIR: '/elsewhere', EVAC_FAKE_EXPORT_CALLS: '/calls', EVAC_UNLISTED_SETTING: 'x',
    }
    for (const purpose of ['generate', 'preview', 'export'] as const) {
      const env = agentEnv(purpose, source, '/data')
      assert.equal(env.EVAC_DATA_DIR, '/data', purpose)
      for (const name of ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'EVAC_URL', 'EVAC_RAW_DIR', 'JMA_FEED_DIR', 'CHROME_PATH']) assert.equal(env[name], source[name], `${purpose} ${name}`)
      for (const name of ['NUXT_ADMIN_TOKEN', 'NUXT_WEBHOOK_ALLOW_PRIVATE', 'SECRET_SAMPLE', 'AWS_SECRET_ACCESS_KEY', 'EVAC_FAKE_EXPORT_CALLS', 'EVAC_UNLISTED_SETTING', 'LC_TERMINAL']) assert.equal(env[name], undefined, `${purpose} ${name}`)
      for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'HTTPS_PROXY', 'NODE_EXTRA_CA_CERTS']) assert.equal(env[name], purpose === 'generate' ? source[name] : undefined, `${purpose} ${name}`)
    }
  })

  test('ps lines are read in the time zone ps is given, and the arguments of a command are matched whole', () => {
    const line = parsePsLine('  4321  4000  4000 Wed Nov 11 10:12:34 2026     node /srv/fake.mjs --site=ab --writer=live')
    assert.deepEqual(line, { pid: 4321, ppid: 4000, pgid: 4000, startedAt: new Date(2026, 10, 11, 10, 12, 34).getTime(), args: ['node', '/srv/fake.mjs', '--site=ab', '--writer=live'] })
    assert.equal(parsePsLine('  12  1  12 Mon Nov  2 09:05:01 2026 /sbin/launchd')?.startedAt, new Date(2026, 10, 2, 9, 5, 1).getTime())
    assert.equal(parsePsLine('garbage'), undefined)
    assert.equal(argumentsMatch(['--site=ab', '--writer=live'], line!.args), true)
    assert.equal(argumentsMatch(['--site=a'], line!.args), false)
    assert.equal(argumentsMatch(['--site=ab'], ['node', 'x', '--site=abc']), false)
    const saved = process.env.TZ
    try {
      process.env.TZ = 'Asia/Tokyo'
      assert.equal(psEnv().TZ, 'Asia/Tokyo')
      assert.equal(psEnv().LC_ALL, 'C')
    } finally {
      if (saved === undefined) delete process.env.TZ
      else process.env.TZ = saved
    }
  })
})

describe('generation jobs over HTTP', { skip }, () => {
  let base = ''
  let child: ChildProcess | undefined
  let data: Awaited<ReturnType<typeof makeData>>
  const api = client(() => base)

  before(async () => {
    data = await makeData()
    for (const id of ['alpha-one', 'alpha-two', 'alpha-fresh', 'alpha-fail', 'alpha-nopng', 'alpha-shapes', 'alpha-moved', 'alpha-partial', 'alpha-empty', 'alpha-link', 'del-running', 'del-queued', 'del-done', 'del-reborn', 'chrome-stderr', 'chrome-file', 'chrome-own', 'chrome-late', 'grand-live', 'pipe-hold', 'exp-del', 'exp-fail', 'alpha-comp', 'alpha-open']) await data.writeSite(id, 'alpha-fac')
    await data.writeSite('alpha-cold', 'alpha-fac', NOT_PREPARED)
    await data.writeSite('beta-one', 'beta-fac')
    await data.writeSite('op-site')
    ;({ base, child } = await startServer({ ...data.env, NUXT_GENERATIONS_PER_HOUR: '1000', NUXT_WEBHOOK_ALLOW_PRIVATE: '1' }))
  })
  after(async () => {
    child?.kill()
    for (const file of (await readdir(data.root)).filter((f) => /^(chrome-|stray-|grandchild-)/.test(f))) {
      const pid = Number(await readFile(join(data.root, file), 'utf8'))
      if (alive(pid)) process.kill(pid, 'SIGKILL')
    }
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
    assert.deepEqual(done.classes, [
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

  test('the site state carries the last job and, per class, synthetic, stale, previews and unchanged', async () => {
    const state = await api.state('alpha-one', TOKEN_A)
    const id = state.last_generation.generation_id
    assert.deepEqual(state.last_generation, await (await api.get(`/api/admin/sites/alpha-one/generations/${id}`, TOKEN_A)).json())
    const classes = byClass(state)
    const shapes = (spec: StagedClass) => ({ '16x9': previewPath('alpha-one', spec.bulletin, '16x9'), '1x1': previewPath('alpha-one', spec.bulletin, '1x1') })
    assert.deepEqual(classes[classOf(SYN_PASS)].previews, shapes(SYN_PASS))
    assert.deepEqual(classes[classOf(REAL_PASS)].previews, shapes(REAL_PASS), 'an unapproved real bulletin has previews too')
    assert.deepEqual(classes[classOf(SYN_FAIL)].previews, {})
    assert.equal(classes[classOf(SYN_PASS)].synthetic, true)
    assert.equal(classes[classOf(REAL_PASS)].synthetic, false)
    for (const c of state.classes) assert.equal(c.unchanged, false, 'the first job found no screens to compare with')
    for (const c of state.classes) assert.equal(c.stale, false, c.class)
    assert.equal(state.needs_generation, true, 'a class failed in the last job')
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

  test('a class the last job made another bulletin for shows that bulletin, and the old one\'s previews go', async () => {
    const replacement: StagedClass = { ...SYN_PASS, bulletin: 'SYN-VTSE41-202611010000-0000000000b1' }
    await data.fakes.stage('alpha-one', [replacement, { ...SYN_FAIL, outcome: 'pass' }, REAL_PASS])
    assert.equal((await api.run('alpha-one', TOKEN_A)).status, 'done')
    const state = await api.state('alpha-one')
    assert.equal(byClass(state)[classOf(SYN_PASS)].bulletin_id, replacement.bulletin)
    assert.equal(byClass(state)[classOf(SYN_PASS)].unchanged, false, 'another bulletin is never unchanged')
    assert.ok(!existsSync(join(data.dataDir, 'previews', 'alpha-one', SYN_PASS.bulletin)))
    assert.ok(existsSync(join(data.dataDir, 'previews', 'alpha-one', replacement.bulletin)))
    assert.equal(state.needs_generation, false)
  })

  test('needs_generation: no screens, a move after the job that made the screens, or a failed last job', async () => {
    assert.equal((await api.state('alpha-two')).needs_generation, true, 'no screens')
    const siteFile = join(data.dataDir, 'sites', 'alpha-one.json')
    const site = JSON.parse(await readFile(siteFile, 'utf8'))
    await writeFile(siteFile, JSON.stringify({ ...site, lat: 35.7, location_updated_at: new Date().toISOString() }))
    const future = new Date(Date.now() + 3600_000)
    await utimes(join(data.dataDir, 'layouts', 'alpha-one', 'index.json'), future, future)
    const moved = await api.state('alpha-one')
    assert.equal(moved.needs_generation, true, 'moved after the job, whatever the index time says')
    assert.equal(byClass(moved)[classOf(SYN_PASS)].stale, true)
    await data.fakes.stage('alpha-fresh', [SYN_PASS], { exit: '[generate stopped] the Writer did not answer' })
    assert.equal((await api.run('alpha-fresh', TOKEN_A)).status, 'failed')
    assert.equal((await api.state('alpha-fresh')).needs_generation, true, 'the last job failed')
    await data.fakes.stage('alpha-fresh', [SYN_PASS])
    assert.equal((await api.run('alpha-fresh', TOKEN_A)).status, 'done')
    assert.equal((await api.state('alpha-fresh')).needs_generation, false)
  })

  test('after a move and a successful job, the classes it made are fresh and a class it cannot make shows stale', async () => {
    const oldReal: StagedClass = { bulletin: 'VTSE41-202611050000-0000000000c1', level: 3, outcome: 'pass', issued_at: '2026-11-05T00:00:00+09:00' }
    const oldUnsupported: StagedClass = { bulletin: 'VTSE41-202611050000-0000000000c2', level: 4, outcome: 'pass', issued_at: '2026-11-05T00:00:00+09:00' }
    await writeExistingScreens(data.dataDir, 'alpha-moved', [oldReal, oldUnsupported])
    await sleep(20)
    await data.writeSite('alpha-moved', 'alpha-fac', PREPARED, new Date().toISOString(), 35.9)
    const before = byClass(await api.state('alpha-moved'))
    assert.equal(before[classOf(oldReal)].stale, true)
    const made: StagedClass = { bulletin: 'SYN-VTSE41-202411010000-0000000000c3', level: 3, outcome: 'pass' }
    await data.fakes.stage('alpha-moved', [made, { bulletin: '', level: 4, outcome: 'unsupported', reason: 'tsunami is not composed yet' }])
    assert.equal((await api.run('alpha-moved', TOKEN_A)).status, 'done')
    const state = await api.state('alpha-moved')
    const classes = byClass(state)
    assert.equal(classes[classOf(made)].bulletin_id, made.bulletin, 'the bulletin the job made stands for its class, older issue time or not')
    assert.equal(classes[classOf(made)].stale, false)
    assert.equal(classes[classOf(oldUnsupported)].bulletin_id, oldUnsupported.bulletin)
    assert.equal(classes[classOf(oldUnsupported)].stale, true)
    assert.equal(state.needs_generation, false, 'a job cannot make the stale class, so it does not ask for one')
  })

  test('a job in which a class failed leaves needs_generation true', async () => {
    await data.fakes.stage('alpha-partial', [SYN_PASS, SYN_FAIL])
    assert.equal((await api.run('alpha-partial', TOKEN_A)).status, 'done')
    assert.equal((await api.state('alpha-partial')).needs_generation, true)
  })

  test('a command that exits 0 without a result for this job ends failed with no-result', async () => {
    await data.fakes.stage('alpha-empty', [SYN_PASS], { noResult: true })
    const failed = await api.run('alpha-empty', TOKEN_A)
    assert.equal(failed.status, 'failed')
    assert.equal(failed.error_code, 'no-result')
    assert.deepEqual(failed.classes, [])
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
    assert.equal((await api.start('alpha-two', TOKEN_A, { classes: ['x'] })).status, 400)
  })

  test('a failed job tells a code and a fixed text, never the paths or variables the command printed', async () => {
    const leak = '[generate stopped] /Users/someone/private/evac/.env: API_TOKEN=abc123 at https://internal.example/x ~/someone-key.pem ../../someone/etc ./someone/raw'
    await data.fakes.stage('alpha-fail', [{ ...SYN_PASS, outcome: 'fail', reason: leak }, SYN_FAIL], { exit: leak })
    const failed = await api.run('alpha-fail', TOKEN_A)
    assert.equal(failed.status, 'failed')
    assert.equal(failed.error_code, 'generate-failed')
    assert.ok(failed.error.length <= 200)
    assert.deepEqual(failed.classes.map((c: any) => c.outcome), ['fail', 'fail'])
    assert.ok(failed.classes[0].reason.length > 0)
    const answers = [JSON.stringify(failed), JSON.stringify(await api.state('alpha-fail', TOKEN_A)), await readFile(join(data.dataDir, 'live', 'alpha-fail.generation.json'), 'utf8')]
    for (const text of answers) for (const secret of ['/Users/someone', 'API_TOKEN=abc123', 'internal.example', 'composing composing', 'someone-key', 'someone/etc', 'someone/raw']) assert.ok(!text.includes(secret), `${secret} in ${text}`)
  })

  test('a preview that cannot be rendered leaves the job done with a preview error code', async () => {
    await data.fakes.stage('alpha-nopng', [SYN_PASS], { previewFails: true })
    const done = await api.run('alpha-nopng', TOKEN_A)
    assert.equal(done.status, 'done')
    assert.equal(done.classes[0].preview_error, 'preview-failed')
    assert.ok(!JSON.stringify(done).includes('/opt/secret'))
    assert.deepEqual(byClass(await api.state('alpha-nopng'))[classOf(SYN_PASS)].previews, {})
  })

  test('a shape that was not rendered is rendered by the next job, and the preview error goes', async () => {
    await data.fakes.stage('alpha-shapes', [SYN_PASS], { previewFailShapes: ['1x1'] })
    const partial = await api.run('alpha-shapes', TOKEN_A)
    assert.equal(partial.classes[0].preview_error, 'preview-failed')
    assert.deepEqual(Object.keys(byClass(await api.state('alpha-shapes'))[classOf(SYN_PASS)].previews), ['16x9'])
    await data.fakes.stage('alpha-shapes', [SYN_PASS])
    const complete = await api.run('alpha-shapes', TOKEN_A)
    assert.equal(complete.classes[0].preview_error, undefined)
    assert.deepEqual(Object.keys(byClass(await api.state('alpha-shapes'))[classOf(SYN_PASS)].previews).sort(), ['16x9', '1x1'])
    const renders = (await data.fakes.calls()).filter((c) => c.kind === 'preview' && c.site === 'alpha-shapes')
    assert.equal(renders.length, 2)
  })

  test('a preview reached through a symbolic link is not served', async () => {
    await data.fakes.stage('alpha-link', [SYN_PASS])
    await api.run('alpha-link', TOKEN_A)
    const real = join(data.dataDir, 'previews', 'alpha-link', SYN_PASS.bulletin)
    const elsewhere = join(data.root, 'elsewhere')
    await cp(real, elsewhere, { recursive: true })
    await rm(real, { recursive: true })
    await symlink(elsewhere, real)
    assert.equal((await api.get(previewPath('alpha-link', SYN_PASS.bulletin, '16x9'), TOKEN_A)).status, 404)
    assert.deepEqual(byClass(await api.state('alpha-link'))[classOf(SYN_PASS)].previews, {})
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

  test('the children get only the allowed environment, and no credential shows in records, answers or the audit log', async () => {
    const dumps = (await readdir(data.root)).filter((f) => f.startsWith('env-'))
    assert.ok(dumps.some((f) => f.startsWith('env-generate-')) && dumps.some((f) => f.startsWith('env-preview-')))
    for (const file of dumps) {
      const env = JSON.parse(await readFile(join(data.root, file), 'utf8'))
      const allowed = file.startsWith('env-generate-') ? [...SHARED_ENV, ...GENERATE_ENV] : SHARED_ENV
      for (const name of Object.keys(env)) assert.ok(allowed.includes(name), `${file}: ${name}`)
      for (const secret of ALL_SECRETS) assert.ok(!JSON.stringify(env).includes(secret), file)
      assert.equal(env.ANTHROPIC_API_KEY, file.startsWith('env-generate-') ? API_KEY : undefined, file)
      assert.equal(env.ANTHROPIC_BASE_URL, file.startsWith('env-generate-') ? 'http://127.0.0.1:9' : undefined, file)
    }
    const preview = `/api/admin/preview-layout?${new URLSearchParams({ site: 'alpha-one', bulletin: SYN_PASS.bulletin, shape: '16x9' })}`
    assert.equal((await fetch(`${base}${preview}`)).status, 401)
    const texts = [
      ...(await Promise.all((await readdir(join(data.dataDir, 'live'))).map((f) => readFile(join(data.dataDir, 'live', f), 'utf8')))),
      await readFile(join(data.dataDir, 'audit.jsonl'), 'utf8'),
      JSON.stringify(await api.state('alpha-one')),
    ]
    for (const text of texts) for (const secret of [...ALL_SECRETS, API_KEY]) assert.ok(!text.includes(secret))
  })

  test('DELETE: a queued job never runs, a running one is asked to stop first, and the job record goes', async () => {
    await data.fakes.stage('del-running', [SYN_PASS])
    await data.fakes.stage('del-queued', [SYN_PASS])
    await data.fakes.hold('del-running')
    const running = (await (await api.start('del-running', TOKEN_A)).json()).generation_id
    assert.equal((await api.start('del-queued', TOKEN_A)).status, 202)
    await api.job('del-running', running, TOKEN_A, (s) => s === 'running')
    await appears(join(data.root, 'pid-del-running'))
    const pid = Number(await readFile(join(data.root, 'pid-del-running'), 'utf8'))
    assert.equal((await api.remove('del-queued', TOKEN_A)).status, 204)
    assert.equal((await api.remove('del-running', TOKEN_A)).status, 204)
    assert.equal(alive(pid), false, 'the generate process is gone when DELETE answers')
    assert.ok(existsSync(join(data.root, 'term-del-running')), 'it was sent SIGTERM before anything harder')
    await data.fakes.release('del-running')
    await sleep(500)
    assert.ok(!(await data.fakes.calls()).some((c) => c.site === 'del-queued'))
    for (const site of ['del-running', 'del-queued']) assert.ok(!existsSync(join(data.dataDir, 'live', `${site}.generation.json`)), site)
  })

  test('a Chrome to stop is taken only from the job\'s own pid file, and only when it descends from the command', async () => {
    const bystander = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { detached: true, stdio: 'ignore' })
    try {
      const stopDuringPreview = async (site: string) => {
        await data.fakes.hold(`${site}.preview`)
        assert.equal((await api.start(site, TOKEN_A)).status, 202)
        await appears(join(data.root, `pid-preview-${site}`))
        await sleep(100)
        assert.equal((await api.remove(site, TOKEN_A)).status, 204)
        await data.fakes.release(`${site}.preview`)
      }
      await data.fakes.stage('chrome-stderr', [SYN_PASS], { chromeMode: `stderr:${bystander.pid}` })
      await stopDuringPreview('chrome-stderr')
      assert.equal(alive(bystander.pid!), true, 'a pid printed on stderr is never stopped')
      await data.fakes.stage('chrome-file', [SYN_PASS], { chromeMode: `file:${bystander.pid}` })
      await stopDuringPreview('chrome-file')
      assert.equal(alive(bystander.pid!), true, 'a pid in the file that does not descend from the command is not stopped')
      await data.fakes.stage('chrome-own', [SYN_PASS], { chromeMode: 'own' })
      await stopDuringPreview('chrome-own')
      const browser = Number(await readFile(join(data.root, 'chrome-chrome-own'), 'utf8'))
      await until(() => !alive(browser), 'the Chrome the command started is still running')
    } finally {
      bystander.kill('SIGKILL')
    }
  })

  test('a Chrome the command starts while it is being stopped is stopped too', async () => {
    await data.fakes.stage('chrome-late', [SYN_PASS], { lateChrome: true })
    await data.fakes.hold('chrome-late.preview')
    assert.equal((await api.start('chrome-late', TOKEN_A)).status, 202)
    await appears(join(data.root, 'pid-preview-chrome-late'))
    assert.equal((await api.remove('chrome-late', TOKEN_A)).status, 204)
    await data.fakes.release('chrome-late.preview')
    const late = Number(await readFile(join(data.root, 'chrome-late-chrome-late'), 'utf8'))
    await until(() => !alive(late), 'the Chrome started during the stop is still running')
  })

  test('a command that ends while a process of its group runs on does not end the job before that process', async () => {
    await data.fakes.stage('grand-live', [SYN_PASS], { grandchild: 'obedient' })
    await data.fakes.hold('grand-live.grandchild')
    const done = await api.run('grand-live', TOKEN_A)
    assert.equal(done.status, 'done')
    const member = Number(await readFile(join(data.root, 'grandchild-grand-live'), 'utf8'))
    assert.equal(alive(member), false, 'the member left behind was stopped before the job finished')
    await data.fakes.release('grand-live.grandchild')
  })

  test('a stop that cannot see the command\'s output close still ends within a bound', async () => {
    await data.fakes.stage('pipe-hold', [SYN_PASS], { pipeHolder: true })
    await data.fakes.hold('pipe-hold')
    const id = (await (await api.start('pipe-hold', TOKEN_A)).json()).generation_id
    await api.job('pipe-hold', id, TOKEN_A, (s) => s === 'running')
    await appears(join(data.root, 'stray-pipe-hold'))
    const began = Date.now()
    assert.equal((await api.remove('pipe-hold', TOKEN_A)).status, 204)
    assert.ok(Date.now() - began < 15000, `DELETE took ${Date.now() - began} ms`)
    await data.fakes.release('pipe-hold')
  })

  test('needs_generation looks at every class the job composes, and is false while a job is open', async () => {
    const old: StagedClass = { bulletin: 'VTSE41-202611050000-0000000000d5', level: 5, outcome: 'pass', issued_at: '2026-11-05T00:00:00+09:00' }
    await writeExistingScreens(data.dataDir, 'alpha-comp', [old])
    await sleep(20)
    await data.writeSite('alpha-comp', 'alpha-fac', PREPARED, new Date().toISOString(), 35.9)
    await data.fakes.stage('alpha-comp', [SYN_PASS], { composable: [classOf(SYN_PASS), classOf(old)] })
    assert.equal((await api.run('alpha-comp', TOKEN_A)).status, 'done')
    const state = await api.state('alpha-comp')
    assert.equal(byClass(state)[classOf(old)].stale, true)
    assert.equal(state.needs_generation, true, 'a composable class left stale, though the last result did not list it')
    await data.fakes.hold('alpha-comp')
    const open = (await (await api.start('alpha-comp', TOKEN_A)).json()).generation_id
    await api.job('alpha-comp', open, TOKEN_A, (s) => s === 'running')
    assert.equal((await api.state('alpha-comp')).needs_generation, false)
    await data.fakes.release('alpha-comp')
    await api.job('alpha-comp', open, TOKEN_A)
  })

  test('unchanged is left out while the latest job has not recorded the screens it started from', async () => {
    await data.fakes.stage('alpha-open', [SYN_PASS])
    assert.equal((await api.run('alpha-open', TOKEN_A)).status, 'done')
    assert.equal(byClass(await api.state('alpha-open'))[classOf(SYN_PASS)].unchanged, false)
    await data.fakes.stage('alpha-two', [SYN_PASS])
    await data.fakes.hold('alpha-two')
    const blocker = (await (await api.start('alpha-two', TOKEN_A)).json()).generation_id
    await api.job('alpha-two', blocker, TOKEN_A, (s) => s === 'running')
    const queued = (await (await api.start('alpha-open', OPERATOR_TOKEN)).json()).generation_id
    assert.equal('unchanged' in byClass(await api.state('alpha-open'))[classOf(SYN_PASS)], false)
    await data.fakes.release('alpha-two')
    await api.job('alpha-two', blocker, TOKEN_A)
    await api.job('alpha-open', queued, OPERATOR_TOKEN)
  })

  async function approveForExport(site: string, spec: StagedClass) {
    await writeExistingScreens(data.dataDir, site, [spec])
    assert.equal((await postJson(base, '/api/admin/approve', { site_id: site, bulletin_id: spec.bulletin, approved: true }, bearer(TOKEN_A))).status, 200)
    assert.equal((await postJson(base, '/api/admin/site', { site_id: site, auto_publish: true }, bearer(TOKEN_A))).status, 200)
  }

  test('an export running when its site is deleted is stopped before anything is removed, and writes nothing for the next owner', async () => {
    await data.fakes.hold('exp-del.export')
    await approveForExport('exp-del', REAL_PASS)
    await appears(join(data.root, 'pid-export-exp-del'))
    const pid = Number(await readFile(join(data.root, 'pid-export-exp-del'), 'utf8'))
    assert.equal((await api.remove('exp-del', TOKEN_A)).status, 204)
    assert.equal(alive(pid), false, 'the export is gone when DELETE answers')
    assert.ok(existsSync(join(data.root, 'term-export-exp-del')))
    await data.writeSite('exp-del', 'beta-fac')
    await data.fakes.release('exp-del.export')
    await sleep(500)
    assert.ok(!existsSync(join(data.distDir, 'exp-del')))
  })

  test('a failed export tells the facility a fixed reason, never the paths or variables the command printed', async () => {
    const leak = '[export stopped] /Users/someone/private/chrome: API_TOKEN=abc123'
    await data.fakes.stage('exp-fail', [], { exportFail: leak })
    await approveForExport('exp-fail', REAL_PASS)
    let failed: any[] = []
    await until(async () => (failed = (await api.state('exp-fail', TOKEN_A)).exports.failed).length > 0, 'the export never failed')
    assert.equal(failed[0].bulletin_id, REAL_PASS.bulletin)
    const answers = [JSON.stringify(await api.state('exp-fail', TOKEN_A)), await readFile(join(data.dataDir, 'live', 'exp-fail.export.json'), 'utf8')]
    for (const text of answers) for (const secret of ['/Users/someone', 'API_TOKEN=abc123']) assert.ok(!text.includes(secret), `${secret} in ${text}`)
  })

  test('DELETE removes the job record and the previews of a finished job', async () => {
    await data.fakes.stage('del-done', [SYN_PASS])
    await api.run('del-done', TOKEN_A)
    assert.ok(existsSync(join(data.dataDir, 'previews', 'del-done')))
    assert.equal((await api.remove('del-done', TOKEN_A)).status, 204)
    assert.ok(!existsSync(join(data.dataDir, 'previews', 'del-done')))
    assert.ok(!existsSync(join(data.dataDir, 'live', 'del-done.generation.json')))
  })

  test('a site deleted while its previews render and taken by another facility gets nothing of the old job', async () => {
    await data.fakes.stage('del-reborn', [SYN_PASS])
    await data.fakes.hold('del-reborn.preview')
    const id = (await (await api.start('del-reborn', TOKEN_A)).json()).generation_id
    await appears(join(data.root, 'pid-preview-del-reborn'))
    assert.equal((await api.remove('del-reborn', TOKEN_A)).status, 204)
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

describe('generation limits', { skip }, () => {
  let base = ''
  let child: ChildProcess | undefined
  let data: Awaited<ReturnType<typeof makeData>>
  const api = client(() => base)

  before(async () => {
    data = await makeData()
    for (let n = 1; n <= 6; n++) {
      await data.writeSite(`gamma-${n}`, 'gamma-fac')
      await data.fakes.stage(`gamma-${n}`, [SYN_PASS])
    }
    ;({ base, child } = await startServer({ ...data.env, NUXT_GENERATIONS_PER_HOUR: '2', NUXT_GENERATION_OPEN_JOBS_PER_FACILITY: '100' }))
  })
  after(async () => {
    child?.kill()
    await sleep(300)
    await rm(data.root, { recursive: true, force: true })
  })

  test('starts of one facility at the same moment on different sites never pass the hourly limit', async () => {
    const answers = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => api.start(`gamma-${n}`, TOKEN_C)))
    assert.equal(answers.filter((r) => r.status === 202).length, 2)
    for (const refused of answers.filter((r) => r.status !== 202)) {
      assert.equal(refused.status, 429)
      assert.equal((await refused.json()).data.code, 'generation-rate-limited')
      const retry = Number(refused.headers.get('retry-after'))
      assert.ok(Number.isInteger(retry) && retry > 0 && retry <= 3600, String(retry))
    }
  })
})

describe('generation jobs across server stops', { skip }, () => {
  let base = ''
  let child: ChildProcess | undefined
  let data: Awaited<ReturnType<typeof makeData>>
  const api = client(() => base)
  const stray: ChildProcess[] = []
  const geocoder = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ results: { muniCd: PREPARED, lv01Nm: 'test' } }))
  })
  let geocoderUrl = ''

  before(async () => {
    await new Promise<void>((resolve) => geocoder.listen(0, '127.0.0.1', resolve))
    geocoderUrl = `http://127.0.0.1:${(geocoder.address() as { port: number }).port}/reverse-geocoder/LonLatToAddress`
    data = await makeData()
    for (let n = 1; n <= 7; n++) {
      await data.writeSite(`gamma-${n}`, 'gamma-fac')
      await data.fakes.stage(`gamma-${n}`, [SYN_PASS])
    }
    for (const id of ['alpha-a', 'alpha-b', 'alpha-c', 'stop-term', 'stop-kill', 'stop-foreign', 'stop-grand', 'stop-late', 'stop-orphan']) {
      await data.writeSite(id, 'alpha-fac')
      await data.fakes.stage(id, [SYN_PASS])
    }
    ;({ base, child } = await startServer({ ...data.env, NUXT_REVERSE_GEOCODER_URL: geocoderUrl }))
  })
  after(async () => {
    child?.kill()
    for (const leftover of stray) leftover.kill('SIGKILL')
    await new Promise((resolve) => geocoder.close(resolve))
    await rm(join(data.root, 'hold'), { recursive: true, force: true })
    await sleep(300)
    await rm(data.root, { recursive: true, force: true })
  })

  async function stopServer(signal: NodeJS.Signals = 'SIGTERM') {
    const stopped = new Promise((resolve) => child!.once('exit', resolve))
    child!.kill(signal)
    await stopped
  }

  async function restart(env: Record<string, string> = {}, signal: NodeJS.Signals = 'SIGTERM') {
    await stopServer(signal)
    ;({ base, child } = await startServer({ ...data.env, NUXT_REVERSE_GEOCODER_URL: geocoderUrl, ...env }))
  }

  async function writeRunningRecord(site: string, child: { pgid: number; started_at: number; match: string[] }) {
    const now = new Date().toISOString()
    const record = { site_id: site, latest: { generation_id: 'f0f0f0f0f0f0f0f0', site_id: site, status: 'running', created_at: now, started_at: now, started_by: { token_label: 'operator' }, classes: [], child } }
    await mkdir(join(data.dataDir, 'live'), { recursive: true })
    await writeFile(join(data.dataDir, 'live', `${site}.generation.json`), JSON.stringify(record))
  }

  const standIn = (args: string[]) => {
    const stand = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', '--', ...args], { detached: true, stdio: 'ignore' })
    stray.push(stand)
    return stand
  }

  test('a facility has at most two jobs unfinished; a third waits its turn as 429', async () => {
    await data.fakes.hold('alpha-a')
    const first = await (await api.start('alpha-a', TOKEN_A)).json()
    const second = await (await api.start('alpha-b', TOKEN_A)).json()
    const third = await api.start('alpha-c', TOKEN_A)
    assert.equal(third.status, 429)
    const limited = await third.json()
    assert.equal(limited.data.code, 'generation-rate-limited')
    assert.ok(Number(third.headers.get('retry-after')) > 0)
    const running = await (await api.start('alpha-a', TOKEN_A)).json()
    assert.equal(running.data.code, 'generation-running')
    assert.deepEqual(Object.keys(limited).sort(), Object.keys(running).sort(), 'the same fields as another 4xx')
    await data.fakes.release('alpha-a')
    await api.job('alpha-a', first.generation_id, TOKEN_A)
    await api.job('alpha-b', second.generation_id, TOKEN_A)
    assert.equal((await api.run('alpha-c', TOKEN_A)).status, 'done')
  })

  test('a facility may start six jobs an hour over all its sites; the operator is counted per site', async () => {
    for (let n = 1; n <= 6; n++) assert.equal((await api.run(`gamma-${n}`, TOKEN_C)).status, 'done')
    const limited = await api.start('gamma-7', TOKEN_C)
    assert.equal(limited.status, 429)
    assert.equal((await limited.json()).data.code, 'generation-rate-limited')
    assert.equal((await api.run('gamma-7', OPERATOR_TOKEN)).status, 'done')
  })

  test('a server that is stopped asks its running child to stop and the record reads failed after the restart', async () => {
    await data.fakes.hold('stop-term')
    const id = (await (await api.start('stop-term', OPERATOR_TOKEN)).json()).generation_id
    await api.job('stop-term', id, OPERATOR_TOKEN, (s) => s === 'running')
    await appears(join(data.root, 'pid-stop-term'))
    const pid = Number(await readFile(join(data.root, 'pid-stop-term'), 'utf8'))
    await restart()
    assert.equal(alive(pid), false)
    assert.ok(existsSync(join(data.root, 'term-stop-term')))
    const job = await (await api.get(`/api/admin/sites/stop-term/generations/${id}`, OPERATOR_TOKEN)).json()
    assert.equal(job.status, 'failed')
    assert.equal(job.error_code, 'server-restarted')
    assert.equal((await api.state('stop-term')).last_generation.status, 'failed')
  })

  test('a child left by a server killed outright is stopped after the restart, and the site takes jobs again', async () => {
    await data.fakes.hold('stop-kill')
    const id = (await (await api.start('stop-kill', OPERATOR_TOKEN)).json()).generation_id
    await api.job('stop-kill', id, OPERATOR_TOKEN, (s) => s === 'running')
    await appears(join(data.root, 'pid-stop-kill'))
    const pid = Number(await readFile(join(data.root, 'pid-stop-kill'), 'utf8'))
    await restart({}, 'SIGKILL')
    await until(() => !alive(pid), 'the child of the killed server is still running')
    const job = await (await api.get(`/api/admin/sites/stop-kill/generations/${id}`, OPERATOR_TOKEN)).json()
    assert.equal(job.status, 'failed')
    assert.equal(job.error_code, 'server-restarted')
    await data.fakes.release('stop-kill')
    assert.equal((await api.run('stop-kill', OPERATOR_TOKEN)).status, 'done')
  })

  test('a recorded process group whose command line is not the job\'s is someone else\'s: it is left running and does not hold the site', async () => {
    const foreign = standIn([])
    await writeRunningRecord('stop-foreign', { pgid: foreign.pid!, started_at: Date.now(), match: ['--site=stop-foreign'] })
    await restart()
    const job = await (await api.get('/api/admin/sites/stop-foreign/generations/f0f0f0f0f0f0f0f0', OPERATOR_TOKEN)).json()
    assert.equal(job.status, 'failed')
    assert.equal(alive(foreign.pid!), true, 'a process whose command line is not the job\'s is not stopped')
    assert.equal((await api.run('stop-foreign', OPERATOR_TOKEN)).status, 'done')
    foreign.kill('SIGKILL')
  })

  test('a recorded process group that started at another time is someone else\'s, whatever its command line', async () => {
    const late = standIn(['--site=stop-late', '--writer=live'])
    await writeRunningRecord('stop-late', { pgid: late.pid!, started_at: Date.now() - 3600_000, match: ['--site=stop-late', '--writer=live'] })
    await restart()
    assert.equal((await (await api.get('/api/admin/sites/stop-late/generations/f0f0f0f0f0f0f0f0', OPERATOR_TOKEN)).json()).status, 'failed')
    assert.equal(alive(late.pid!), true)
    assert.equal((await api.run('stop-late', OPERATOR_TOKEN)).status, 'done')
    late.kill('SIGKILL')
  })

  test('a group whose leader ended while a member runs on is matched by the member, and nothing goes on until the member ends', async () => {
    await data.fakes.stage('stop-grand', [SYN_PASS], { grandchild: 'stubborn' })
    await data.fakes.hold('stop-grand')
    await data.fakes.hold('stop-grand.grandchild')
    const id = (await (await api.start('stop-grand', OPERATOR_TOKEN)).json()).generation_id
    await api.job('stop-grand', id, OPERATOR_TOKEN, (s) => s === 'running')
    await appears(join(data.root, 'pid-stop-grand'))
    const leader = Number(await readFile(join(data.root, 'pid-stop-grand'), 'utf8'))
    await stopServer('SIGKILL')
    await data.fakes.release('stop-grand')
    await appears(join(data.root, 'grandchild-stop-grand'))
    const member = Number(await readFile(join(data.root, 'grandchild-stop-grand'), 'utf8'))
    await until(() => !alive(leader), 'the leader did not end')
    ;({ base, child } = await startServer({ ...data.env, NUXT_REVERSE_GEOCODER_URL: geocoderUrl }))
    const job = await (await api.get(`/api/admin/sites/stop-grand/generations/${id}`, OPERATOR_TOKEN)).json()
    assert.equal(job.error_code, 'server-restarted')
    assert.equal(alive(member), false, 'the record reads failed only once the member has ended')
    await data.fakes.release('stop-grand.grandchild')
    assert.equal((await api.run('stop-grand', OPERATOR_TOKEN)).status, 'done')
  })

  test('a child that cannot be checked outlives a DELETE of its site: the id is neither registered nor composed again until it ends', async () => {
    const orphan = standIn(['--site=stop-orphan', '--writer=live'])
    await writeRunningRecord('stop-orphan', { pgid: orphan.pid!, started_at: Date.now(), match: ['--site=stop-orphan', '--writer=live'] })
    await restart({ PATH: dirname(process.execPath) })
    assert.equal((await (await api.get('/api/admin/sites/stop-orphan/generations/f0f0f0f0f0f0f0f0', OPERATOR_TOKEN)).json()).status, 'failed')
    assert.equal(alive(orphan.pid!), true, 'without ps nothing is confirmed, so nothing is stopped')
    const running = await api.start('stop-orphan', TOKEN_A)
    assert.equal(running.status, 409)
    assert.equal((await running.json()).data.code, 'generation-running')
    assert.equal((await api.remove('stop-orphan', TOKEN_A)).status, 204)
    const put = (token: string) => fetch(`${base}/api/admin/sites/stop-orphan`, { method: 'PUT', headers: { 'content-type': 'application/json', ...bearer(token) }, body: JSON.stringify({ lat: 35.68, lng: 139.76, facing_deg: 90 }) })
    for (const [token, code] of [[OPERATOR_TOKEN, 'site-busy'], [TOKEN_A, 'site-busy'], [TOKEN_B, 'site-id-taken']] as const) {
      const refused = await put(token)
      assert.equal(refused.status, 409, token)
      assert.equal((await refused.json()).data.code, code, token)
    }
    orphan.kill('SIGKILL')
    await until(() => !alive(orphan.pid!), 'the stand-in process did not end')
    assert.equal((await put(TOKEN_A)).status, 201)
    await data.fakes.stage('stop-orphan', [SYN_PASS])
    assert.equal((await api.run('stop-orphan', TOKEN_A)).status, 'done')
  })

  test('with the command off, a start answers generation-disabled', async () => {
    await restart({ NUXT_GENERATE_COMMAND: 'off' })
    const response = await api.start('gamma-2', OPERATOR_TOKEN)
    assert.equal(response.status, 503)
    assert.equal((await response.json()).data.code, 'generation-disabled')
  })
})
