import { join } from 'node:path'
import { PILLAR, isShape } from '~~/layout/shapes'
import { isBulletinId, isMunicipalityId } from '~~/layout/replay'

const SITE_ID = /^[A-Za-z0-9_-]{1,80}$/

export interface LayoutQuery {
  municipality: string
  bulletin: string
  shape: string
}

export function parseLayoutQuery(query: Record<string, unknown>): LayoutQuery {
  const { municipality, bulletin, shape } = query
  if (!isMunicipalityId(municipality) || !isBulletinId(bulletin) || !isShape(shape)) {
    throw createError({ status: 400, statusText: 'Bad Request', message: 'municipality, bulletin and shape are required' })
  }
  return { municipality, bulletin, shape }
}

export async function readLayout({ municipality, bulletin, shape }: LayoutQuery) {
  const dir = join(dataDir(), 'layouts', municipality, bulletin)
  const layout =
    (await readJsonIfExists(join(dir, `${shape}.json`))) ??
    (shape === 'pillar' ? await readJsonIfExists(join(dir, `${PILLAR.faceShape}.json`)) : undefined)
  if (!layout) throw createError({ status: 404, statusText: 'Not Found', message: `no layout for ${bulletin} ${shape}` })
  return layout
}

export async function defaultSiteFor(municipality: string): Promise<string | undefined> {
  const index = await readJsonIfExists<{ site?: string }>(join(dataDir(), 'layouts', municipality, 'index.json'))
  return index?.site
}

export function isSiteId(value: unknown): value is string {
  return typeof value === 'string' && SITE_ID.test(value)
}
