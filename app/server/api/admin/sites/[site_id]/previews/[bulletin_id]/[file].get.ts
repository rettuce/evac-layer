import { isBulletinId } from '~~/layout/replay'
import { isShape } from '~~/layout/shapes'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'site_id') ?? ''
  const bulletin = getRouterParam(event, 'bulletin_id')
  const shape = /^(.+)\.png$/.exec(getRouterParam(event, 'file') ?? '')?.[1]
  await readSiteOr404(id, event.context.admin)
  const preview = isBulletinId(bulletin) && isShape(shape) ? await readPreview(id, bulletin, shape) : undefined
  if (!preview) throw problem(404, 'not-found', `no preview of ${String(bulletin)} ${String(shape)}`)
  setResponseHeaders(event, { 'Content-Type': 'image/png', ETag: `"${preview.digest}"`, 'Cache-Control': 'no-store' })
  return preview.png
})
