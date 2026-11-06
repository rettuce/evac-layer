import { randomUUID } from 'node:crypto'
import { rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface Subscription {
  id: string
  site_id: string
  url: string
  secret: string
  created_at: string
  // What this subscriber was last told (null: ambient). Kept on disk so a state that changed while the
  // server was down is still delivered after a restart.
  last_bulletin_id?: string | null
  last_delivered_at?: string
}

export type PublicSubscription = Omit<Subscription, 'secret'>

interface SubscriptionsFile {
  version: '0.1'
  subscriptions: Subscription[]
}

let pending: Promise<unknown> = Promise.resolve()

// Registration, removal and the webhook watcher all rewrite the same file; one at a time keeps a
// write from dropping another's change.
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = pending.then(task, task)
  pending = run.catch(() => undefined)
  return run
}

export function subscriptionsFile(): string {
  return join(dataDir(), 'subscriptions.json')
}

export async function readSubscriptions(): Promise<Subscription[]> {
  return (await readJsonIfExists<SubscriptionsFile>(subscriptionsFile()))?.subscriptions ?? []
}

async function writeSubscriptions(subscriptions: Subscription[]): Promise<void> {
  const file: SubscriptionsFile = { version: '0.1', subscriptions }
  const partial = `${subscriptionsFile()}.${process.pid}.tmp`
  await writeFile(partial, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 })
  await rename(partial, subscriptionsFile())
}

export function publicSubscription({ secret: _secret, ...visible }: Subscription): PublicSubscription {
  return visible
}

export function addSubscription(input: Pick<Subscription, 'site_id' | 'url' | 'secret'>): Promise<Subscription> {
  return serialized(async () => {
    const subscription: Subscription = { id: randomUUID(), ...input, created_at: new Date().toISOString() }
    await writeSubscriptions([...(await readSubscriptions()), subscription])
    return subscription
  })
}

export function removeSubscription(id: string): Promise<boolean> {
  return serialized(async () => {
    const subscriptions = await readSubscriptions()
    const kept = subscriptions.filter((s) => s.id !== id)
    if (kept.length === subscriptions.length) return false
    await writeSubscriptions(kept)
    return true
  })
}

export function recordDelivered(id: string, bulletinId: string | null): Promise<void> {
  return serialized(async () => {
    const subscriptions = await readSubscriptions()
    const target = subscriptions.find((s) => s.id === id)
    if (!target) return
    target.last_bulletin_id = bulletinId
    target.last_delivered_at = new Date().toISOString()
    await writeSubscriptions(subscriptions)
  })
}
