import { BASE_SHORT_SIDE_PX, UNIT_PX } from './shapes'
import type { LangKey } from './types'

// Signage rule of thumb: 1 inch of letter height per 10 ft of viewing distance.
// No normative standard (JIS / ISO) was found for screens, so this stays a named, replaceable constant.
export const LETTER_HEIGHT_PER_VIEW_DISTANCE = 1 / 120

// A 55-inch 16:9 panel is 685 mm tall; its 1080 px short side is the design base.
export const REFERENCE_PANEL_SHORT_SIDE_MM = 685
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

export const LINE_HEIGHT: Record<TypeStep, number> = {
  action: 1.15,
  guide: 1.3,
  fine: 1.4,
}

export const LANGUAGE_ROTATION: LangKey[] = ['ja_easy', 'en', 'zh_hans', 'ko']
export const LANGUAGE_ROTATION_MS = 6000

export const HTML_LANG: Record<LangKey, string> = {
  ja: 'ja',
  ja_easy: 'ja',
  en: 'en',
  zh_hans: 'zh-Hans',
  zh_hant: 'zh-Hant',
  ko: 'ko',
}

export const LANG_LABEL: Record<LangKey, string> = {
  ja: 'JA',
  ja_easy: 'やさしい にほんご',
  en: 'EN',
  zh_hans: '中文',
  zh_hant: '中文',
  ko: '한국어',
}
