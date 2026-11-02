import { isBulletinId, isMunicipalityId } from '~~/layout/replay'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ municipality?: unknown; bulletin_id?: unknown; approved?: unknown }>(event)
  if (!isMunicipalityId(body.municipality) || !isBulletinId(body.bulletin_id) || typeof body.approved !== 'boolean') {
    throw createError({ status: 400, statusText: 'Bad Request', message: 'municipality, bulletin_id and approved are required' })
  }
  const approvals = await readApprovals()
  approvals.layouts[layoutKey(body.municipality, body.bulletin_id)] = { approved: body.approved, updated_at: new Date().toISOString() }
  await writeApprovals(approvals)
  return approvals.layouts[layoutKey(body.municipality, body.bulletin_id)]
})
