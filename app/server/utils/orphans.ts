import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export interface ChildMark {
  pgid: number
  started_at: number
  match: string[]
}

interface GroupMember {
  pid: number
  startedAt: number
  command: string
}

// ps prints the start time to the second, and the server notes it right after spawning.
const START_SLACK_MS = 3000
const STOP_GRACE_MS = 5000
const POLL_MS = 100
const PS_LINE = /^\s*(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/

async function groupMembers(pgid: number): Promise<GroupMember[] | undefined> {
  try {
    const { stdout } = await promisify(execFile)('ps', ['-A', '-ww', '-o', 'pid=,pgid=,lstart=,command='], { env: { PATH: process.env.PATH, LC_ALL: 'C' }, maxBuffer: 16 * 1024 * 1024 })
    return stdout.split('\n').flatMap((line) => {
      const parsed = PS_LINE.exec(line)
      if (!parsed || Number(parsed[2]) !== pgid) return []
      return [{ pid: Number(parsed[1]), startedAt: new Date(parsed[3]!).getTime(), command: parsed[4]! }]
    })
  } catch {
    return undefined
  }
}

function isOurs(mark: ChildMark, members: GroupMember[]): boolean {
  const matches = (member: GroupMember) => mark.match.every((arg) => member.command.includes(arg))
  const leader = members.find((member) => member.pid === mark.pgid)
  if (leader) return Math.abs(leader.startedAt - mark.started_at) <= START_SLACK_MS && matches(leader)
  return members.every((member) => member.startedAt >= mark.started_at - START_SLACK_MS) && members.some(matches)
}

// A server that was killed outright leaves its children running. Only a process group whose leader (or, once the
// leader is gone, whose members) started when the record says and runs the job's command is taken for one of them:
// a pid alone may have been reused by anything since.
export async function stopOrphan(mark: ChildMark): Promise<'gone' | 'stopped' | 'unverified'> {
  if (!groupAlive(mark.pgid)) return 'gone'
  const members = await groupMembers(mark.pgid)
  if (!members) return 'unverified'
  if (!members.length) return groupAlive(mark.pgid) ? 'unverified' : 'gone'
  if (!isOurs(mark, members)) return 'unverified'
  signalGroup(mark.pgid, 'SIGTERM')
  const deadline = Date.now() + STOP_GRACE_MS
  while (groupAlive(mark.pgid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  if (groupAlive(mark.pgid)) signalGroup(mark.pgid, 'SIGKILL')
  return 'stopped'
}
