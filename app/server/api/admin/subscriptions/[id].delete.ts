export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !(await removeSubscription(id))) throw createError({ status: 404, statusText: 'Not Found', message: `no subscription ${id}` })
  setResponseStatus(event, 204)
  return null
})
