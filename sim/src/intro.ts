const SEEN_KEY = 'evac-layer-sim:intro-seen'

function wasSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return false
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    // Private windows and blocked storage only lose the memory; the card still closes.
  }
}

// Resolves when the visitor is past the card: at once on a later visit, on 「はじめる」 or Escape on the first.
export function intro(card: HTMLElement): Promise<void> {
  if (wasSeen()) return Promise.resolve()
  card.hidden = false
  const start = card.querySelector<HTMLButtonElement>('button')!
  start.focus()
  return new Promise((resolve) => {
    const close = () => {
      card.hidden = true
      markSeen()
      removeEventListener('keydown', onKey, true)
      resolve()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      close()
    }
    start.addEventListener('click', close, { once: true })
    addEventListener('keydown', onKey, true)
  })
}
