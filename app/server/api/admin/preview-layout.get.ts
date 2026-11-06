export default defineEventHandler(async (event) => readLayout(await parseLayoutQuery(getQuery(event))))
