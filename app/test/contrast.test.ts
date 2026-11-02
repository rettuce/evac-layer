import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CABINET_OFFICE_5, DARK_BAND, LANG_LABEL_OPACITY, PAGE_BACKGROUND, PAGE_INK, SHELTER_KIND_OPACITY, contrastRatio, inkOn } from '../layout/palette.ts'
import type { AlertLevel } from '../layout/types'

type Rgb = readonly [number, number, number]

// WCAG 2.x: 4.5:1 for normal text, 3:1 for large text. Band text includes the small source line on the
// pillar foot band, so every band is held to the normal-text threshold.
const NORMAL_TEXT = 4.5
const LEVELS: AlertLevel[] = [1, 2, 3, 4, 5]

function over(foreground: Rgb, background: Rgb, opacity: number): Rgb {
  return foreground.map((c, i) => Math.round(c * opacity + background[i]! * (1 - opacity))) as unknown as Rgb
}

test('band text (headline, level label, foot-band source) reads at 4.5:1 on every level colour', () => {
  for (const level of LEVELS) {
    const band = CABINET_OFFICE_5[level]
    const ratio = contrastRatio(band, inkOn(band))
    assert.ok(ratio >= NORMAL_TEXT, `level ${level}: ${ratio.toFixed(2)}`)
  }
})

test('white text would fail on the level 2 yellow and level 3 red bands, so the ink rule picks black there', () => {
  const white: Rgb = [255, 255, 255]
  const black: Rgb = [0, 0, 0]
  for (const level of [2, 3] as AlertLevel[]) {
    assert.ok(contrastRatio(CABINET_OFFICE_5[level], white) < NORMAL_TEXT)
    assert.deepEqual(inkOn(CABINET_OFFICE_5[level]), black)
  }
})

test('page text, the dark band and the reduced-opacity labels stay above 4.5:1', () => {
  assert.ok(contrastRatio(PAGE_INK, PAGE_BACKGROUND) >= NORMAL_TEXT)
  const darkInk = inkOn(DARK_BAND)
  assert.ok(contrastRatio(darkInk, DARK_BAND) >= NORMAL_TEXT)
  for (const opacity of [SHELTER_KIND_OPACITY, LANG_LABEL_OPACITY]) {
    assert.ok(contrastRatio(over(PAGE_INK, PAGE_BACKGROUND, opacity), PAGE_BACKGROUND) >= NORMAL_TEXT, `on page at ${opacity}`)
    assert.ok(contrastRatio(over(darkInk, DARK_BAND, opacity), DARK_BAND) >= NORMAL_TEXT, `on dark band at ${opacity}`)
  }
})
