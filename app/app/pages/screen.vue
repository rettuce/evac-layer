<script setup lang="ts">
import { DEFAULT_REPLAY_SPEED, isMunicipalityId } from '~~/layout/replay'
import { DEFAULT_SWITCH_AT_MS, scenarioFrame, type ScenarioName } from '~~/layout/scenario'
import { isShape, shapeForViewport } from '~~/layout/shapes'
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
// Guidance screens must never show a document from an arbitrary origin, so src is a
// dev-only bridge for the Verifier and accepts same-origin paths only.
function isAllowedSrc(value: unknown): value is string {
  return import.meta.dev && typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
}
const src = computed(() => (isAllowedSrc(route.query.src) ? route.query.src : undefined))
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
      remote.value = await $fetch<EvacScreen>(url)
    } catch (error) {
      remoteError.value = `failed to load ${url}: ${(error as Error).message}`
    }
  },
  { immediate: true },
)

const screen = computed(() => (src.value ? remote.value : fixtureByName(layoutName.value)))
const variant = computed(() => numberQuery(route.query.variant, 0))
const shape = computed(() => {
  const requested = route.query.shape
  return isShape(requested) ? requested : shapeForViewport(window.innerWidth, window.innerHeight)
})

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
    :virtual-elapsed-ms="clockMode === 'virtual' ? elapsed : undefined"
    :site-name="typeof route.query.site_name === 'string' ? route.query.site_name : undefined"
    :reset="route.query.reset !== undefined"
    :reduced-motion="reducedMotion"
    :data-clock="clockMode"
  />
  <div v-else-if="srcRejected" class="missing" data-error="src-rejected">src must be a same-origin path (dev only)</div>
  <div v-else-if="remoteError" class="missing" data-error="src-load-failed">{{ remoteError }}</div>
  <div v-else-if="src && !screen" class="missing" data-loading="src">loading {{ src }}</div>
  <div v-else-if="!screen" class="missing" data-error="fixture-not-found">fixture not found: {{ layoutName }}</div>

  <EvacScreen
    v-else-if="!frame"
    :screen="screen"
    :shape="shape"
    :variant="variant"
    :elapsed-ms="elapsed"
    :reduced-motion="reducedMotion"
    :data-clock="clockMode"
    @ready="start"
  />

  <div v-else class="scenario" :data-scenario="scenario" :data-clock="clockMode">
    <AmbientLayer
      v-show="frame.ambientVisible"
      :seed="seed"
      :elapsed-ms="elapsed"
      :clock-epoch-ms="clockEpochMs"
      :site-name="siteName"
    />
    <div
      class="alert-layer"
      :style="{ opacity: frame.alertVisible ? frame.alertOpacity : 0 }"
      :data-visible="frame.alertVisible ? '1' : '0'"
      data-layer="alert"
    >
      <EvacScreen
        :screen="screen"
        :shape="shape"
        :variant="variant"
        :elapsed-ms="frame.alertElapsedMs"
        :reduced-motion="reducedMotion"
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
