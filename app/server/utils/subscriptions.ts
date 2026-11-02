import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface Subscription {
  id: string
  site_id: string
  url: string
  secret: string
  created_at: string
}

interface SubscriptionsFile {
  version: '0.1'
  subscriptions: Subscription[]
}

export function subscriptionsFile(): string {
  return join(dataDir(), 'subscriptions.json')
}

export async function readSubscriptions(): Promise<Subscription[]> {
  return (await readJsonIfExists<SubscriptionsFile>(subscriptionsFile()))?.subscriptions ?? []
}

export async function addSubscription(input: Omit<Subscription, 'id' | 'created_at'>): Promise<Subscription> {
  const subscription: Subscription = { id: randomUUID(), ...input, created_at: new Date().toISOString() }
  const file: SubscriptionsFile = { version: '0.1', subscriptions: [...(await readSubscriptions()), subscription] }
  await writeFile(subscriptionsFile(), `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 })
  return subscription
}
