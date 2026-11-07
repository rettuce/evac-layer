import { classKey, layoutKey, revokeClasses } from '~~/layout/gate'
import { isBulletinId } from '~~/layout/replay'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ site_id?: unknown; municipality?: unknown; bulletin_id?: unknown; approved?: unknown }>(event)
  if (!isBulletinId(body.bulletin_id) || typeof body.approved !== 'boolean') {
    throw createError({ status: 400, statusText: 'Bad Request', message: 'site_id (or municipality), bulletin_id and approved are required' })
  }
  const site = (await resolveSite({ site: body.site_id, municipality: body.municipality })).id
  const digest = body.approved ? await currentLayoutDigest(site, body.bulletin_id) : undefined
  if (body.approved && !digest) throw createError({ status: 404, statusText: 'Not Found', message: `no layout files for ${site}/${body.bulletin_id}` })
  const cls = await currentClassOf(site, body.bulletin_id)
  const approvals = await readApprovals()
  const key = layoutKey(site, body.bulletin_id)
  const updatedAt = new Date().toISOString()
  approvals.layouts[key] = { approved: body.approved, updated_at: updatedAt, ...(digest ? { digest } : {}) }
  if (body.approved && cls) {
    approvals.classes = { ...approvals.classes, [classKey(site, cls.key)]: { approved: true, updated_at: updatedAt, digest: cls.digest, approved_from: body.bulletin_id } }
  } else if (!body.approved) {
    approvals.classes = revokeClasses(approvals.classes ?? {}, site, body.bulletin_id, cls?.key, updatedAt)
  }
  await writeApprovals(approvals)
  return { site_id: site, bulletin_id: body.bulletin_id, ...approvals.layouts[key], ...(cls ? { class: cls.key, class_approval: approvals.classes?.[classKey(site, cls.key)] } : {}) }
})
