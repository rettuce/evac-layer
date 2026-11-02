<script setup lang="ts">
import type { EvacScreen, Shape } from '~~/layout/types'

defineProps<{
  screen: EvacScreen
  shape: Shape
  variant?: number
  elapsedMs: number
  reducedMotion?: boolean
}>()
const emit = defineEmits<{ ready: [] }>()
</script>

<template>
  <PillarScreen
    v-if="shape === 'pillar'"
    :screen="screen"
    :variant="variant"
    :elapsed-ms="elapsedMs"
    :reduced-motion="reducedMotion"
    @ready="emit('ready')"
  />
  <EvacScreen
    v-else
    :screen="screen"
    :shape="shape"
    :variant="variant"
    :elapsed-ms="elapsedMs"
    :reduced-motion="reducedMotion"
    @ready="emit('ready')"
  />
</template>
