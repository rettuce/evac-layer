import { layoutKey } from '~~/layout/gate'
import { isBulletinId, isMunicipalityId } from '~~/layout/replay'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ municipality?: unknown; bulletin_id?: unknown; approved?: unknown }>(event)
  if (!isMunicipalityId(body.municipality) || !isBulletinId(body.bulletin_id) || typeof body.approved !== 'boolean') {
    throw createError({ status: 400, statusText: 'Bad Request', message: 'municipality, bulletin_id and approved are required' })
  }
  const digest = body.approved ? await currentLayoutDigest(body.municipality, body.bulletin_id) : undefined
  if (body.approved && !digest) throw createError({ status: 404, statusText: 'Not Found', message: `no layout files for ${body.municipality}/${body.bulletin_id}` })
  const approvals = await readApprovals()
  approvals.layouts[layoutKey(body.municipality, body.bulletin_id)] = { approved: body.approved, updated_at: new Date().toISOString(), ...(digest ? { digest } : {}) }
  await writeApprovals(approvals)
  return approvals.layouts[layoutKey(body.municipality, body.bulletin_id)]
})
