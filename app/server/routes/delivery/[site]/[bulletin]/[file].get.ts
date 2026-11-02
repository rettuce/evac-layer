import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { isBulletinId } from '~~/layout/replay'

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}

export default defineEventHandler(async (event) => {
  const site = getRouterParam(event, 'site')
  const bulletin = getRouterParam(event, 'bulletin')
  const file = getRouterParam(event, 'file')
  if (!isSiteId(site) || !isBulletinId(bulletin) || !file || !isDeliveryFile(file)) {
    throw createError({ status: 404, statusText: 'Not Found' })
  }
  if (!(await isDeliverable(site, bulletin))) throw createError({ status: 404, statusText: 'Not Found' })
  try {
    const content = await readFile(join(distDir(), site, bulletin, file))
    setResponseHeaders(event, { 'Content-Type': CONTENT_TYPES[extname(file)]!, 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' })
    return content
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw createError({ status: 404, statusText: 'Not Found' })
    throw error
  }
})
