import { WEBHOOK_RETRIES, feedEvent, webhookRetryDelayMs, type Feed } from '~~/layout/feed'

const WATCH_INTERVAL_MS = 1000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export default defineNitroPlugin((nitroApp) => {
  const lastBulletin = new Map<string, string | null>()
  const generation = new Map<string, number>()
  let watching = false

  async function deliver(subscription: Subscription, feed: Feed, deliveryGeneration: number) {
    const body = JSON.stringify(feed)
    let lastError = ''
    for (let retry = 0; retry <= WEBHOOK_RETRIES; retry++) {
      if (generation.get(subscription.id) !== deliveryGeneration) return
      if (!(await readSubscriptions()).some((s) => s.id === subscription.id)) return
      let status = 0
      try {
        status = await postWebhook(subscription.url, subscription.secret, feedEvent(feed), body)
        lastError = `HTTP ${status}`
      } catch (error) {
        lastError = (error as Error).message
      }
      if (status >= 200 && status < 300) {
        await recordDelivered(subscription.id, feed.bulletin_id).catch((error: Error) => console.warn(`[webhook] ${subscription.id} delivered but not recorded: ${error.message}`))
        return
      }
      if (retry < WEBHOOK_RETRIES) await sleep(webhookRetryDelayMs(retry))
    }
    console.warn(`[webhook] ${subscription.id} gave up after ${WEBHOOK_RETRIES} retries: ${lastError}`)
  }

  async function watch() {
    if (watching) return
    watching = true
    try {
      const feeds = new Map<string, Feed | undefined>()
      for (const subscription of await readSubscriptions()) {
        if (!feeds.has(subscription.site_id)) feeds.set(subscription.site_id, await currentFeed(subscription.site_id))
        const feed = feeds.get(subscription.site_id)
        if (!feed) continue
        const told = lastBulletin.has(subscription.id) ? lastBulletin.get(subscription.id) : subscription.last_bulletin_id
        if (told !== undefined && told === feed.bulletin_id) continue
        lastBulletin.set(subscription.id, feed.bulletin_id)
        if (told === undefined && feed.state === 'ambient') continue
        const next = (generation.get(subscription.id) ?? 0) + 1
        generation.set(subscription.id, next)
        void deliver(subscription, feed, next)
      }
    } catch (error) {
      console.warn(`[webhook] watch failed: ${(error as Error).message}`)
    } finally {
      watching = false
    }
  }

  const timer = setInterval(watch, WATCH_INTERVAL_MS)
  nitroApp.hooks.hook('close', () => clearInterval(timer))
})
