<script setup lang="ts">
import { formatClockJst } from '~~/layout/ambient'
import { liveFrame, replayClockEpochMs, type ReplayStatus } from '~~/layout/replay'
import type { AmbientRect } from '~~/layout/ambient/types'
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
  scene?: string
  room?: { width: number; height: number }
  crop?: AmbientRect
  seam?: 'left' | 'right'
  drawIntervalMs?: number
  ambientSeed?: string
  bareAmbient?: boolean
  lat?: number
  lng?: number
  staleAfterMs?: number
}>()

const POLL_MS = 1000
const FETCH_TIMEOUT_MS = 5000
const STALE_AFTER_MS = 60_000
const APPROVAL_RECHECK_POLLS = 5

const status = shallowRef<ReplayStatus>()
const layouts = shallowRef<Record<string, EvacScreen>>({})
const missing = ref<string[]>([])
const unapproved = ref<string[]>([])
let pollCount = 0
const loadError = ref<string>()
const syncError = ref<string>()
const lastSyncAt = ref<number>()
const staticScreen = useStaticScreen()
const wallNow = ref(Date.now())
let mountedAt = Date.now()
let syncing = false
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
const clockEpochMs = computed(() =>
  rows.value.length || isVirtual.value ? replayClockEpochMs(rows.value, elapsed.value, props.speed) : wallNow.value,
)
const stale = computed(() => !staticScreen.enabled && wallNow.value - (lastSyncAt.value ?? mountedAt) > (props.staleAfterMs ?? STALE_AFTER_MS))

function replayUrl(extra: Record<string, string>) {
  const params = new URLSearchParams({ municipality: props.municipality, speed: String(props.speed) })
  if (props.from) params.set('from', props.from)
  if (props.to) params.set('to', props.to)
  if (staticScreen.enabled) return staticScreen.url('replay', params)
  for (const [key, value] of Object.entries(extra)) params.set(key, value)
  return `/api/replay?${params}`
}

function isReplayStatus(value: unknown): value is ReplayStatus {
  const candidate = value as Partial<ReplayStatus> | null
  return typeof candidate === 'object' && candidate !== null && Array.isArray(candidate.rows) && Number.isFinite(candidate.elapsedMs)
}

async function poll(extra: Record<string, string> = {}) {
  const next = await $fetch<unknown>(replayUrl(extra), { timeout: FETCH_TIMEOUT_MS, retry: 0 })
  if (!isReplayStatus(next)) throw new Error('replay status is not in the expected shape')
  status.value = next
  lastSyncAt.value = Date.now()
  syncError.value = undefined
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
  const absent: string[] = []
  const gated: string[] = []
  const fetched = await Promise.all(
    wanted.map(async (row): Promise<[string, EvacScreen | undefined]> => {
      const params = new URLSearchParams({ municipality: props.municipality, bulletin: row.bulletin_id, shape: props.shape })
      if (props.site) params.set('site', props.site)
      try {
        const url = staticScreen.enabled ? staticScreen.url('live-layout', params) : `/api/live-layout?${params}`
        return [row.bulletin_id, await $fetch<EvacScreen>(url, { timeout: FETCH_TIMEOUT_MS, retry: 0 })]
      } catch (error) {
        if ((error as { statusCode?: number }).statusCode === 403) gated.push(row.bulletin_id)
        else absent.push(row.bulletin_id)
        return [row.bulletin_id, undefined]
      }
    }),
  )
  const fetchedById = new Map(fetched)
  const loaded: Record<string, EvacScreen> = {}
  for (const row of rows.value) {
    const screen = layouts.value[row.bulletin_id] ?? fetchedById.get(row.bulletin_id)
    if (screen) loaded[row.bulletin_id] = screen
  }
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

// A signage player must never go dark because the server is unreachable: every failure keeps the
// last known state on screen and the next poll tries again.
async function sync(first = false) {
  if (syncing) return
  syncing = true
  try {
    if (!layoutsLoaded.value) {
      await poll(first && props.reset ? { reset: '1' } : {})
      await loadLayouts()
      layoutsLoaded.value = true
    } else {
      await pollAndRecheck()
    }
  } catch (error) {
    syncError.value = (error as Error).message
  } finally {
    syncing = false
  }
}

onMounted(async () => {
  mountedAt = Date.now()
  if (isVirtual.value) {
    try {
      await poll({ t: '0' })
      await loadLayouts()
      layoutsLoaded.value = true
    } catch (error) {
      loadError.value = (error as Error).message
    }
    return
  }
  await sync(true)
  frameHandle = requestAnimationFrame(tick)
  pollTimer = setInterval(() => {
    wallNow.value = Date.now()
    if (!staticScreen.enabled) void sync()
  }, POLL_MS)
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
    :data-stale="!isVirtual && stale ? '1' : undefined"
    :data-last-sync="lastSyncAt ? new Date(lastSyncAt).toISOString() : undefined"
    :data-sync-error="syncError"
  >
    <AmbientLayer
      v-show="frame.ambientVisible"
      :active="frame.ambientVisible"
      :seed="ambientSeed ?? site ?? municipality"
      :clock-epoch-ms="clockEpochMs"
      :site-name="siteName ?? status?.name ?? ''"
      :shape="shape"
      :scene="scene"
      :room="room"
      :crop="crop"
      :seam="seam"
      :draw-interval-ms="drawIntervalMs"
      :bare="bareAmbient"
      :lat="lat"
      :lng="lng"
    />
    <div
      v-for="(screen, bulletinId) in layouts"
      :key="bulletinId"
      class="alert-layer"
      :style="{ opacity: frame.showing === bulletinId ? frame.showingOpacity : 0 }"
      :data-layer-bulletin="bulletinId"
    >
      <ShapeScreen
        :screen="screen"
        :shape="shape"
        :elapsed-ms="frame.showing === bulletinId ? frame.showingElapsedMs : 0"
        :reduced-motion="reducedMotion"
        @ready="markReady(String(bulletinId))"
      />
    </div>
    <div v-if="frame.black" class="black" data-layer="black" />
    <p v-if="!isVirtual" class="sync-stamp" :class="{ 'is-stale': stale }" data-layer="sync">
      更新 {{ lastSyncAt ? formatClockJst(lastSyncAt) : '--:--' }}<span v-if="stale" class="stale-mark" aria-label="同期が途絶えています"> ○</span>
    </p>
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
.sync-stamp {
  position: fixed;
  right: calc(min(100vw, 100vh) / 1080 * 48);
  bottom: calc(min(100vw, 100vh) / 1080 * 8);
  margin: 0;
  font-family: 'Noto Sans', 'Noto Sans JP', sans-serif;
  font-size: calc(min(100vw, 100vh) / 1080 * 20);
  font-variant-numeric: tabular-nums;
  color: rgb(128 128 128);
}
.sync-stamp.is-stale {
  opacity: 0.6;
}
</style>
