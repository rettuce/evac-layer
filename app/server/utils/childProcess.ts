import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { readdir, rm, stat } from 'node:fs/promises'
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

export interface ChildOwner {
  site: string
  match: string[]
  generationId?: string
}

const STOP_GRACE_MS = 5000
const STOP_FINAL_MS = 2000
const POLL_MS = 200
const CHROME_WATCH_MS = 1000
const PID_LINE = /^\d+$/
const WORK_DIR_PREFIX = 'evac-agent-'
const SHARED_ENV = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LANGUAGE', 'TZ',
  'LC_ALL', 'LC_CTYPE', 'LC_MESSAGES', 'LC_COLLATE', 'LC_NUMERIC', 'LC_TIME', 'LC_MONETARY',
  'CHROME_PATH', 'EVAC_RAW_DIR', 'EVAC_URL', 'JMA_FEED_DIR', 'JMA_SAMPLES_DIR',
]
const PURPOSE_ENV: Record<AgentPurpose, readonly string[]> = {
  generate: ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS'],
  preview: [],
  export: [],
}

const running = new Map<ChildRun, ChildOwner | undefined>()
let shuttingDown = false

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function configuredCommand(value: unknown): string[] {
  const command = String(value ?? '').split(/\s+/).filter(Boolean)
  return command[0] === 'off' ? [] : command
}

// The server's own settings (NUXT_*, credentials) are never the agents' business; only the Writer needs the API ones.
export function agentEnv(purpose: AgentPurpose, source: NodeJS.ProcessEnv, dataDirPath: string): NodeJS.ProcessEnv {
  const names = [...SHARED_ENV, ...PURPOSE_ENV[purpose]]
  return { ...Object.fromEntries(names.flatMap((name) => (source[name] === undefined ? [] : [[name, source[name]]]))), EVAC_DATA_DIR: dataDirPath }
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
  await Promise.all([...running.keys()].map((child) => child.stop()))
}

export async function stopChildrenOf(site: string): Promise<void> {
  await Promise.all([...running].filter(([, owner]) => owner?.site === site).map(([child]) => child.stop()))
}

