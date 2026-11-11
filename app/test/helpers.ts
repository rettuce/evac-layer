import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const APP_DIR = fileURLToPath(new URL('..', import.meta.url))
export const REPO_ROOT = join(APP_DIR, '..')
export const SERVER_ENTRY = join(APP_DIR, '.output', 'server', 'index.mjs')
const READY_TIMEOUT_MS = 20000

export async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      server.close(() => resolve(port))
    })
  })
}

export async function startServer(env: Record<string, string>, fixedPort?: number, output?: (text: string) => void): Promise<{ base: string; child: ChildProcess }> {
  const port = fixedPort ?? (await freePort())
  const child = spawn(process.execPath, [SERVER_ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NUXT_EXPORT_COMMAND: 'off', ...env }, stdio: output ? ['ignore', 'pipe', 'pipe'] : 'ignore' })
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', (chunk: Buffer) => output?.(chunk.toString('utf8')))
  const base = `http://127.0.0.1:${port}`
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    const up = await fetch(`${base}/screen`).then((r) => r.ok, () => false)
    if (up) return { base, child }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  child.kill()
  throw new Error(`production server did not start on ${base}`)
}

export function postJson(base: string, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
}
