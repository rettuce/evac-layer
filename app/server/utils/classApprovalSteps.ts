export type BlockReason = 'not-passed' | 'stale' | 'headline-unchecked' | 'draft-wording' | 'wording-unknown'
export type SkipReason = BlockReason | 'not-found' | 'no-screens' | 'not-approved' | 'changed'

// The Writer sources the agents write into a report (agents/src/writer/step.ts, agents/src/loop/revisers.ts): the
// placeholder text is a draft, and a fixture names a file someone passed on the command line, whose text no one
// vouched for here. Any other source is not known to be real wording.
export const DRAFT_WRITER_SOURCE = 'placeholder'
export const REAL_WRITER_SOURCES = ['writer-cache']
export const REAL_WRITER_SOURCE_PREFIXES = ['writer-class-cache:', 'writer-api:']

export function wordingOf(report: unknown): 'real' | 'draft' | 'unknown' {
  const attempts = (report as { attempts?: unknown } | undefined)?.attempts
  const last = Array.isArray(attempts) ? (attempts.at(-1) as { writer_source?: unknown } | undefined) : undefined
  const source = last?.writer_source
  if (source === DRAFT_WRITER_SOURCE) return 'draft'
  if (typeof source !== 'string') return 'unknown'
  const real = REAL_WRITER_SOURCES.includes(source) || REAL_WRITER_SOURCE_PREFIXES.some((prefix) => source.startsWith(prefix) && source.length > prefix.length)
  return real ? 'real' : 'unknown'
}

export interface Seen {
  bulletin_id: string
  digest: string
  class_digest: string
}

// The class is judged on what is read of the site, then read and judged again under the site's lock, and written only
// when the bulletin and screens are still the ones judged: a site moved, composed again or replaced in between is not
// approved on what it was before.
export async function approveRechecked<S extends Seen>(steps: {
  read: () => Promise<S | undefined>
  block: (seen: S) => Promise<BlockReason | undefined>
  guard: (write: () => Promise<'approved' | BlockReason | 'changed'>) => Promise<{ value: 'approved' | BlockReason | 'changed' } | undefined>
  write: (seen: S) => Promise<void>
}): Promise<'approved' | BlockReason | 'changed' | 'no-screens' | 'not-found'> {
  const before = await steps.read()
  if (!before) return 'no-screens'
  const blocked = await steps.block(before)
  if (blocked) return blocked
  const done = await steps.guard(async () => {
    const now = await steps.read()
    if (!now || now.bulletin_id !== before.bulletin_id || now.digest !== before.digest || now.class_digest !== before.class_digest) return 'changed'
    const again = await steps.block(now)
    if (again) return again
    await steps.write(now)
    return 'approved'
  })
  return done ? done.value : 'not-found'
}

export async function mapLimited<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await task(items[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
