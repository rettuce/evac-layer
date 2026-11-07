export interface LiveState {
  bulletin_id: string | null
  fallback_bulletin_id?: string | null
  updated_at: string
}

// A newly posted bulletin may not be approved yet; the screen then keeps the one that was live before it.
export function nextLiveState(current: LiveState | undefined, bulletinId: string | null, at: string): LiveState {
  if (bulletinId === null) return { bulletin_id: null, fallback_bulletin_id: null, updated_at: at }
  const fallback = current?.bulletin_id === bulletinId ? current.fallback_bulletin_id ?? null : current?.bulletin_id ?? null
  return { bulletin_id: bulletinId, fallback_bulletin_id: fallback, updated_at: at }
}

export async function firstDeliverable(state: LiveState | undefined, deliverable: (id: string) => Promise<boolean>): Promise<string | undefined> {
  for (const id of [state?.bulletin_id, state?.fallback_bulletin_id]) if (id && (await deliverable(id))) return id
  return undefined
}
