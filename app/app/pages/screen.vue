<script setup lang="ts">
import { isShape, shapeForViewport } from '~~/layout/shapes'
import type { EvacScreen } from '~~/layout/types'

const fixtures = import.meta.glob<EvacScreen>('../../fixtures/*.json', { eager: true, import: 'default' })

function fixtureByName(name: string): EvacScreen | undefined {
  return fixtures[`../../fixtures/${name}.json`]
}

const route = useRoute()
const layoutName = computed(() => String(route.query.layout ?? 'wajima-tsunami'))
const screen = computed(() => fixtureByName(layoutName.value))
const shape = computed(() => {
  const requested = route.query.shape
  return isShape(requested) ? requested : shapeForViewport(window.innerWidth, window.innerHeight)
})
</script>

<template>
  <EvacScreen v-if="screen" :screen="screen" :shape="shape" />
  <p v-else class="missing" data-error="fixture-not-found">fixture not found: {{ layoutName }}</p>
</template>

<style scoped>
.missing {
  font-family: 'Noto Sans', sans-serif;
  padding: 48px;
}
</style>
