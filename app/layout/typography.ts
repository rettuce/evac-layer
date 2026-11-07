import { BASE_SHORT_SIDE_PX, UNIT_PX } from './shapes'
import type { LangKey, ShelterKind } from './types'

// Signage rule of thumb: 1 inch of letter height per 10 ft of viewing distance.
export const LETTER_HEIGHT_PER_VIEW_DISTANCE = 1 / 120

const MM_PER_INCH = 25.4
export const REFERENCE_PANEL_DIAGONAL_IN = 55
export const REFERENCE_PANEL_ASPECT = { long: 16, short: 9 } as const
export const REFERENCE_PANEL_SHORT_SIDE_MM =
  (REFERENCE_PANEL_DIAGONAL_IN * MM_PER_INCH * REFERENCE_PANEL_ASPECT.short) /
  Math.hypot(REFERENCE_PANEL_ASPECT.long, REFERENCE_PANEL_ASPECT.short)
export const MM_PER_DESIGN_PX = REFERENCE_PANEL_SHORT_SIDE_MM / BASE_SHORT_SIDE_PX

export const VIEW_DISTANCE_M = {
  action: 11,
  guide: 5,
  fine: 2,
} as const

export type TypeStep = keyof typeof VIEW_DISTANCE_M

const LARGE_TYPE_MIN_PX = 64

function snapToGrid(px: number): number {
  const step = px >= LARGE_TYPE_MIN_PX ? UNIT_PX : UNIT_PX / 2
  return Math.round(px / step) * step
}

export function fontPxForViewDistance(meters: number): number {
  const letterHeightMm = meters * 1000 * LETTER_HEIGHT_PER_VIEW_DISTANCE
  return snapToGrid(letterHeightMm / MM_PER_DESIGN_PX)
}

export const TYPE_PX: Record<TypeStep, number> = {
  action: fontPxForViewDistance(VIEW_DISTANCE_M.action),
  guide: fontPxForViewDistance(VIEW_DISTANCE_M.guide),
  fine: fontPxForViewDistance(VIEW_DISTANCE_M.fine),
}

export const HEADLINE_STACKED_MAX_LINES = 2
// Headline and facility name shrink to the same floor (decision 2026-11-05).
export const HEADLINE_STEP_DOWN = 0.8

// The headline is held to the guide step, so its one step down stops there; a name that still does not fit
// takes another line instead (decision 2026-11-06 E-R2: the JMA name is never cut or tightened).
export function headlineStepScale(basePx: number): number {
  return Math.min(1, Math.max(HEADLINE_STEP_DOWN, TYPE_PX.guide / basePx))
}
// The source line never wraps; one that does not fit its line is set one step smaller (decision 2026-11-05 L-7).
export const SOURCE_STEP_DOWN = 0.9
// A facility name that wraps is set one step smaller first (the 9:16 artboard's 90 → 72).
export const SHELTER_STEP_DOWN = 0.8

export const SHELTER_PICTOGRAM_RATIO = 1.6
export const SHELTER_PICTOGRAM_PX = Math.round(TYPE_PX.guide * SHELTER_PICTOGRAM_RATIO)

export const LINE_HEIGHT: Record<TypeStep, number> = {
  action: 1.15,
  guide: 1.3,
  fine: 1.4,
}

// Two languages at a time, so the ten (ja itself is the action text) come round in 12.5 s: one at a
// time would take over 20 s, and a reader leaves before meeting their own language.
export const LANGUAGE_ROTATION: LangKey[] = ['ja_easy', 'en', 'zh_hans', 'zh_hant', 'ko', 'th', 'vi', 'fil', 'id']
export const LANGUAGES_AT_ONCE = 2
export const LANGUAGE_ROTATION_MS = 2500

export const HTML_LANG: Record<LangKey, string> = {
  ja: 'ja',
  ja_easy: 'ja',
  en: 'en',
  zh_hans: 'zh-Hans',
  zh_hant: 'zh-Hant',
  ko: 'ko',
  th: 'th',
  vi: 'vi',
  fil: 'fil',
  id: 'id',
}

export const LANG_LABEL: Record<LangKey, string> = {
  ja: 'JA',
  ja_easy: 'やさしい にほんご',
  en: 'EN',
  zh_hans: '简体中文',
  zh_hant: '繁體中文',
  ko: '한국어',
  th: 'ไทย',
  vi: 'Tiếng Việt',
  fil: 'Filipino',
  id: 'Bahasa Indonesia',
}

// Fixed vocabulary from the Disaster Countermeasures Basic Act categories; the Writer never rewrites it.
export const SHELTER_KIND_LABEL: Readonly<Record<ShelterKind, Readonly<Partial<Record<LangKey, string>> & { ja: string; en: string }>>> = {
  emergency_evacuation_site: {
    ja: '指定緊急避難場所',
    en: 'Emergency evacuation site',
    zh_hans: '指定紧急避难场所',
    zh_hant: '指定緊急避難場所',
    ko: '지정 긴급 대피 장소',
  },
  evacuation_shelter: {
    ja: '指定避難所',
    en: 'Evacuation shelter',
    zh_hans: '指定避难所',
    zh_hant: '指定避難所',
    ko: '지정 대피소',
  },
}

export const SHELTER_NAME_MAX_LINES = 2
