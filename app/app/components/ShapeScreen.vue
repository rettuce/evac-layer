<script setup lang="ts">
import type { LadderMode } from '~~/layout/ladder'
import type { EvacScreen, Shape } from '~~/layout/types'

defineProps<{
  screen: EvacScreen
  shape: Shape
  variant?: number
  elapsedMs: number
  reducedMotion?: boolean
  ladder?: LadderMode
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
    :ladder="ladder"
    @ready="emit('ready')"
  />
  <EvacScreen
    v-else
    :screen="screen"
    :shape="shape"
    :variant="variant"
    :elapsed-ms="elapsedMs"
    :reduced-motion="reducedMotion"
    :ladder="ladder"
    @ready="emit('ready')"
  />
</template>
