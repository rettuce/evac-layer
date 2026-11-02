import { readFile } from 'node:fs/promises'

export default defineEventHandler(async (event) => {
  if (!import.meta.dev) throw createError({ status: 404, statusText: 'Not Found' })
  const check = await checkRepoJsonPath(getQuery(event).file, useRuntimeConfig().repoRoot)
  if (!check.ok) throw createError({ status: check.status, message: check.message })
  return JSON.parse(await readFile(check.resolved, 'utf8'))
})
