export default defineEventHandler(async (event) => readLayout(parseLayoutQuery(getQuery(event))))
