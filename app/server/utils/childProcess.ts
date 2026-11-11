import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export type AgentPurpose = 'generate' | 'preview' | 'export'

export interface ChildResult {
  ok: boolean
  timedOut: boolean
  output: string
}

export interface ChildRun {
  pid: number | undefined
  startedAt: number
  done: Promise<ChildResult>
  stop: () => Promise<ChildResult>
}

const STOP_GRACE_MS = 5000
const CHROME_PID_FILE = /^(\d+)\n?$/
const SHARED_ENV = new Set(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LANGUAGE', 'TZ', 'CHROME_PATH'])
const SHARED_ENV_PREFIXES = ['LC_', 'EVAC_', 'JMA_']
const PURPOSE_ENV: Record<AgentPurpose, readonly string[]> = { generate: ['ANTHROPIC_API_KEY'], preview: [], export: [] }

const running = new Set<ChildRun>()
let shuttingDown = false

export function configuredCommand(value: unknown): string[] {
  const command = String(value ?? '').split(/\s+/).filter(Boolean)
  return command[0] === 'off' ? [] : command
}

// The server's own settings (NUXT_*, credentials) are never the agents' business; only the Writer needs the API key.
export function agentEnv(purpose: AgentPurpose, source: NodeJS.ProcessEnv, dataDirPath: string): NodeJS.ProcessEnv {
  const allowed = (name: string) => SHARED_ENV.has(name) || SHARED_ENV_PREFIXES.some((prefix) => name.startsWith(prefix)) || PURPOSE_ENV[purpose].includes(name)
  return { ...Object.fromEntries(Object.entries(source).filter(([name]) => allowed(name))), EVAC_DATA_DIR: dataDirPath }
}

export function signalGroup(pgid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pgid, signal)
    return true
  } catch {
    return false
  }
}

export function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function isShuttingDown(): boolean {
  return shuttingDown
}

export async function stopAllChildren(): Promise<void> {
  shuttingDown = true
  await Promise.all([...running].map((child) => child.stop()))
}

// The command reports the Chrome it started in a file only it and the server know. Even so, the pid is stopped only
// when it leads its own process group and descends from the command, so a wrong number cannot reach anyone else.
async function chromeOf(child: number, pidFile: string): Promise<number | undefined> {
  let text: string
  try {
    text = readFileSync(pidFile, 'utf8')
  } catch {
    return undefined
  }
  const pid = Number(CHROME_PID_FILE.exec(text)?.[1])
  if (Number.isSafeInteger(pid) && pid > 1 && (await leadsGroupBelow(pid, child))) return pid
  console.warn(`[agents] the Chrome pid a command reported is not one of its own processes; it is left alone`)
  return undefined
}

export function runAgentCommand(command: string[], args: string[], options: { purpose: AgentPurpose; timeoutMs: number; tailChars: number }): ChildRun {
  const workDir = mkdtempSync(join(tmpdir(), 'evac-agent-'))
  const pidFile = join(workDir, 'chrome.pid')
  // Its own process group, so stopping it reaches the pnpm, tsx and node processes it starts.
  const child = spawn(command[0]!, [...command.slice(1), ...args], {
    cwd: useRuntimeConfig().repoRoot,
    env: { ...agentEnv(options.purpose, process.env, resolve(dataDir())), EVAC_CHROME_PID_FILE: pidFile },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  let output = ''
  let timedOut = false
  let exited = false
  const collect = (chunk: string) => (output = (output + chunk).slice(-options.tailChars))
  child.stdout.setEncoding('utf8').on('data', collect)
  child.stderr.setEncoding('utf8').on('data', collect)
  const done = new Promise<ChildResult>((settle) => {
    const finish = (ok: boolean, message: string) => {
      exited = true
      clearTimeout(timer)
      settle({ ok, timedOut, output: message.trim().slice(-options.tailChars) })
    }
    child.on('error', (error) => finish(false, error.message))
    child.on('close', (code) => finish(code === 0 && !timedOut, timedOut ? `${output}\ntimed out after ${options.timeoutMs / 1000} s` : output))
  })
  let stopping: Promise<ChildResult> | undefined
  const stop = () => {
    stopping ??= (async () => {
      let chrome: number | undefined
      if (!exited && child.pid) {
        chrome = await chromeOf(child.pid, pidFile)
        signalGroup(child.pid, 'SIGTERM')
        const hard = setTimeout(() => signalGroup(child.pid!, 'SIGKILL'), STOP_GRACE_MS)
        await done
        clearTimeout(hard)
      }
      if (chrome) signalGroup(chrome, 'SIGKILL')
      return done
    })()
    return stopping
  }
  const timer = setTimeout(() => {
    timedOut = true
    void stop()
  }, Math.max(0, options.timeoutMs))
  const run: ChildRun = { pid: child.pid, startedAt: Date.now(), done, stop }
  running.add(run)
  void done.finally(() => {
    running.delete(run)
    rmSync(workDir, { recursive: true, force: true })
  })
  return run
}
