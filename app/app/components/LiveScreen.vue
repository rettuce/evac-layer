<script setup lang="ts">
import { liveFrame, replayClockEpochMs, type ReplayStatus } from '~~/layout/replay'
import type { EvacScreen, Shape } from '~~/layout/types'

const props = defineProps<{
  municipality: string
  shape: Shape
  speed: number
  from?: string
  to?: string
  virtualElapsedMs?: number
  site?: string
  siteName?: string
  reset?: boolean
  reducedMotion?: boolean
}>()

const POLL_MS = 1000
const APPROVAL_RECHECK_POLLS = 5

const status = shallowRef<ReplayStatus>()
const layouts = shallowRef<Record<string, EvacScreen>>({})
const missing = ref<string[]>([])
const unapproved = ref<string[]>([])
let pollCount = 0
const loadError = ref<string>()
const layoutsLoaded = ref(false)
const readyBulletins = ref(new Set<string>())
const realElapsed = ref(0)

let syncedElapsed = 0
let syncedAt = 0
let frameHandle = 0
let pollTimer: ReturnType<typeof setInterval> | undefined

const isVirtual = computed(() => props.virtualElapsedMs !== undefined)
const rows = computed(() => status.value?.rows ?? [])
const elapsed = computed(() => props.virtualElapsedMs ?? realElapsed.value)
const frame = computed(() => liveFrame(rows.value, elapsed.value, props.speed, (id) => id in layouts.value))
const currentRow = computed(() => (frame.value.index >= 0 ? rows.value[frame.value.index] : undefined))
const unavailableCurrent = computed(() =>
  currentRow.value?.screen && !(currentRow.value.bulletin_id in layouts.value) ? currentRow.value.bulletin_id : undefined,
)
const missingCurrent = computed(() => (unavailableCurrent.value && missing.value.includes(unavailableCurrent.value) ? unavailableCurrent.value : undefined))
const unapprovedCurrent = computed(() =>
  unavailableCurrent.value && unapproved.value.includes(unavailableCurrent.value) ? unavailableCurrent.value : undefined,
)
const ready = computed(
  () => layoutsLoaded.value && Object.keys(layouts.value).every((id) => readyBulletins.value.has(id)),
)
const clockEpochMs = computed(() => replayClockEpochMs(rows.value, elapsed.value, props.speed))

function replayUrl(extra: Record<string, string>) {
  const params = new URLSearchParams({ municipality: props.municipality, speed: String(props.speed), ...extra })
  if (props.from) params.set('from', props.from)
  if (props.to) params.set('to', props.to)
  return `/api/replay?${params}`
}

async function poll(extra: Record<string, string> = {}) {
  const next = await $fetch<ReplayStatus>(replayUrl(extra))
  status.value = next
  syncedElapsed = next.elapsedMs
  syncedAt = performance.now()
  realElapsed.value = syncedElapsed
}

function tick() {
  realElapsed.value = syncedElapsed + (performance.now() - syncedAt)
  frameHandle = requestAnimationFrame(tick)
}

async function loadLayouts() {
  const wanted = rows.value.filter((row) => row.screen && !(row.bulletin_id in layouts.value))
  const loaded: Record<string, EvacScreen> = { ...layouts.value }
  const absent: string[] = []
  const gated: string[] = []
  await Promise.all(
    wanted.map(async (row) => {
      const params = new URLSearchParams({ municipality: props.municipality, bulletin: row.bulletin_id, shape: props.shape })
      if (props.site) params.set('site', props.site)
      try {
        loaded[row.bulletin_id] = await $fetch<EvacScreen>(`/api/live-layout?${params}`)
      } catch (error) {
        if ((error as { statusCode?: number }).statusCode === 403) gated.push(row.bulletin_id)
        else absent.push(row.bulletin_id)
      }
    }),
  )
  layouts.value = loaded
  missing.value = absent.sort()
  unapproved.value = gated.sort()
}

async function pollAndRecheck() {
  await poll()
  pollCount += 1
  if (unapproved.value.length && pollCount % APPROVAL_RECHECK_POLLS === 0) await loadLayouts()
}

function markReady(bulletinId: string) {
  readyBulletins.value = new Set(readyBulletins.value).add(bulletinId)
}

onMounted(async () => {
  try {
    await poll(isVirtual.value ? { t: '0' } : props.reset ? { reset: '1' } : {})
    await loadLayouts()
    layoutsLoaded.value = true
  } catch (error) {
    loadError.value = (error as Error).message
    return
  }
  if (isVirtual.value) return
  frameHandle = requestAnimationFrame(tick)
  pollTimer = setInterval(() => pollAndRecheck().catch(() => undefined), POLL_MS)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(frameHandle)
  clearInterval(pollTimer)
})
</script>

<template>
  <div v-if="loadError" class="live-error" data-error="live-load-failed">{{ loadError }}</div>
  <div
    v-else
    class="live"
    data-mode="live"
    :data-ready="ready ? '1' : '0'"
    :data-live-index="frame.index"
    :data-bulletin="currentRow?.bulletin_id"
    :data-showing="frame.showing"
    :data-missing-layout="missingCurrent"
    :data-unapproved="unapprovedCurrent"
    :data-unapproved-count="unapproved.length"
    :data-missing-layouts="missing.join(',') || undefined"
  >
    <AmbientLayer
      v-show="frame.ambientVisible"
      :seed="municipality"
      :elapsed-ms="elapsed"
      :clock-epoch-ms="clockEpochMs"
      :site-name="siteName ?? status?.name ?? ''"
    />
    <div
      v-for="(screen, bulletinId) in layouts"
      :key="bulletinId"
      class="alert-layer"
      :style="{ opacity: frame.showing === bulletinId ? frame.showingOpacity : 0 }"
      :data-layer-bulletin="bulletinId"
    >
      <EvacScreen
        :screen="screen"
        :shape="shape"
        :elapsed-ms="frame.showing === bulletinId ? frame.showingElapsedMs : 0"
        :reduced-motion="reducedMotion"
        @ready="markReady(String(bulletinId))"
      />
    </div>
    <div v-if="frame.black" class="black" data-layer="black" />
  </div>
</template>

<style scoped>
.live-error {
  font-family: 'Noto Sans', sans-serif;
  padding: 48px;
}
.alert-layer,
.black {
  position: fixed;
  inset: 0;
}
.black {
  background: #000;
}
</style>
