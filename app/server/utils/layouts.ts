import { join } from 'node:path'
import { isShape } from '~~/layout/shapes'
import { isBulletinId } from '~~/layout/replay'
import type { Shape } from '~~/layout/types'

export interface LayoutQuery {
  site: string
  bulletin: string
  shape: Shape
}

export function siteLayoutsDir(site: string, ...rest: string[]): string {
  return join(dataDir(), 'layouts', site, ...rest)
}

export async function parseLayoutQuery(query: Record<string, unknown>): Promise<LayoutQuery> {
  const { bulletin, shape } = query
  if (!isBulletinId(bulletin) || !isShape(shape)) {
    throw createError({ status: 400, statusText: 'Bad Request', message: 'site (or municipality), bulletin and shape are required' })
  }
  const site = await resolveSite(query)
  return { site: site.id, bulletin, shape }
}

export async function readLayout({ site, bulletin, shape }: LayoutQuery) {
  const layout = await readJsonIfExists(siteLayoutsDir(site, bulletin, `${shape}.json`))
  if (!layout) throw createError({ status: 404, statusText: 'Not Found', message: `no layout for ${site} ${bulletin} ${shape}` })
  return layout
}
