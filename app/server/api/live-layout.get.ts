import { join } from 'node:path'
import { isShape } from '~~/layout/shapes'
import { isBulletinId, isMunicipalityId } from '~~/layout/replay'

export default defineEventHandler(async (event) => {
  const { municipality, bulletin, shape } = getQuery(event)
  if (!isMunicipalityId(municipality) || !isBulletinId(bulletin) || !isShape(shape)) {
    throw createError({ status: 400, statusText: 'Bad Request', message: 'municipality, bulletin and shape are required' })
  }
  const layout = await readJsonIfExists(join(dataDir(), 'layouts', municipality, bulletin, `${shape}.json`))
  if (!layout) throw createError({ status: 404, statusText: 'Not Found', message: `no layout for ${bulletin} ${shape}` })
  return layout
})
