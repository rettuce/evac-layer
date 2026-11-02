import { CABINET_OFFICE_5, inkOn, rgbCss } from './palette.ts'
import type { AlertLevel, TemplateId } from './types'

export interface ScaleStep {
  label: string
  name?: string
  color: string
  ink: string
  tint: string
}

export interface LevelScale {
  kind: 'alert' | 'tsunami'
  title: { ja: string; en: string }
  steps: ScaleStep[]
  current: number
  currentName: { ja: string; en: string }
}

const ALERT_LEVELS: AlertLevel[] = [1, 2, 3, 4, 5]
const TINT_STRENGTH = 0.5
// Level 1 is white; at any tint it would read as an empty cell, so it gets a light grey instead.
const LEVEL_1_TINT = 'rgb(236 236 236)'

// Tsunami bulletins are outside the Cabinet Office five levels; the Composer maps them onto
// level colours (advisory → 2, warning → 3, major warning → 4), so the scale has three steps.
const TSUNAMI_STEPS: { level: AlertLevel; short: string; ja: string; en: string }[] = [
  { level: 2, short: '注意報', ja: '津波注意報', en: 'Tsunami Advisory' },
  { level: 3, short: '警報', ja: '津波警報', en: 'Tsunami Warning' },
  { level: 4, short: '大津波警報', ja: '大津波警報', en: 'Major Tsunami Warning' },
]

function tintOf(level: AlertLevel): string {
  if (level === 1) return LEVEL_1_TINT
  const [r, g, b] = CABINET_OFFICE_5[level].map((c) => Math.round(255 - (255 - c) * TINT_STRENGTH))
  return `rgb(${r} ${g} ${b})`
}

function step(label: string, level: AlertLevel, name?: string): ScaleStep {
  const color = CABINET_OFFICE_5[level]
  return { label, ...(name ? { name } : {}), color: rgbCss(color), ink: rgbCss(inkOn(color)), tint: tintOf(level) }
}

export function levelScaleFor(template: TemplateId, hazard: string, level: AlertLevel): LevelScale | undefined {
  if (template === 'all-clear') return undefined
  if (hazard === 'tsunami') {
    const current = TSUNAMI_STEPS.findIndex((s) => s.level === level) + 1
    const named = TSUNAMI_STEPS[current - 1]
    return {
      kind: 'tsunami',
      title: { ja: '津波', en: 'Tsunami' },
      steps: TSUNAMI_STEPS.map((s, i) => step(String(i + 1), s.level, s.short)),
      current,
      currentName: named ? { ja: named.ja, en: named.en } : { ja: '', en: '' },
    }
  }
  return {
    kind: 'alert',
    title: { ja: '警戒レベル', en: 'Alert Level' },
    steps: ALERT_LEVELS.map((l) => step(String(l), l)),
    current: level,
    currentName: { ja: `警戒レベル${level}`, en: `Alert Level ${level}` },
  }
}

export function levelScaleAttr(scale: LevelScale | undefined): string | undefined {
  return scale ? `${scale.steps.length}:${scale.current}` : undefined
}

export interface LevelBadge {
  value: string
  color: string
  ink: string
}

// On the level-5 black band a black disc would vanish, so the badge turns white with a black numeral.
export function levelBadgeFor(scale: LevelScale | undefined): LevelBadge | undefined {
  const current = scale?.steps[scale.current - 1]
  if (!scale || !current) return undefined
  const inverted = scale.kind === 'alert' && scale.current === 5
  return {
    value: current.label,
    color: inverted ? 'rgb(255 255 255)' : current.color,
    ink: inverted ? 'rgb(0 0 0)' : current.ink,
  }
}
