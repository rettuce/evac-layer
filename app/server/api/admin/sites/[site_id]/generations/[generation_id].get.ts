const GENERATION_ID = /^[a-z0-9]{8,32}$/

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'site_id') ?? ''
  const generationId = getRouterParam(event, 'generation_id') ?? ''
  const record = GENERATION_ID.test(generationId)
    ? await readWhileOwned(id, { visible: () => readVisibleSite(id, event.context.admin), read: async () => findGeneration(await readSiteGenerations(id), generationId) })
    : undefined
  if (!record) throw problem(404, 'not-found', `no generation ${generationId} of site ${id}`)
  return publicGeneration(record)
})
