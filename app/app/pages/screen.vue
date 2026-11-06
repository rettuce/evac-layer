<script setup lang="ts">
import { DEFAULT_REPLAY_SPEED, isMunicipalityId } from '~~/layout/replay'
import { DEFAULT_SWITCH_AT_MS, scenarioFrame, type ScenarioName } from '~~/layout/scenario'
import { designScale, isShape, shapeForViewport, viewportFromQuery } from '~~/layout/shapes'
import { parseCrop, parseRoom, roomSeedKey } from '~~/layout/ambient/room'
import { resolveLayoutSrc } from '~~/layout/trust'
import type { EvacScreen } from '~~/layout/types'
import type { ClockMode } from '~/composables/useScreenClock'

const fixtures = import.meta.glob<EvacScreen>('../../fixtures/*.json', { eager: true, import: 'default' })

function fixtureByName(name: string): EvacScreen | undefined {
  return fixtures[`../../fixtures/${name}.json`]
}

function numberQuery(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return value === undefined || Number.isNaN(parsed) ? fallback : parsed
}

const route = useRoute()
const router = useRouter()
// An embedding page (the web simulator) switches the ambient scene without a reload by posting
// { type: 'evac-screen', scene }; the route query stays the single source of what is shown.
onMounted(() => {
  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { type?: unknown; scene?: unknown } | null
    if (data?.type !== 'evac-screen' || typeof data.scene !== 'string') return
    router.replace({ query: { ...route.query, scene: data.scene } })
  })
})
// `fps=<n>` caps the ambient canvas redraw for embedded screens (22 of them in the simulator).
const drawIntervalMs = computed(() => {
  const fps = numberQuery(route.query.fps, 0)
  return fps > 0 ? 1000 / fps : undefined
})
const DEFAULT_FIXTURE = 'wajima-tsunami'
// A production screen opened without `layout` must not show an alert nobody chose. Development keeps the
// fixture as a convenience, and an ambient-only scenario uses it only for its clock and name, never its alert.
const fixtureByDefault = computed(() => import.meta.dev || (route.query.mode === 'scenario' && route.query.scenario === 'ambient'))
const layoutName = computed(() => (route.query.layout !== undefined ? String(route.query.layout) : fixtureByDefault.value ? DEFAULT_FIXTURE : undefined))
const ADMIN_TOKEN_STORAGE_KEY = 'evac-admin-token'

