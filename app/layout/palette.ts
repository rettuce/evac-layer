import type { AlertLevel, TemplateId } from './types'

type Rgb = readonly [number, number, number]

// Cabinet Office warning-level colors (2020-05-29), used as given.
export const CABINET_OFFICE_5: Record<AlertLevel, Rgb> = {
  5: [12, 0, 12],
  4: [170, 0, 170],
  3: [255, 40, 0],
  2: [242, 231, 0],
  1: [255, 255, 255],
}

export const LEVEL_LABEL_JA: Record<AlertLevel, string> = {
  5: '警戒レベル5',
  4: '警戒レベル4',
  3: '警戒レベル3',
  2: '警戒レベル2',
  1: '警戒レベル1',
}

// A cleared bulletin has no warning level; its white band is only the colour of level 1.
export function levelLabelFor(template: TemplateId, level: AlertLevel): string | undefined {
  return template === 'all-clear' ? undefined : LEVEL_LABEL_JA[level]
}

// Secondary labels are drawn in the cell's ink at reduced opacity; test/contrast.test.ts keeps them
// above WCAG 4.5:1 on every background they appear on.
export const SHELTER_KIND_OPACITY = 0.75
export const LANG_LABEL_OPACITY = 0.7

export const PAGE_BACKGROUND: Rgb = [255, 255, 255]
export const PAGE_INK: Rgb = [0, 0, 0]
export const DARK_BAND: Rgb = [0, 0, 0]

export function rgbCss([r, g, b]: Rgb): string {
  return `rgb(${r} ${g} ${b})`
}

function channelToLinear(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b)
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

const WHITE: Rgb = [255, 255, 255]
const BLACK: Rgb = [0, 0, 0]

export function inkOn(background: Rgb): Rgb {
  return contrastRatio(background, WHITE) >= contrastRatio(background, BLACK) ? WHITE : BLACK
}
