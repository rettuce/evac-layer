const BODY_FIELDS = new Set(['actor'])

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'site_id') ?? ''
  const body = await readBody(event)
  if (body !== undefined && body !== null && (typeof body !== 'object' || Array.isArray(body))) throw problem(400, 'invalid-request', 'the body must be an object { actor? }')
  const unknown = Object.keys(body ?? {}).find((key) => !BODY_FIELDS.has(key))
  if (unknown) throw problem(400, 'invalid-request', `unknown field ${unknown}`)
  let generation
  try {
    generation = await startGeneration(id, event.context.admin!, event.context.audit?.actor)
  } catch (error) {
    if (!(error instanceof GenerationRateLimited)) throw error
    setResponseHeader(event, 'Retry-After', error.retryAfterSeconds)
    throw problem(429, 'generation-rate-limited', error.message)
  }
  if (!generation) throw problem(404, 'not-found', `no site ${id}`)
  setResponseStatus(event, 202)
  setResponseHeader(event, 'Location', `/api/admin/sites/${encodeURIComponent(id)}/generations/${generation.generation_id}`)
  return generation
})
