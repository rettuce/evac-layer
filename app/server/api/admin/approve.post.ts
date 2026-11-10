import { classKey, layoutKey, revokeClasses } from '~~/layout/gate'
import { isBulletinId } from '~~/layout/replay'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ site_id?: unknown; municipality?: unknown; bulletin_id?: unknown; approved?: unknown; digest?: unknown }>(event)
  if (!isBulletinId(body.bulletin_id) || typeof body.approved !== 'boolean' || (body.digest !== undefined && typeof body.digest !== 'string')) {
    throw createError({ status: 400, statusText: 'Bad Request', message: 'site_id (or municipality), bulletin_id and approved are required' })
  }
  const site = (await resolveSite({ site: body.site_id, municipality: body.municipality }, event.context.admin)).id
  const bulletin = body.bulletin_id
  const key = layoutKey(site, bulletin)
  const updatedAt = new Date().toISOString()
  if (body.approved) {
    const snapshot = await readLayoutSnapshot(site, bulletin)
    if (!snapshot) throw createError({ status: 404, statusText: 'Not Found', message: `no layout files for ${site}/${bulletin}` })
    if (body.digest !== undefined && body.digest !== snapshot.digest) throw createError({ status: 409, statusText: 'Conflict', message: 'the screens changed since you looked; reload' })
    const approved = await updateApprovals((approvals) => {
      const classRecord = { approved: true, updated_at: updatedAt, digest: snapshot.cls.digest, approved_from: bulletin }
      approvals.layouts[key] = { approved: true, updated_at: updatedAt, digest: snapshot.digest }
      approvals.classes = { ...approvals.classes, [classKey(site, snapshot.cls.key)]: classRecord }
      return { site_id: site, bulletin_id: bulletin, ...approvals.layouts[key], class: snapshot.cls.key, class_approval: classRecord }
    })
    await requestMissingExports(site).catch((error: Error) => console.warn(`[export] ${site} not queued: ${error.message}`))
    return approved
  }
  const current = await currentClassKey(site, bulletin)
  return updateApprovals((approvals) => {
    approvals.layouts[key] = { approved: false, updated_at: updatedAt }
    approvals.classes = revokeClasses(approvals.classes ?? {}, site, bulletin, undefined, updatedAt)
    if (current) approvals.classes = revokeClasses(approvals.classes, site, bulletin, current, updatedAt)
    return { site_id: site, bulletin_id: bulletin, ...approvals.layouts[key], ...(current ? { class: current } : {}) }
  })
})
