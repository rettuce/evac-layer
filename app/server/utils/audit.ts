import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { H3Event } from 'h3'
import type { AdminPrincipal } from './adminPolicy'

export interface Actor {
  id: string
  name?: string
}

export interface AuditContext {
  principal: AdminPrincipal
  actor?: Actor
  site_id?: string
  recorded?: boolean
}

declare module 'h3' {
  interface H3EventContext {
    audit?: AuditContext
  }
}

const ACTOR_FIELD_MAX = 120
const AUDIT_MAX_BYTES = 10 * 1024 * 1024
const AUDIT_KEPT_FILES = 5
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const SITE_PATH = /^\/api\/admin\/sites\/([^/]+)$/
const auditQueue = serialQueue()

export function changesState(method: string): boolean {
  return !READ_METHODS.has(method)
}

function invalidActor(message: string): never {
  throw problem(400, 'invalid-request', `actor: ${message}`)
}

function actorField(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > ACTOR_FIELD_MAX) invalidActor(`${field} must be a string of 1-${ACTOR_FIELD_MAX} characters`)
  return value
}

function actorFromBody(value: unknown): Actor {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalidActor('must be an object { id, name? }')
  const { id, name, ...rest } = value as Record<string, unknown>
  if (Object.keys(rest).length) invalidActor(`unknown field ${Object.keys(rest)[0]}`)
  return name === undefined ? { id: actorField(id, 'id') } : { id: actorField(id, 'id'), name: actorField(name, 'name') }
}

function actorFromHeaders(id: string | undefined, encodedName: string | undefined): Actor | undefined {
  if (id === undefined && encodedName === undefined) return undefined
  if (id === undefined) invalidActor('X-EvacLayer-Actor-Name needs X-EvacLayer-Actor-Id')
  if (encodedName === undefined) return { id: actorField(id, 'id') }
  let name: string
  try {
    name = decodeURIComponent(encodedName)
  } catch {
    invalidActor('X-EvacLayer-Actor-Name must be percent-encoded UTF-8')
  }
  return { id: actorField(id, 'id'), name: actorField(name, 'name') }
}

export function actorOf(body: unknown, headers: { id?: string; name?: string }): Actor | undefined {
  if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
    const actor = (body as { actor?: unknown }).actor
    return actor === undefined ? undefined : actorFromBody(actor)
  }
  return actorFromHeaders(headers.id, headers.name)
}

export function siteIdOf(path: string, body: unknown): string | undefined {
  const fromPath = SITE_PATH.exec(path)?.[1]
  if (isSiteId(fromPath)) return fromPath
  const fromBody = typeof body === 'object' && body !== null ? (body as { site_id?: unknown }).site_id : undefined
  return isSiteId(fromBody) ? fromBody : undefined
}

export function auditFile(): string {
  return join(dataDir(), 'audit.jsonl')
}

function auditMaxBytes(): number {
  const configured = Number(useRuntimeConfig().auditMaxBytes)
  return configured > 0 ? configured : AUDIT_MAX_BYTES
}

async function rotateIfFull(file: string): Promise<void> {
  const size = await stat(file).then((s) => s.size, () => 0)
  if (size < auditMaxBytes()) return
  await rm(`${file}.${AUDIT_KEPT_FILES}`, { force: true })
  for (let n = AUDIT_KEPT_FILES - 1; n >= 1; n--) await rename(`${file}.${n}`, `${file}.${n + 1}`).catch(() => undefined)
  await rename(file, `${file}.1`)
}

export async function recordAudit(event: H3Event, status: number): Promise<void> {
  const audit = event.context.audit
  if (!audit || audit.recorded) return
  audit.recorded = true
  const line = {
    at: new Date().toISOString(),
    method: event.method,
    path: event.path.split('?')[0],
    ...(audit.site_id ? { site_id: audit.site_id } : {}),
    principal: audit.principal,
    ...(audit.actor ? { actor: audit.actor } : {}),
    status,
  }
  try {
    await auditQueue(async () => {
      await mkdir(dataDir(), { recursive: true })
      await rotateIfFull(auditFile())
      await appendFile(auditFile(), `${JSON.stringify(line)}\n`)
    })
  } catch (error) {
    console.warn(`[audit] not recorded: ${JSON.stringify(line)}: ${(error as Error).message}`)
  }
}
