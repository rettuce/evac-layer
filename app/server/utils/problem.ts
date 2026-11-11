export type ProblemCode =
  | 'invalid-request'
  | 'not-found'
  | 'site-id-taken'
  | 'geocoder-unavailable'
  | 'no-site-near'
  | 'place-lookup-disabled'
  | 'generation-running'
  | 'generation-disabled'
  | 'municipality-not-prepared'
  | 'site-busy'
  | 'too-many-sites'

const STATUS_TEXT: Record<number, string> = { 400: 'Bad Request', 404: 'Not Found', 409: 'Conflict', 502: 'Bad Gateway', 503: 'Service Unavailable' }

export function problem(status: 400 | 404 | 409 | 502 | 503, code: ProblemCode, message: string, extra: Record<string, string> = {}) {
  return createError({ status, statusText: STATUS_TEXT[status], message, data: { code, ...extra } })
}
