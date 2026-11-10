export type ProblemCode = 'invalid-request' | 'not-found' | 'site-id-taken' | 'geocoder-unavailable' | 'no-site-near' | 'place-lookup-disabled'

const STATUS_TEXT: Record<number, string> = { 400: 'Bad Request', 404: 'Not Found', 409: 'Conflict', 502: 'Bad Gateway' }

export function problem(status: 400 | 404 | 409 | 502, code: ProblemCode, message: string) {
  return createError({ status, statusText: STATUS_TEXT[status], message, data: { code } })
}
