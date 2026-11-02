import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

export function assertDev() {
  if (!import.meta.dev) throw createError({ status: 404, statusText: 'Not Found' })
}

export function dataDir(): string {
  const config = useRuntimeConfig()
  return config.dataDir || join(config.repoRoot, 'data')
}

export async function readJsonIfExists<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export async function listDir(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}
