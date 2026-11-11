import { bulletinStatus, type BulletinStatus } from '~~/layout/gate'
import { isBulletinId, isSyntheticBulletinId } from '~~/layout/replay'

// The same reading as the class gate: the index row's status, else the stored layout's own.
async function storedStatus(siteId: string, bulletinId: string): Promise<BulletinStatus> {
  const row = (await readLayoutIndex(siteId))?.entries.find((entry) => entry.bulletin_id === bulletinId)
  const shape = (await listDir(siteLayoutsDir(siteId, bulletinId))).find((file) => file.endsWith('.json'))
  const layout = shape ? await readJsonIfExists<Parameters<typeof bulletinStatus>[0]>(siteLayoutsDir(siteId, bulletinId, shape)) : undefined
  return bulletinStatus(layout, row?.status)
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ site_id?: unknown; bulletin_id?: unknown }>(event)
  if (!isSiteId(body.site_id) || !(body.bulletin_id === null || isBulletinId(body.bulletin_id))) {
    throw createError({ status: 400, statusText: 'Bad Request', message: 'site_id and bulletin_id (a bulletin id, or null to clear) are required' })
  }
  const siteId = body.site_id
  const bulletinId = body.bulletin_id
  if (isSyntheticBulletinId(bulletinId)) {
    throw createError({ status: 400, statusText: 'Bad Request', message: `${bulletinId} is a synthetic bulletin: its screens stand for their class and are never live` })
  }
  return withSiteLock(siteId, async () => {
    const site = await readSite(siteId)
    if (!site) throw createError({ status: 404, statusText: 'Not Found', message: `no site ${siteId}` })
    if (site.replay) {
      throw createError({ status: 409, statusText: 'Conflict', message: `site ${site.id} replays a recorded record; remove "replay" from its site file to drive it live` })
    }
    const status = bulletinId === null ? 'normal' : await storedStatus(site.id, bulletinId)
    if (status !== 'normal') {
      throw createError({ status: 409, statusText: 'Conflict', message: `${bulletinId} is a ${status} bulletin (Control/Status ${status === 'drill' ? '訓練' : '試験'}): it is never shown on a live site; show it on a site with "replay"` })
    }
    return { site_id: site.id, ...(await writeLiveState(site.id, bulletinId)) }
  })
})
