import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

export interface ChildResult {
  ok: boolean
  output: string
}

export interface ChildRun {
  done: Promise<ChildResult>
  stop: () => Promise<ChildResult>
}

// The agents read no admin credential, so none is handed to them.
const WITHHELD_ENV = ['NUXT_ADMIN_TOKEN']

export function configuredCommand(value: unknown): string[] {
  const command = String(value ?? '').split(/\s+/).filter(Boolean)
  return command[0] === 'off' ? [] : command
}

export function runAgentCommand(command: string[], args: string[], limits: { timeoutMs: number; tailChars: number }): ChildRun {
  const env: NodeJS.ProcessEnv = { ...process.env, EVAC_DATA_DIR: resolve(dataDir()) }
  for (const name of WITHHELD_ENV) delete env[name]
  // Its own process group, so stopping it also ends the Chrome that pnpm and tsx started.
  const child = spawn(command[0]!, [...command.slice(1), ...args], { cwd: useRuntimeConfig().repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  let output = ''
  let timedOut = false
  const collect = (chunk: string) => (output = (output + chunk).slice(-limits.tailChars))
  child.stdout.setEncoding('utf8').on('data', collect)
  child.stderr.setEncoding('utf8').on('data', collect)
  const killGroup = () => {
    try {
      if (child.pid) process.kill(-child.pid, 'SIGKILL')
    } catch {
      // The group has already exited.
    }
  }
  const timer = setTimeout(() => {
    timedOut = true
    killGroup()
  }, limits.timeoutMs)
  const done = new Promise<ChildResult>((settle) => {
    const finish = (ok: boolean, message: string) => {
      clearTimeout(timer)
      settle({ ok, output: message.trim().slice(-limits.tailChars) })
    }
    child.on('error', (error) => finish(false, error.message))
    child.on('close', (code) => finish(code === 0, timedOut ? `${output}\ntimed out after ${limits.timeoutMs / 1000} s` : output))
  })
  return {
    done,
    stop: () => {
      killGroup()
      return done
    },
  }
}
