<script setup lang="ts">
import { PILLAR } from '~~/layout/shapes'
import type { EvacScreen } from '~~/layout/types'

const props = defineProps<{
  screen: EvacScreen
  variant?: number
  elapsedMs: number
  reducedMotion?: boolean
}>()
const emit = defineEmits<{ ready: [] }>()

const FACES = Array.from({ length: PILLAR.faces }, (_, i) => i)
const FACE_BOX = { width: PILLAR.faceWidth, height: PILLAR.height, scale: PILLAR.faceScale }
const COPIED_STATE = ['template', 'variant', 'level', 'dropped', 'missingRequired', 'overflow', 'headlineScale', 'bulletinId'] as const

const firstFace = ref<HTMLElement>()
const readyFaces = ref(new Set<number>())
const state = ref<Record<string, string | undefined>>({})
const ready = computed(() => readyFaces.value.size === FACES.length)

function onFaceReady(face: number) {
  readyFaces.value = new Set(readyFaces.value).add(face)
  if (!ready.value) return
  const faceRoot = firstFace.value?.querySelector<HTMLElement>('.evac-screen')
  state.value = Object.fromEntries(COPIED_STATE.map((key) => [key, faceRoot?.dataset[key]]))
  emit('ready')
}

watch(
  () => [props.screen, props.variant],
  () => {
    readyFaces.value = new Set()
  },
)
</script>

<template>
  <main
    class="evac-screen pillar-screen"
    :style="{ width: `${PILLAR.faceWidth * PILLAR.faces}px`, height: `${PILLAR.height}px` }"
    data-shape="pillar"
    :data-faces="PILLAR.faces"
    :data-face-shape="PILLAR.faceShape"
    :data-template="state.template"
    :data-variant="state.variant"
    :data-level="state.level"
    :data-dropped="state.dropped"
    :data-missing-required="state.missingRequired || undefined"
    :data-overflow="state.overflow || undefined"
    :data-headline-scale="state.headlineScale"
    :data-bulletin-id="state.bulletinId"
    :data-ready="ready ? '1' : '0'"
  >
    <div
      v-for="face in FACES"
      :key="face"
      :ref="face === 0 ? (el) => (firstFace = el as HTMLElement) : undefined"
      class="pillar-face"
      :style="{ left: `${face * PILLAR.faceWidth}px` }"
      :data-face="face"
      :aria-hidden="face > 0 ? 'true' : undefined"
    >
      <EvacScreen
        :screen="screen"
        shape="pillar"
        :variant="variant"
        :elapsed-ms="elapsedMs"
        :reduced-motion="reducedMotion"
        :box="FACE_BOX"
        @ready="onFaceReady(face)"
      />
    </div>
  </main>
</template>

<style scoped>
.evac-screen.pillar-screen {
  position: relative;
  display: block;
  overflow: hidden;
  background: var(--bg, rgb(255 255 255));
}
.pillar-face {
  position: absolute;
  top: 0;
}
</style>