// A directory named after a server that is no longer running belongs to nobody.
export async function removeStaleWorkDirs(): Promise<void> {
  const uid = process.getuid?.()
  for (const name of await readdir(tmpdir()).catch(() => [] as string[])) {
    const owner = Number(/^evac-agent-(\d+)-/.exec(name)?.[1])
    if (!owner || owner === process.pid || processAlive(owner)) continue
    const dir = join(tmpdir(), name)
    if ((await stat(dir).catch(() => undefined))?.uid === uid) await rm(dir, { recursive: true, force: true })
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function refused(message: string): ChildRun {
  const done = Promise.resolve({ ok: false, timedOut: false, output: message })
  return { pid: undefined, startedAt: Date.now(), done, stop: () => done }
}

// The command reports each Chrome it starts in a file only it and the server know. A pid there is taken only while
// it leads its own process group below the command, and it is stopped only if the same process still holds it.
class ChromeWatch {
  private seen = new Set<string>()
  private file: string
  private child: number
  readonly verified = new Map<number, number>()

  constructor(file: string, child: number) {
    this.file = file
    this.child = child
  }

  async read(): Promise<void> {
    let lines: string[]
    try {
      lines = readFileSync(this.file, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean)
    } catch {
      return
    }
    const fresh = lines.filter((line) => !this.seen.has(line))
    if (!fresh.length) return
    const table = await processTable()
    for (const line of fresh) {
      this.seen.add(line)
      const pid = PID_LINE.test(line) ? Number(line) : NaN
      const chrome = table?.find((p) => p.pid === pid)
      if (!Number.isSafeInteger(pid) || pid <= 1 || (table && !chrome)) continue
      if (chrome && chrome.pgid === pid && descendsFrom(table!, pid, this.child)) this.verified.set(pid, chrome.startedAt)
      else console.warn('[agents] a Chrome pid a command reported is not one of its own processes; it is left alone')
    }
  }

  async stopAll(): Promise<void> {
    if (!this.verified.size) return
    const table = await processTable()
    for (const [pid, startedAt] of this.verified) {
      const now = table?.find((p) => p.pid === pid)
      if (now && now.pgid === pid && now.startedAt === startedAt) signalGroup(pid, 'SIGKILL')
    }
  }
}

export function runAgentCommand(command: string[], args: string[], options: { purpose: AgentPurpose; timeoutMs: number; tailChars: number; owner?: ChildOwner }): ChildRun {
  if (shuttingDown) return refused('the server is stopping')
  const workDir = mkdtempSync(join(tmpdir(), `${WORK_DIR_PREFIX}${process.pid}-`))
  const pidFile = join(workDir, 'chrome.pid')
  // Its own process group, so stopping it reaches the pnpm, tsx and node processes it starts.
  const child = spawn(command[0]!, [...command.slice(1), ...args], {
    cwd: useRuntimeConfig().repoRoot,
    env: { ...agentEnv(options.purpose, process.env, resolve(dataDir())), EVAC_CHROME_PID_FILE: pidFile },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  const pid = child.pid
  const startedAt = Date.now()
  const chromes = pid ? new ChromeWatch(pidFile, pid) : undefined
  let output = ''
  let timedOut = false
  let exitCode: number | null = null
  let spawnError: string | undefined
  let closed = false
  let markClosed: () => void = () => undefined
  const closing = new Promise<void>((settle) => {
    markClosed = () => {
      closed = true
      settle()
    }
  })
  const collect = (chunk: string) => (output = (output + chunk).slice(-options.tailChars))
  child.stdout.setEncoding('utf8').on('data', collect)
  child.stderr.setEncoding('utf8').on('data', collect)
  child.on('error', (error) => {
    spawnError = error.message
    markClosed()
  })
  child.on('close', (code) => {
    exitCode = code
    markClosed()
  })

  let terminating: Promise<void> | undefined
  const terminate = () =>
    (terminating ??= (async () => {
      if (!pid) return
      await chromes?.read()
      signalGroup(pid, 'SIGTERM')
      const graceEnd = Date.now() + STOP_GRACE_MS
      while (groupAlive(pid) && Date.now() < graceEnd) {
        await sleep(POLL_MS)
        await chromes?.read()
      }
      if (groupAlive(pid)) signalGroup(pid, 'SIGKILL')
      const finalEnd = Date.now() + STOP_FINAL_MS
      while ((!closed || groupAlive(pid)) && Date.now() < finalEnd) await sleep(POLL_MS)
      if (!closed) {
        child.stdout.destroy()
        child.stderr.destroy()
        markClosed()
      }
    })())
  child.on('exit', () => {
    if (pid && groupAlive(pid)) void terminate()
  })
  const timer = setTimeout(() => {
    timedOut = true
    void terminate()
  }, Math.max(0, options.timeoutMs))
  const watch = setInterval(() => void chromes?.read(), CHROME_WATCH_MS)

  const done = closing.then(async () => {
    clearTimeout(timer)
    clearInterval(watch)
    if (terminating || (pid && groupAlive(pid))) await terminate()
    await chromes?.read()
    await chromes?.stopAll()
    if (pid && groupAlive(pid) && options.owner) {
      const facility = (await readSite(options.owner.site).catch(() => undefined))?.facility_id
      await addOrphan({ site_id: options.owner.site, kind: options.purpose, pgid: pid, started_at: startedAt, match: options.owner.match, ...(facility ? { facility_id: facility } : {}), ...(options.owner.generationId ? { generation_id: options.owner.generationId } : {}) })
    }
    rmSync(workDir, { recursive: true, force: true })
    running.delete(run)
    const message = spawnError ?? (timedOut ? `${output}\ntimed out after ${options.timeoutMs / 1000} s` : output)
    return { ok: exitCode === 0 && !timedOut && !spawnError, timedOut, output: message.trim().slice(-options.tailChars) }
  })
  const run: ChildRun = {
    pid,
    startedAt,
    done,
    stop: async () => {
      await terminate()
      return done
    },
  }
  running.set(run, options.owner)
  return run
}
