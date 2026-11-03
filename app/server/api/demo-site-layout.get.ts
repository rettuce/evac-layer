import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDemoSitePath } from '~~/layout/trust'

export default defineEventHandler(async (event) => {
  const path = getQuery(event).path
  if (!isDemoSitePath(path)) throw createError({ status: 400, message: 'path must be a relative demo/sites/**/*.json path' })
  const repoRoot = useRuntimeConfig().repoRoot
  const check = await checkRepoJsonPath(join(repoRoot, path), join(repoRoot, 'demo', 'sites'))
  if (!check.ok) throw createError({ status: check.status, message: check.status === 404 ? `no such demo site layout: ${path}` : 'path must stay inside demo/sites' })
  return JSON.parse(await readFile(check.resolved, 'utf8'))
})
