import { readFile, realpath } from 'node:fs/promises'
import { extname, isAbsolute, sep } from 'node:path'

// Dev-only bridge so the Verifier can render Composer output straight from disk.
// The repo root also holds .env, so only .json files under it are served.
export default defineEventHandler(async (event) => {
  if (!import.meta.dev) throw createError({ status: 404, statusText: 'Not Found' })

  const file = getQuery(event).file
  if (typeof file !== 'string' || !isAbsolute(file) || extname(file) !== '.json') {
    throw createError({ status: 403, statusText: 'Forbidden', message: 'file must be an absolute path to a .json file' })
  }

  const repoRoot = await realpath(useRuntimeConfig().repoRoot)
  const resolved = await realpath(file).catch(() => undefined)
  if (!resolved) throw createError({ status: 404, statusText: 'Not Found', message: `no such file: ${file}` })
  if (!resolved.startsWith(repoRoot + sep) || extname(resolved) !== '.json') {
    throw createError({ status: 403, statusText: 'Forbidden', message: 'file must be inside the repository' })
  }

  return JSON.parse(await readFile(resolved, 'utf8'))
})
