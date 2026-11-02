import type { Ref } from 'vue'

export type ClockMode = 'real' | 'virtual'

export interface EvacClockHandle {
  set(ms: number): Promise<void>
  now(): number
}

declare global {
  interface Window {
    evacClock?: EvacClockHandle
  }
}

const SETTLE_FRAMES = 2

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

export function useScreenClock(mode: Ref<ClockMode>, initialVirtualT: Ref<number>) {
  const realElapsed = ref(0)
  const virtualT = ref(initialVirtualT.value)
  const started = ref(false)
  let origin = 0
  let frame = 0

  watch(initialVirtualT, (t) => {
    virtualT.value = t
  })

  function tick() {
    realElapsed.value = performance.now() - origin
    frame = requestAnimationFrame(tick)
  }

  function start() {
    if (started.value || mode.value === 'virtual') return
    started.value = true
    origin = performance.now()
    frame = requestAnimationFrame(tick)
  }

  const elapsed = computed(() => (mode.value === 'virtual' ? virtualT.value : realElapsed.value))

  // Hidden tabs never run rAF, so waiting for frames there would hang the recorder.
  async function set(ms: number) {
    virtualT.value = ms
    await nextTick()
    if (document.visibilityState === 'hidden') return
    for (let i = 0; i < SETTLE_FRAMES; i++) await nextFrame()
  }

  onMounted(() => {
    if (mode.value === 'virtual') window.evacClock = { set, now: () => virtualT.value }
  })

  onBeforeUnmount(() => {
    cancelAnimationFrame(frame)
    if (window.evacClock?.set === set) delete window.evacClock
  })

  return { elapsed, start }
}
