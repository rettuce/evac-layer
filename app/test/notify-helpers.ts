import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { type Server, createServer as createTcpServer } from 'node:net'
import { join } from 'node:path'
import { APP_DIR } from './helpers.ts'

export const WAIT_MS = 20000

export interface SmtpMessage { from: string; to: string[]; auth?: string; raw: string }

export function smtpReceiver(messages: SmtpMessage[], seen: { connections: number; commands: string[] }): Server {
  return createTcpServer((socket) => {
    seen.connections++
    let buffer = ''
    let data: string | undefined
    let message: SmtpMessage = { from: '', to: [], raw: '' }
    let auth: string | undefined
    let awaitingAuth = false
    const reply = (line: string) => socket.write(`${line}\r\n`)
    reply('220 test ESMTP')
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('latin1')
      for (;;) {
        if (data !== undefined) {
          const end = buffer.indexOf('\r\n.\r\n')
          if (end < 0) return
          messages.push({ ...message, ...(auth ? { auth } : {}), raw: Buffer.from(buffer.slice(0, end).replace(/^\.\./gm, '.'), 'latin1').toString('utf8') })
          buffer = buffer.slice(end + 5)
          data = undefined
          message = { from: '', to: [], raw: '' }
          reply('250 OK queued')
          continue
        }
        const end = buffer.indexOf('\r\n')
        if (end < 0) return
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        const verb = line.split(' ')[0]!.toUpperCase()
        seen.commands.push(verb)
        if (awaitingAuth) {
          auth = line
          awaitingAuth = false
          reply('235 accepted')
        } else if (verb === 'EHLO') reply('250-test\r\n250 AUTH PLAIN LOGIN')
        else if (verb === 'HELO' || verb === 'RSET' || verb === 'NOOP') reply('250 OK')
        else if (verb === 'AUTH') {
          const [, , initial] = line.split(' ')
          if (initial) {
            auth = initial
            reply('235 accepted')
          } else {
            awaitingAuth = true
            reply('334 ')
          }
        } else if (verb === 'MAIL') {
          message.from = /<([^>]*)>/.exec(line)?.[1] ?? ''
          reply('250 OK')
        } else if (verb === 'RCPT') {
          message.to.push(/<([^>]*)>/.exec(line)?.[1] ?? '')
          reply('250 OK')
        } else if (verb === 'DATA') {
          data = ''
          reply('354 go ahead')
        } else if (verb === 'QUIT') {
          reply('221 bye')
          socket.end()
          return
        } else reply('502 not implemented')
      }
    })
    socket.on('error', () => undefined)
  })
}

export function decodeWords(value: string): string {
  const unfolded = value.replace(/\r\n[ \t]/g, ' ').replace(/\?=\s+=\?/g, '?==?')
  return unfolded.replace(/(=\?utf-8\?[bq]\?[^?]*\?=)+/gi, (words) => {
    const bytes = [...words.matchAll(/=\?utf-8\?([bq])\?([^?]*)\?=/gi)].map(([, kind, text]) =>
      kind!.toLowerCase() === 'b'
        ? Buffer.from(text!, 'base64')
        : Buffer.from(text!.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))), 'latin1'),
    )
    return Buffer.concat(bytes).toString('utf8')
  })
}

export function parseMail(raw: string): { headers: Record<string, string>; body: string } {
  const split = raw.indexOf('\r\n\r\n')
  const headers: Record<string, string> = {}
  for (const line of raw.slice(0, split).replace(/\r\n[ \t]/g, ' ').split('\r\n')) {
    const colon = line.indexOf(':')
    headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim()
  }
  const encoded = raw.slice(split + 4)
  const encoding = headers['content-transfer-encoding']?.toLowerCase()
  const body =
    encoding === 'base64'
      ? Buffer.from(encoded.replace(/\s+/g, ''), 'base64').toString('utf8')
      : encoding === 'quoted-printable'
        ? Buffer.from(encoded.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))), 'latin1').toString('utf8')
        : Buffer.from(encoded, 'latin1').toString('utf8')
  return { headers, body }
}

export interface TestSite {
  id: string
  name?: string
  facility_id?: string
  municipality_id?: string
  bulletin?: string
  live?: string | null
  rows?: Record<string, unknown>[]
}

export const ISSUED = '2026-11-09T10:00:00+09:00'

export async function writeSite(dataDir: string, site: TestSite): Promise<void> {
  const bulletin = site.bulletin ?? 'TEST-NOTIFY-1'
  const municipality = site.municipality_id ?? '00004'
  const layoutDir = join(dataDir, 'layouts', site.id, bulletin)
  await mkdir(layoutDir, { recursive: true })
  await mkdir(join(dataDir, 'sites'), { recursive: true })
  await mkdir(join(dataDir, 'live'), { recursive: true })
  const fixture = JSON.parse(await readFile(join(APP_DIR, 'fixtures', 'wajima-tsunami.json'), 'utf8'))
  await writeFile(join(layoutDir, '16x9.json'), JSON.stringify({ ...fixture, alert: { ...fixture.alert, bulletin_id: bulletin } }))
  const rows = site.rows ?? [{ issued_at: ISSUED, bulletin_id: bulletin, raw_title: '津波警報・注意報・予報a', municipality_level: 3, screen: true, template: 'evac-now', display_level: 3, outcome: 'pass' }]
  await writeFile(join(dataDir, 'layouts', site.id, 'index.json'), JSON.stringify({ municipality: municipality, name: '通知市', site: site.id, entries: rows }))
  const file = { id: site.id, municipality_id: municipality, ...(site.name ? { name: site.name } : {}), ...(site.facility_id ? { facility_id: site.facility_id } : {}) }
  await writeFile(join(dataDir, 'sites', `${site.id}.json`), JSON.stringify(file))
  const live = site.live === undefined ? bulletin : site.live
  if (live !== null) await writeFile(join(dataDir, 'live', `${site.id}.json`), JSON.stringify({ bulletin_id: live, fallback_bulletin_id: null, updated_at: '2026-11-10T00:00:00.000Z' }))
}

export async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })
  return Promise.all(entries.filter((entry) => entry.isFile()).map((entry) => readFile(join(entry.parentPath, entry.name), 'utf8')))
}

export async function until(what: string, ready: () => boolean, waitMs = WAIT_MS) {
  const deadline = Date.now() + waitMs
  while (!ready() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100))
  assert.ok(ready(), `timed out waiting for ${what}`)
}

export const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function stop(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    child.once('exit', () => resolve())
    child.kill()
  })
}
