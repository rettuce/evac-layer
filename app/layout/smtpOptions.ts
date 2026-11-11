export interface SmtpTransportOptions {
  url: string
  secure: boolean
  requireTLS: boolean
  tls: { rejectUnauthorized: true }
}

export type SmtpSetting = { ok: true; options: SmtpTransportOptions } | { ok: false; problem: 'not-a-url' | 'protocol' | 'query' }

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return host === 'localhost' || host === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
}

// nodemailer copies every query key of the URL into its options, over the ones given beside it (tls.rejectUnauthorized,
// ignoreTLS, requireTLS among them), and with smtp:// it uses STARTTLS only when the server offers it.
export function smtpTransportOptions(raw: string, allowPlaintext: boolean): SmtpSetting {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, problem: 'not-a-url' }
  }
  if (url.protocol !== 'smtp:' && url.protocol !== 'smtps:') return { ok: false, problem: 'protocol' }
  if (url.search || raw.includes('?')) return { ok: false, problem: 'query' }
  const secure = url.protocol === 'smtps:'
  const credentials = url.username !== '' || url.password !== ''
  const requireTLS = !secure && !allowPlaintext && (credentials || !isLoopbackHost(url.hostname))
  return { ok: true, options: { url: raw, secure, requireTLS, tls: { rejectUnauthorized: true } } }
}
