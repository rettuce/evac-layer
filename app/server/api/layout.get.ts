import { readFile, realpath } from 'node:fs/promises'
import { extname, isAbsolute, sep } from 'node:path'

const SERVABLE_EXTENSION = '.json'

export default defineEventHandler(async (event) => {
  if (!import.meta.dev) throw createError({ status: 404, statusText: 'Not Found' })

  const file = getQuery(event).file
  if (typeof file !== 'string' || !isAbsolute(file) || extname(file) !== SERVABLE_EXTENSION) {
    throw createError({ status: 403, statusText: 'Forbidden', message: 'file must be an absolute path to a .json file' })
  }

  const repoRoot = await realpath(useRuntimeConfig().repoRoot)
  const resolved = await realpath(file).catch(() => undefined)
  if (!resolved) throw createError({ status: 404, statusText: 'Not Found', message: `no such file: ${file}` })
  if (!resolved.startsWith(repoRoot + sep) || extname(resolved) !== SERVABLE_EXTENSION) {
    throw createError({ status: 403, statusText: 'Forbidden', message: 'file must be inside the repository' })
  }

  return JSON.parse(await readFile(resolved, 'utf8'))
})
