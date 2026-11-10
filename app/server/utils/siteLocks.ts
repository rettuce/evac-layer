interface SiteLock {
  tail: Promise<unknown>
  waiting: number
}

const locks = new Map<string, SiteLock>()
const generations = new Map<string, number>()

// Every write keyed by a site id (its file, approvals, registrations, live and export state) runs under this lock,
// so a site deleted and registered again by another facility cannot receive a write meant for the old one.
export function withSiteLock<T>(id: string, task: () => Promise<T>): Promise<T> {
  let lock = locks.get(id)
  if (!lock) locks.set(id, (lock = { tail: Promise.resolve(), waiting: 0 }))
  const held = lock
  held.waiting++
  const run = held.tail.then(task)
  held.tail = run.catch(() => undefined)
  return run.finally(() => {
    if (--held.waiting === 0 && locks.get(id) === held) locks.delete(id)
  })
}

export function siteLockCount(): number {
  return locks.size
}

// `visible` is asked twice: before the slow `prepare` (a DNS lookup), so a caller learns early that the site is not
// theirs, and again under the lock, because the site may have changed hands in between.
export async function guardedSiteWrite<T>(
  id: string,
  steps: { visible: () => Promise<boolean>; prepare?: () => Promise<void>; write: () => Promise<T> },
): Promise<{ value: T } | undefined> {
  if (!(await steps.visible())) return undefined
  await steps.prepare?.()
  return withSiteLock(id, async () => ((await steps.visible()) ? { value: await steps.write() } : undefined))
}

export function siteGeneration(id: string): number {
  return generations.get(id) ?? 0
}

export function advanceSiteGeneration(id: string): void {
  generations.set(id, siteGeneration(id) + 1)
}
