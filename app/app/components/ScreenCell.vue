<script setup lang="ts">
import { HTML_LANG, LANG_LABEL, LANGUAGE_ROTATION } from '~~/layout/typography'
import type { AlertLevel, LangKey, LayoutCell } from '~~/layout/types'
import { LEVEL_LABEL_JA } from '~~/layout/palette'

const props = defineProps<{
  cell: LayoutCell
  level: AlertLevel
  pictogramPx: number
  languageIndex: number
}>()

const rotationLangs = computed<LangKey[]>(() => LANGUAGE_ROTATION.filter((key) => props.cell.text[key]))
const currentLang = computed(() => {
  const langs = rotationLangs.value
  return langs.length ? langs[props.languageIndex % langs.length] : undefined
})
</script>

<template>
  <div class="cell-body" :class="`role-${cell.role}`">
    <template v-if="cell.role === 'headline'">
      <PictogramMark v-if="cell.pictogram && pictogramPx" :id="cell.pictogram" :size-px="pictogramPx" />
      <p class="t-guide headline-text">{{ cell.text.ja }}</p>
      <p class="t-guide level-label">{{ LEVEL_LABEL_JA[level] }}</p>
    </template>

    <template v-else-if="cell.role === 'action'">
      <p class="t-action action-text">{{ cell.text.ja }}</p>
      <div class="action-sub">
        <PictogramMark v-if="cell.pictogram && pictogramPx" :id="cell.pictogram" :size-px="pictogramPx" />
        <p v-if="cell.text.ja_easy" class="t-guide" lang="ja">{{ cell.text.ja_easy }}</p>
      </div>
    </template>

    <template v-else-if="cell.role === 'direction'">
      <PictogramMark
        v-if="cell.pictogram && pictogramPx"
        :id="cell.pictogram"
        :size-px="pictogramPx"
        :rotation="cell.rotation"
      />
      <p class="t-guide">{{ cell.text.ja }}</p>
    </template>

    <template v-else-if="cell.role === 'shelter'">
      <div class="shelter-name">
        <PictogramMark v-if="cell.pictogram && pictogramPx" :id="cell.pictogram" :size-px="pictogramPx" />
        <p class="t-guide">{{ cell.text.ja }}</p>
      </div>
      <p v-if="cell.distance_m !== undefined" class="t-guide distance">{{ cell.distance_m }} m</p>
    </template>

    <template v-else-if="cell.role === 'languages'">
      <div class="lang-stack">
        <div
          v-for="key in rotationLangs"
          :key="key"
          class="lang-variant"
          :class="{ 'is-current': key === currentLang, 'm-scale-in': key === currentLang }"
          :lang="HTML_LANG[key]"
          :data-lang="key"
        >
          <span class="t-fine lang-label">{{ LANG_LABEL[key] }}</span>
          <p class="t-guide">{{ cell.text[key] }}</p>
        </div>
      </div>
    </template>

    <template v-else>
      <p class="t-fine">{{ cell.text.ja }}</p>
    </template>
  </div>
</template>

<style scoped>
.cell-body {
  height: 100%;
  min-width: 0;
}
p {
  margin: 0;
}
.role-headline {
  display: flex;
  align-items: center;
  gap: calc(24 * var(--px));
  padding: 0 calc(48 * var(--px));
}
.role-headline .level-label {
  margin-left: auto;
}
.is-inline .role-direction,
.is-inline .role-shelter {
  flex-direction: row;
  align-items: center;
  gap: calc(48 * var(--px));
}
.shape-ribbon .role-headline {
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
}
.shape-ribbon .role-headline .level-label {
  margin-left: 0;
}
.role-action,
.role-direction,
.role-shelter {
  display: flex;
  flex-direction: column;
  gap: calc(24 * var(--px));
}
.action-sub,
.shelter-name {
  display: flex;
  align-items: center;
  gap: calc(24 * var(--px));
}
.distance {
  flex: none;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.role-languages {
  display: flex;
  align-items: center;
}
.lang-stack {
  display: grid;
  width: 100%;
}
.lang-variant {
  grid-area: 1 / 1;
  display: flex;
  align-items: baseline;
  gap: calc(32 * var(--px));
  visibility: hidden;
}
.lang-variant.is-current {
  visibility: visible;
}
.lang-label {
  flex: none;
  min-width: calc(200 * var(--px));
  opacity: 0.7;
}
</style>
