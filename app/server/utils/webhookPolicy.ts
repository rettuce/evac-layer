import { BlockList, isIP } from 'node:net'

const NON_PUBLIC = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, 'ipv4')
}
const GLOBAL_UNICAST_V6 = new BlockList()
GLOBAL_UNICAST_V6.addSubnet('2000::', 3, 'ipv6')
for (const [network, prefix] of [
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, 'ipv6')
}

const IPV4_MAPPED = /^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/i

function unmapIpv4(address: string): string | undefined {
  const match = IPV4_MAPPED.exec(address)
  if (!match) return undefined
  if (match[1]) return match[1]
  const high = Number.parseInt(match[2]!, 16)
  const low = Number.parseInt(match[3]!, 16)
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.')
}

// BlockList matches IPv6 rules against IPv4 addresses too, so IPv4-mapped IPv6 is unmapped here instead of listed.
// IPv6 is public only inside global unicast, minus the transition ranges (Teredo, 6to4) that can embed a LAN IPv4 address.
export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 0) return false
  const mapped = family === 6 ? unmapIpv4(address) : undefined
  if (mapped) return isPublicAddress(mapped)
  if (family === 4) return !NON_PUBLIC.check(address, 'ipv4')
  return GLOBAL_UNICAST_V6.check(address, 'ipv6') && !NON_PUBLIC.check(address, 'ipv6')
}

export type WebhookUrlCheck = { ok: true; url: URL } | { ok: false; reason: string }

export function checkWebhookUrl(raw: unknown): WebhookUrlCheck {
  if (typeof raw !== 'string') return { ok: false, reason: 'url must be a string' }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: 'url is not a valid URL' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'url must be http or https' }
  return { ok: true, url }
}

export function hostAddressLiteral(url: URL): string | undefined {
  const host = url.hostname.replace(/^\[|\]$/g, '')
  return isIP(host) ? host : undefined
}
