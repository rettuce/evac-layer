<script setup lang="ts">
const props = defineProps<{ id: string; sizePx: number; rotation?: number }>()

const PLACEHOLDER_LABEL_RATIO = 1 / 6
const PLACEHOLDER_LABEL_MIN_PX = 12

const labelPx = computed(() => Math.max(PLACEHOLDER_LABEL_MIN_PX, Math.round(props.sizePx * PLACEHOLDER_LABEL_RATIO)))
const isArrow = computed(() => props.id === 'arrow_forward')
</script>

<template>
  <div
    class="pictogram"
    :data-pictogram="id"
    :style="{ '--size': sizePx, '--label': labelPx, '--rotation': `${rotation ?? 0}deg` }"
  >
    <svg v-if="isArrow" class="arrow" viewBox="0 0 100 100" aria-hidden="true">
      <polygon points="8,40 58,40 58,16 94,50 58,84 58,60 8,60" />
    </svg>
    <span v-else class="placeholder">{{ id }}</span>
  </div>
</template>

<style scoped>
.pictogram {
  flex: none;
  width: calc(var(--size) * var(--px));
  height: calc(var(--size) * var(--px));
  display: grid;
  place-items: center;
  overflow: hidden;
}
.arrow {
  width: 100%;
  height: 100%;
  fill: currentColor;
  transform: rotate(var(--rotation));
}
.placeholder {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  padding: calc(4 * var(--px));
  border: calc(4 * var(--px)) solid currentColor;
  font-size: calc(var(--label) * var(--px));
  line-height: 1.2;
  font-weight: 400;
  text-align: center;
  word-break: break-all;
}
</style>
