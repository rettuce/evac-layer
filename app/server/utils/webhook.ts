import { createHmac } from 'node:crypto'
import { lookup, type LookupAddress } from 'node:dns'
import { promises as dns } from 'node:dns'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { LookupFunction } from 'node:net'
import type { FeedEvent } from '~~/layout/feed'

const DELIVERY_TIMEOUT_MS = 10000

export function webhookAllowsPrivate(): boolean {
  return String(useRuntimeConfig().webhookAllowPrivate) === '1'
}

export function signWebhookBody(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

function blockedAddressError(host: string, address: string): Error {
  return Object.assign(new Error(`webhook target ${host} resolves to a non-public address ${address}`), { code: 'EWEBHOOKBLOCKED' })
}

// Checked at connect time on the resolved address, so a DNS answer that changes after registration cannot reach the LAN.
function guardedLookup(allowPrivate: boolean): LookupFunction {
  return (hostname, options, callback) => {
    lookup(hostname, options, (error, address, family) => {
      if (error) return callback(error, address, family)
      const addresses: LookupAddress[] = Array.isArray(address) ? address : [{ address, family: family ?? 4 }]
      const blocked = allowPrivate ? undefined : addresses.find((entry) => !isPublicAddress(entry.address))
      if (blocked) return callback(blockedAddressError(hostname, blocked.address), address, family)
      callback(null, address, family)
    })
  }
}

export async function assertWebhookTarget(url: URL, allowPrivate: boolean): Promise<void> {
  if (allowPrivate) return
  const literal = hostAddressLiteral(url)
  const addresses = literal ? [literal] : (await dns.lookup(url.hostname, { all: true })).map((entry) => entry.address)
  const blocked = addresses.find((address) => !isPublicAddress(address))
  if (blocked) throw blockedAddressError(url.hostname, blocked)
}

export async function postWebhook(url: string, secret: string, event: FeedEvent, body: string): Promise<number> {
  const target = new URL(url)
  const allowPrivate = webhookAllowsPrivate()
  await assertWebhookTarget(target, allowPrivate)
  const send = target.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise((resolve, reject) => {
    const req = send(
      target,
      {
        method: 'POST',
        lookup: guardedLookup(allowPrivate),
        timeout: DELIVERY_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'EVAC-LAYER-webhook/0.1',
          'X-EvacLayer-Event': event,
          'X-EvacLayer-Signature': signWebhookBody(secret, body),
        },
      },
      (res) => {
        res.resume()
        res.on('end', () => resolve(res.statusCode ?? 0))
      },
    )
    req.on('timeout', () => req.destroy(new Error(`webhook ${target.host} timed out`)))
    req.on('error', reject)
    req.end(body)
  })
}
