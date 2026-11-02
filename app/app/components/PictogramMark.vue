<script setup lang="ts">
const props = defineProps<{ id: string; sizePx: number; rotation?: number }>()

const SVG_BY_PATH = import.meta.glob<string>('../../public/picto/*.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
})

const PLACEHOLDER_LABEL_RATIO = 1 / 6
const PLACEHOLDER_LABEL_MIN_PX = 12

const svg = computed(() => SVG_BY_PATH[`../../public/picto/${props.id}.svg`])
const labelPx = computed(() => Math.max(PLACEHOLDER_LABEL_MIN_PX, Math.round(props.sizePx * PLACEHOLDER_LABEL_RATIO)))
</script>

<template>
  <div
    class="pictogram"
    :data-pictogram="id"
    :data-pictogram-missing="svg ? undefined : '1'"
    :style="{ '--size': sizePx, '--label': labelPx, '--rotation': `${rotation ?? 0}deg` }"
  >
    <div v-if="svg" class="glyph" aria-hidden="true" v-html="svg" />
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
.glyph {
  width: 100%;
  height: 100%;
  transform: rotate(var(--rotation));
}
.glyph :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
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