function adminHeadersFor(url: string): Record<string, string> {
  if (!url.startsWith('/api/admin/')) return {}
  try {
    const token = sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY)
    return token ? { authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}
const layoutSource = computed(() => resolveLayoutSrc(route.query.src, import.meta.dev))
const src = computed(() => layoutSource.value?.url)
const srcRejected = computed(() => route.query.src !== undefined && !src.value)
const remote = shallowRef<EvacScreen>()
const remoteError = ref<string>()

watch(
  src,
  async (url) => {
    remote.value = undefined
    remoteError.value = undefined
    if (!url) return
    try {
      remote.value = await $fetch<EvacScreen>(url, { headers: adminHeadersFor(url) })
    } catch (error) {
      remoteError.value = `failed to load ${url}: ${(error as Error).message}`
    }
  },
  { immediate: true },
)

const screen = computed(() => (src.value ? remote.value : layoutName.value ? fixtureByName(layoutName.value) : undefined))
const variant = computed(() => numberQuery(route.query.variant, 0))
const viewport = computed(() => viewportFromQuery(route.query.w, route.query.h, route.query.aspect))
const shape = computed(() => {
  const requested = route.query.shape
  if (isShape(requested)) return requested
  const { width, height } = viewport.value ?? { width: window.innerWidth, height: window.innerHeight }
  return shapeForViewport(width, height)
})
const box = computed(() =>
  viewport.value && shape.value !== 'pillar'
    ? { ...viewport.value, scale: designScale(viewport.value.width, viewport.value.height, shape.value) }
    : undefined,
)

const clockMode = computed<ClockMode>(() => (route.query.clock === 'virtual' ? 'virtual' : 'real'))
const virtualT = computed(() => numberQuery(route.query.t, 0))
const { elapsed, start } = useScreenClock(clockMode, virtualT)
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

const scenario = computed<ScenarioName | undefined>(() => {
  if (route.query.mode !== 'scenario') return undefined
  return route.query.scenario === 'ambient' ? 'ambient' : 'switch'
})
const switchAtMs = computed(() => numberQuery(route.query.t_switch, DEFAULT_SWITCH_AT_MS))
const clearAtMs = computed(() => (route.query.t_clear === undefined ? undefined : numberQuery(route.query.t_clear, 0)))
const frame = computed(() =>
  scenario.value ? scenarioFrame(scenario.value, elapsed.value, switchAtMs.value, clearAtMs.value) : undefined,
)

const sceneQuery = computed(() => (typeof route.query.scene === 'string' ? route.query.scene : undefined))
const room = computed(() => parseRoom(route.query.canvas))
const crop = computed(() => parseCrop(route.query.crop, room.value))
const bareAmbient = computed(() => route.query.overlay === 'none')
const seam = computed<'left' | 'right'>(() => (route.query.seam === 'right' ? 'right' : 'left'))
const lat = computed(() => coordinate(route.query.lat, 90))
const lng = computed(() => coordinate(route.query.lng, 180))

function coordinate(value: unknown, limit: number): number | undefined {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : undefined
}
const seed = computed(() => (room.value && crop.value ? roomSeedKey(room.value, route.query.canvas_id) : String(route.query.seed ?? route.query.layout ?? DEFAULT_FIXTURE)))
const siteName = computed(() => String(route.query.site_name ?? screen.value?.municipality.name ?? ''))
const realStartEpoch = Date.now()
const clockEpochMs = computed(() => {
  if (clockMode.value === 'real') return realStartEpoch + elapsed.value
  const issued = screen.value ? Date.parse(screen.value.alert.issued_at) : 0
  return issued - switchAtMs.value + elapsed.value
})

const liveMunicipality = computed(() => (isMunicipalityId(route.query.municipality) ? route.query.municipality : undefined))
const liveSite = computed(() => (typeof route.query.site === 'string' && route.query.site !== '' ? route.query.site : undefined))
const live = computed(() => route.query.mode === 'live' && (liveMunicipality.value !== undefined || liveSite.value !== undefined))
// `?site=` alone takes the speed from the site file; the `municipality=` URLs keep their default.
const liveSpeed = computed(() =>
  route.query.speed !== undefined || liveMunicipality.value ? numberQuery(route.query.speed, DEFAULT_REPLAY_SPEED) : undefined,
)

if (scenario.value) start()
</script>

<template>
  <LiveScreen
    v-if="live"
    :municipality="liveMunicipality"
    :shape="shape"
    :speed="liveSpeed"
    :from="typeof route.query.from === 'string' ? route.query.from : undefined"
    :to="typeof route.query.to === 'string' ? route.query.to : undefined"
    :virtual-elapsed-ms="clockMode === 'virtual' ? elapsed : undefined"
    :site="liveSite"
    :site-name="typeof route.query.site_name === 'string' ? route.query.site_name : undefined"
    :reset="route.query.reset !== undefined"
    :scene="sceneQuery"
    :room="crop ? room : undefined"
    :crop="crop"
    :seam="seam"
    :draw-interval-ms="drawIntervalMs"
    :ambient-seed="room && crop ? seed : undefined"
    :bare-ambient="bareAmbient"
    :lat="lat"
    :lng="lng"
    :stale-after-ms="route.query.stale_after === undefined ? undefined : numberQuery(route.query.stale_after, 0)"
    :reduced-motion="reducedMotion"
    :data-clock="clockMode"
  />
  <div v-else-if="srcRejected" class="missing" data-error="src-rejected">src must be a same-origin path (production: the layout store only)</div>
  <div v-else-if="remoteError" class="missing" data-error="src-load-failed">{{ remoteError }}</div>
  <div v-else-if="src && !screen" class="missing" data-loading="src">loading {{ src }}</div>
  <div v-else-if="!src && !layoutName" class="missing" data-error="layout-unspecified">layout 未指定（?layout= または ?src= を指定してください）</div>
  <div v-else-if="!screen" class="missing" data-error="fixture-not-found">fixture not found: {{ layoutName }}</div>

  <ShapeScreen
    v-else-if="!frame"
    :screen="screen"
    :shape="shape"
    :variant="variant"
    :elapsed-ms="elapsed"
    :reduced-motion="reducedMotion"
    :box="box"
    :data-clock="clockMode"
    :data-source="layoutSource?.origin === 'demo-sites' ? 'demo-sites' : undefined"
    @ready="start"
  />

  <div v-else class="scenario" :data-scenario="scenario" :data-clock="clockMode">
    <AmbientLayer
      v-show="frame.ambientVisible"
      :active="frame.ambientVisible"
      :seed="seed"
      :clock-epoch-ms="clockEpochMs"
      :site-name="siteName"
      :shape="shape"
      :scene="sceneQuery"
      :room="crop ? room : undefined"
      :crop="crop"
      :seam="seam"
      :bare="bareAmbient"
      :lat="lat"
      :lng="lng"
    />
    <div
      class="alert-layer"
      :style="{ opacity: frame.alertVisible ? frame.alertOpacity : 0 }"
      :data-visible="frame.alertVisible ? '1' : '0'"
      data-layer="alert"
    >
      <ShapeScreen
        :screen="screen"
        :shape="shape"
        :variant="variant"
        :elapsed-ms="frame.alertElapsedMs"
        :reduced-motion="reducedMotion"
        :box="box"
        :data-source="layoutSource?.origin === 'demo-sites' ? 'demo-sites' : undefined"
      />
    </div>
    <div v-if="frame.black" class="black" data-layer="black" />
  </div>
</template>

<style scoped>
.missing {
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
