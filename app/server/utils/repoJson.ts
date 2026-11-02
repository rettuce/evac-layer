import { realpath } from 'node:fs/promises'
import { extname, isAbsolute, sep } from 'node:path'

const SERVABLE_EXTENSION = '.json'

export type RepoJsonCheck = { ok: true; resolved: string } | { ok: false; status: 403 | 404; message: string }

export async function checkRepoJsonPath(file: unknown, repoRoot: string): Promise<RepoJsonCheck> {
  if (typeof file !== 'string' || !isAbsolute(file) || extname(file) !== SERVABLE_EXTENSION) {
    return { ok: false, status: 403, message: 'file must be an absolute path to a .json file' }
  }
  const root = await realpath(repoRoot)
  const resolved = await realpath(file).catch(() => undefined)
  if (!resolved) return { ok: false, status: 404, message: `no such file: ${file}` }
  if (!resolved.startsWith(root + sep) || extname(resolved) !== SERVABLE_EXTENSION) {
    return { ok: false, status: 403, message: 'file must be inside the repository' }
  }
  return { ok: true, resolved }
}
