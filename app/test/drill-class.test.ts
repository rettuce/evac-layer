import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { REPO_ROOT, SERVER_ENTRY, postJson, startServer } from './helpers.ts'

const DRILL_SITE = '22424-demo'
const DRILL = 'VTSE41-201609010713-ff3dd5d5c94f'
const NORMAL_SITE = '15205-demo'
const NORMAL = 'VPWW56-202610311653-b3fa1b3a2ced'

const skip = !existsSync(SERVER_ENTRY) && 'run `pnpm -F app build` first'

async function makeData(): Promise<string> {
  const dataDir = join(await mkdtemp(join(tmpdir(), 'evac-drill-class-')), 'data')
  await mkdir(join(dataDir, 'sites'), { recursive: true })
  for (const [site, bulletin] of [[DRILL_SITE, DRILL], [NORMAL_SITE, NORMAL]] as const) {
    await cp(join(REPO_ROOT, 'data', 'sites', `${site}.json`), join(dataDir, 'sites', `${site}.json`))
    await cp(join(REPO_ROOT, 'data', 'layouts', site, bulletin), join(dataDir, 'layouts', site, bulletin), { recursive: true })
    await cp(join(REPO_ROOT, 'data', 'layouts', site, 'index.json'), join(dataDir, 'layouts', site, 'index.json'))
    await cp(join(REPO_ROOT, 'data', 'reports', site, bulletin), join(dataDir, 'reports', site, bulletin), { recursive: true })
  }
  return dataDir
}

describe('drill bulletins and class approvals', { skip }, () => {
  let base = ''
  let child: ChildProcess | undefined
  let dataDir = ''

  before(async () => {
    dataDir = await makeData()
    ;({ base, child } = await startServer({ NUXT_DATA_DIR: dataDir, NUXT_ADMIN_TOKEN: '' }))
  })
  after(() => {
    child?.kill()
  })

  test('approving a drill bulletin approves that bulletin only and writes no class approval', async () => {
    const response = await postJson(base, '/api/admin/approve', { site_id: DRILL_SITE, bulletin_id: DRILL, approved: true })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.class, 'tsunami/evac-now/4/drill')
    assert.equal(body.class_approval, undefined)
    const approvals = JSON.parse(await readFile(join(dataDir, 'approvals.json'), 'utf8'))
    assert.equal(approvals.layouts[`${DRILL_SITE}/${DRILL}`].approved, true)
    assert.deepEqual(Object.keys(approvals.classes).filter((key) => key.startsWith(`${DRILL_SITE}/`)), [])
  })

  test('approving a normal bulletin still writes its class approval', async () => {
    const body = await (await postJson(base, '/api/admin/approve', { site_id: NORMAL_SITE, bulletin_id: NORMAL, approved: true })).json()
    assert.equal(body.class, 'landslide/evac-now/4')
    assert.equal(body.class_approval.approved_from, NORMAL)
  })

  test('a drill bulletin approved on its own is still shown when it is posted, as the bundled demos do', async () => {
    assert.equal((await postJson(base, '/api/admin/site', { site_id: DRILL_SITE, auto_publish: true })).status, 200)
    assert.equal((await postJson(base, '/api/admin/live', { site_id: DRILL_SITE, bulletin_id: DRILL })).status, 200)
    const feed = await (await fetch(`${base}/api/feed/${DRILL_SITE}`)).json()
    assert.equal(feed.state, 'alert')
    assert.equal(feed.bulletin_id, DRILL)
  })
})
