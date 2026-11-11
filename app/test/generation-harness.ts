import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type StagedClass, makeFakes } from './generation-fakes.ts'
import { postJson } from './helpers.ts'

export const OPERATOR_TOKEN = 'operator-token-for-generation-tests'
export const TOKEN_A = 'facility-a-token-for-generation-tests'
export const TOKEN_B = 'facility-b-token-for-generation-tests'
export const TOKEN_C = 'facility-c-token-for-generation-tests'
export const API_KEY = 'sk-ant-api-key-for-generation-tests-0000000000'
export const SECRET_SAMPLE = 'a-secret-the-children-must-not-see'
export const ALL_SECRETS = [OPERATOR_TOKEN, TOKEN_A, TOKEN_B, TOKEN_C, SECRET_SAMPLE]
// macOS adds __CF_USER_TEXT_ENCODING to every process it starts, whatever environment the parent passed.
export const SHARED_ENV = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LANGUAGE', 'TZ', 'LC_ALL', 'LC_CTYPE', 'LC_MESSAGES', 'LC_COLLATE', 'LC_NUMERIC', 'LC_TIME', 'LC_MONETARY', 'CHROME_PATH', 'EVAC_DATA_DIR', 'EVAC_RAW_DIR', 'EVAC_URL', 'JMA_FEED_DIR', 'JMA_SAMPLES_DIR', 'EVAC_CHROME_PID_FILE', '__CF_USER_TEXT_ENCODING']
export const GENERATE_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS']
export const PREPARED = '13101'
export const NOT_PREPARED = '13102'
export const WAIT_MS = 15000

export const sha256 = (token: string) => createHash('sha256').update(token).digest('hex')
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
export const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function until(done: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + WAIT_MS
  while (!(await done())) {
    if (Date.now() > deadline) assert.fail(label)
    await sleep(20)
  }
}

export const appears = (file: string) => until(() => existsSync(file), `${file} never appeared`)

export const TOKENS_FILE = {
  version: '0.1',
  tokens: [
    { id: 'tok-a', label: 'alpha signage', facility_id: 'alpha-fac', sha256: sha256(TOKEN_A), created_at: '2026-11-01T00:00:00Z' },
    { id: 'tok-b', label: 'beta signage', facility_id: 'beta-fac', sha256: sha256(TOKEN_B), created_at: '2026-11-01T00:00:00Z' },
    { id: 'tok-c', label: 'gamma signage', facility_id: 'gamma-fac', sha256: sha256(TOKEN_C), created_at: '2026-11-01T00:00:00Z' },
  ],
}

export const SYN_PASS: StagedClass = { bulletin: 'SYN-VTSE41-202611010000-0000000000a1', level: 3, outcome: 'pass' }
export const SYN_FAIL: StagedClass = { bulletin: 'SYN-VTSE41-202611010000-0000000000a2', level: 4, outcome: 'fail' }
export const REAL_PASS: StagedClass = { bulletin: 'VTSE41-202611010000-0000000000a3', level: 5, outcome: 'pass' }

export async function makeData() {
  const root = await mkdtemp(join(tmpdir(), 'evac-generations-'))
  const dataDir = join(root, 'data')
  const distDir = join(root, 'dist')
  await mkdir(join(dataDir, 'sites'), { recursive: true })
  await mkdir(join(dataDir, 'municipalities'), { recursive: true })
  await writeFile(join(dataDir, 'municipalities', `${PREPARED}.json`), '{}')
  await writeFile(join(dataDir, 'tokens.json'), JSON.stringify(TOKENS_FILE), { mode: 0o600 })
  const fakes = await makeFakes(root)
  const writeSite = (id: string, facility?: string, municipality = PREPARED, located = '2026-11-01T00:00:00.000Z', lat = 35.68) =>
    writeFile(join(dataDir, 'sites', `${id}.json`), JSON.stringify({ id, municipality_id: municipality, lat, lng: 139.76, facing_deg: 90, ...(facility ? { facility_id: facility } : {}), location_updated_at: located }))
  const env = { NUXT_DATA_DIR: dataDir, NUXT_DIST_DIR: distDir, NUXT_ADMIN_TOKEN: OPERATOR_TOKEN, NUXT_GENERATE_COMMAND: fakes.generate, NUXT_PREVIEW_COMMAND: fakes.preview, NUXT_EXPORT_COMMAND: fakes.exporter, ANTHROPIC_API_KEY: API_KEY, ANTHROPIC_BASE_URL: 'http://127.0.0.1:9', SECRET_SAMPLE, EVAC_UNLISTED_SETTING: SECRET_SAMPLE }
  return { root, dataDir, distDir, fakes, writeSite, env }
}

export function client(baseOf: () => string) {
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
  const remove = (site: string, token: string) => fetch(`${baseOf()}/api/admin/sites/${site}`, { method: 'DELETE', headers: bearer(token) })
  return { start, get, job, run, state, remove }
}

export const previewPath = (site: string, bulletin: string, shape: string) => `/api/admin/sites/${site}/previews/${bulletin}/${shape}.png`
export const byClass = (state: any) => Object.fromEntries(state.classes.map((c: any) => [c.class, c]))
