<script setup lang="ts">
import { DEFAULT_REPLAY_SPEED, isMunicipalityId } from '~~/layout/replay'
import { DEFAULT_SWITCH_AT_MS, scenarioFrame, type ScenarioName } from '~~/layout/scenario'
import { designScale, isShape, shapeForViewport, viewportFromQuery } from '~~/layout/shapes'
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
const layoutName = computed(() => String(route.query.layout ?? 'wajima-tsunami'))
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

const screen = computed(() => (src.value ? remote.value : fixtureByName(layoutName.value)))
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
const seed = computed(() => String(route.query.seed ?? layoutName.value))
const siteName = computed(() => String(route.query.site_name ?? screen.value?.municipality.name ?? ''))
const realStartEpoch = Date.now()
const clockEpochMs = computed(() => {
  if (clockMode.value === 'real') return realStartEpoch + elapsed.value
  const issued = screen.value ? Date.parse(screen.value.alert.issued_at) : 0
  return issued - switchAtMs.value + elapsed.value
})

const liveMunicipality = computed(() =>
  route.query.mode === 'live' && isMunicipalityId(route.query.municipality) ? route.query.municipality : undefined,
)
const liveSpeed = computed(() => numberQuery(route.query.speed, DEFAULT_REPLAY_SPEED))

if (scenario.value) start()
</script>

<template>
  <LiveScreen
    v-if="liveMunicipality"
    :municipality="liveMunicipality"
    :shape="shape"
    :speed="liveSpeed"
    :from="typeof route.query.from === 'string' ? route.query.from : undefined"
    :to="typeof route.query.to === 'string' ? route.query.to : undefined"
    :virtual-elapsed-ms="clockMode === 'virtual' ? elapsed : undefined"
    :site="typeof route.query.site === 'string' ? route.query.site : undefined"
    :site-name="typeof route.query.site_name === 'string' ? route.query.site_name : undefined"
    :reset="route.query.reset !== undefined"
    :scene="sceneQuery"
    :stale-after-ms="route.query.stale_after === undefined ? undefined : numberQuery(route.query.stale_after, 0)"
    :reduced-motion="reducedMotion"
    :data-clock="clockMode"
  />
  <div v-else-if="srcRejected" class="missing" data-error="src-rejected">src must be a same-origin path (production: the layout store only)</div>
  <div v-else-if="remoteError" class="missing" data-error="src-load-failed">{{ remoteError }}</div>
  <div v-else-if="src && !screen" class="missing" data-loading="src">loading {{ src }}</div>
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
