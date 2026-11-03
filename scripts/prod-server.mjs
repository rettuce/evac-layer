import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

async function freePort() {
  return new Promise((resolve) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

export async function startServer() {
  const port = await freePort()
  const child = spawn(process.execPath, [`${ROOT}app/.output/server/index.mjs`], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NUXT_ADMIN_TOKEN: '' },
    stdio: 'ignore',
  })
  const base = `http://127.0.0.1:${port}`
  for (let i = 0; i < 100; i++) {
    if (await fetch(`${base}/screen`).then((r) => r.ok, () => false)) return { base, child }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  child.kill()
  throw new Error(`production server did not start on ${base}`)
}
