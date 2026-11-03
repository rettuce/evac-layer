<script setup lang="ts">
import { sourceLines } from '~~/layout/sources'
import type { EvacScreen } from '~~/layout/types'

const props = defineProps<{ screen: EvacScreen }>()
const lines = computed(() => sourceLines(props.screen))
useHead({ meta: [{ name: 'sources', content: () => lines.value.join(' / ') }] })
</script>

<template>
  <footer hidden class="evac-sources" data-sources>
    <ul>
      <li v-for="line in lines" :key="line">{{ line }}</li>
    </ul>
  </footer>
</template>
