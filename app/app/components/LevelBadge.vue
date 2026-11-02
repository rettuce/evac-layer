<script setup lang="ts">
import type { LevelBadge } from '~~/layout/levelScale'

defineProps<{ badge: LevelBadge; diameterPx: number }>()
</script>

<template>
  <span
    class="level-badge"
    :style="{ '--d': diameterPx, '--badge': badge.color, '--badge-ink': badge.ink }"
    :data-level-badge="badge.value"
    aria-hidden="true"
  >
    {{ badge.value }}
  </span>
</template>

<style scoped>
.level-badge {
  display: grid;
  flex: none;
  place-items: center;
  box-sizing: border-box;
  width: calc(var(--d) * var(--px));
  height: calc(var(--d) * var(--px));
  border: calc(6 * var(--px)) solid rgb(255 255 255);
  border-radius: 50%;
  background: var(--badge);
  color: var(--badge-ink);
  font-size: calc(var(--d) * 0.6 * var(--px));
  font-weight: 700;
  line-height: 1;
}
</style>
