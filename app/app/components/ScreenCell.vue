<script setup lang="ts">
import { headlineParts } from '~~/layout/headline'
import { HEADLINE_STACKED_MAX_LINES, HTML_LANG, LANG_LABEL, LANGUAGES_AT_ONCE, LANGUAGE_ROTATION, SHELTER_KIND_LABEL, SHELTER_NAME_MAX_LINES } from '~~/layout/typography'
import type { LangKey, LayoutCell } from '~~/layout/types'

const props = defineProps<{
  cell: LayoutCell
  levelLabel?: string
  stackedHeadline?: boolean
  headlineLimited?: boolean
  easyInAction?: boolean
  headlineScale?: number
  pictogramPx: number
  languageIndex: number
  languageStyle: Record<string, string | number>
}>()

const rotationLangs = computed<LangKey[]>(() => LANGUAGE_ROTATION.filter((key) => props.cell.text[key]))
const headlineStyle = computed(() =>
  props.headlineScale && props.headlineScale !== 1 ? { fontSize: `calc(var(--fs-guide) * ${props.headlineScale} * var(--type-scale, 1) * var(--px))` } : undefined,
)
const languageGroups = computed<LangKey[][]>(() => {
  const langs = rotationLangs.value
  return Array.from({ length: Math.ceil(langs.length / LANGUAGES_AT_ONCE) }, (_, i) => langs.slice(i * LANGUAGES_AT_ONCE, (i + 1) * LANGUAGES_AT_ONCE))
})
const currentGroup = computed(() => (languageGroups.value.length ? props.languageIndex % languageGroups.value.length : -1))
</script>

<template>
  <div class="cell-body" :class="[`role-${cell.role}`, { 'is-stacked': cell.role === 'headline' && stackedHeadline }]">
    <template v-if="cell.role === 'headline'">
      <PictogramMark v-if="cell.pictogram && pictogramPx" :id="cell.pictogram" :size-px="pictogramPx" />
      <p
        class="t-guide headline-text"
        :style="headlineStyle"
        :data-max-lines="headlineLimited ? HEADLINE_STACKED_MAX_LINES : undefined"
      ><template v-if="headlineParts(cell.text.ja).lead"><span class="keep">{{ headlineParts(cell.text.ja).lead }}</span> {{ headlineParts(cell.text.ja).rest }}</template><template v-else>{{ cell.text.ja }}</template></p>
      <p v-if="levelLabel" class="t-guide level-label">{{ levelLabel }}</p>
    </template>

    <template v-else-if="cell.role === 'action'">
      <p class="t-action action-text">{{ cell.text.ja }}</p>
      <div class="action-sub">
        <PictogramMark v-if="cell.pictogram && pictogramPx" :id="cell.pictogram" :size-px="pictogramPx" align-bottom />
        <p v-if="cell.text.ja_easy && easyInAction" class="t-guide" lang="ja" data-lang="ja_easy">{{ cell.text.ja_easy }}</p>
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
        <div class="shelter-text">
          <p v-if="cell.kind" class="t-fine shelter-kind" :data-kind="cell.kind">
            {{ SHELTER_KIND_LABEL[cell.kind].ja }}<span lang="en"> / {{ SHELTER_KIND_LABEL[cell.kind].en }}</span>
          </p>
          <p class="t-guide" :data-max-lines="SHELTER_NAME_MAX_LINES">{{ cell.text.ja }}</p>
        </div>
      </div>
      <p v-if="cell.distance_m !== undefined" class="t-guide distance">{{ cell.distance_m }} m</p>
    </template>

    <template v-else-if="cell.role === 'languages'">
      <div class="lang-stack">
        <div
          v-for="(group, g) in languageGroups"
          :key="group.join('+')"
          class="lang-variant"
          :class="{ 'is-current': g === currentGroup }"
          :style="g === currentGroup ? languageStyle : undefined"
          :data-lang-group="group.join('+')"
        >
          <div v-for="key in group" :key="key" class="lang-line" :lang="HTML_LANG[key]" :data-lang="key">
            <span class="t-fine lang-label">{{ LANG_LABEL[key] }}</span>
            <p class="t-guide">{{ cell.text[key] }}</p>
          </div>
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
  white-space: nowrap;
}
.role-headline.is-stacked {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  grid-template-areas:
    'pictogram text'
    'pictogram label';
  align-content: center;
  row-gap: 0;
  min-height: calc(var(--stacked-band-min) * var(--px));
}
.role-headline.is-stacked > .pictogram {
  grid-area: pictogram;
  align-self: center;
}
.role-headline.is-stacked .headline-text {
  grid-area: text;
}
.role-headline.is-stacked .level-label {
  grid-area: label;
  margin-left: 0;
  text-align: right;
}
.role-headline .headline-text {
  min-width: 0;
}
.headline-text .keep {
  white-space: nowrap;
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
  gap: calc(16 * var(--px));
}
.role-direction {
  flex-direction: row;
  align-items: center;
  gap: calc(16 * var(--px));
}
.shape-ribbon .lang-variant {
  flex-direction: row;
  gap: calc(96 * var(--px));
}
.shape-ribbon .lang-line {
  flex: 1 1 0;
  min-width: 0;
}
.action-sub,
.shelter-name {
  display: flex;
  align-items: center;
  gap: calc(24 * var(--px));
}
.action-sub {
  margin-top: auto;
  align-items: flex-end;
}
.shelter-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: calc(16 * var(--px));
}
.shelter-kind {
  opacity: var(--shelter-kind-opacity);
}
.distance {
  flex: none;
  margin-left: auto;
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
  flex-direction: column;
  gap: calc(16 * var(--px));
  visibility: hidden;
}
.lang-line {
  display: flex;
  align-items: baseline;
  gap: calc(32 * var(--px));
}
.lang-variant.is-current {
  visibility: visible;
}
.lang-label {
  flex: none;
  width: calc(256 * var(--px));
  opacity: var(--lang-label-opacity);
}
</style>
