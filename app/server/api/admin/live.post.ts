import { isBulletinId } from '~~/layout/replay'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ site_id?: unknown; bulletin_id?: unknown }>(event)
  if (!isSiteId(body.site_id) || !(body.bulletin_id === null || isBulletinId(body.bulletin_id))) {
    throw createError({ status: 400, statusText: 'Bad Request', message: 'site_id and bulletin_id (a bulletin id, or null to clear) are required' })
  }
  const siteId = body.site_id
  const bulletinId = body.bulletin_id
  return withSiteLock(siteId, async () => {
    const site = await readSite(siteId)
    if (!site) throw createError({ status: 404, statusText: 'Not Found', message: `no site ${siteId}` })
    if (site.replay) {
      throw createError({ status: 409, statusText: 'Conflict', message: `site ${site.id} replays a recorded record; remove "replay" from its site file to drive it live` })
    }
    return { site_id: site.id, ...(await writeLiveState(site.id, bulletinId)) }
  })
})
