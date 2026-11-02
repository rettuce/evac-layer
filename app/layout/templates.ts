import type { ShapeLayout, TemplateDef, TemplateId } from './types'

const M = 48
const G = 24
const BAND = 176

const LANDSCAPE: ShapeLayout = {
  columns: [M, '3fr', M, '2fr', M],
  rows: [BAND, M, '1fr', G, '1fr', G, 'auto', 16, 'auto', 40],
  areas: [
    'headline headline headline headline headline',
    '. . . . .',
    '. action . shelter .',
    '. action . direction .',
    '. action . direction .',
    '. . . . .',
    '. languages languages languages .',
    '. . . . .',
    '. source source source .',
    '. . . . .',
  ],
  required: ['headline', 'action', 'direction', 'shelter', 'source'],
  pictogramPx: { headline: 112, action: 192, direction: 192, shelter: 64 },
}

const PORTRAIT: ShapeLayout = {
  columns: [M, '1fr', M],
  rows: [BAND, M, '1fr', G, 'auto', G, 'auto', G, 'auto', 16, 'auto', 40],
  areas: [
    'headline headline headline',
    '. . .',
    '. action .',
    '. . .',
    '. direction .',
    '. . .',
    '. shelter .',
    '. . .',
    '. languages .',
    '. . .',
    '. source .',
    '. . .',
  ],
  required: ['headline', 'action', 'direction', 'shelter', 'source'],
  pictogramPx: { headline: 112, action: 320, direction: 192, shelter: 64 },
}

const RIBBON: ShapeLayout = {
  columns: [720, M, '4fr', M, '3fr', M, '3fr', M],
  rows: [M, 'auto', G, '1fr', M, 256],
  areas: [
    'headline . . . . . . .',
    'headline . source source source source source .',
    'headline . . . . . . .',
    'headline . action . direction . shelter .',
    'headline . . . . . . .',
    'headline languages languages languages languages languages languages languages',
  ],
  required: ['headline', 'action', 'direction', 'source'],
  pictogramPx: { headline: 160, action: 288, direction: 288, shelter: 96 },
  darkBand: ['languages'],
}

const SQUARE: ShapeLayout = {
  columns: [M, '1fr', M],
  rows: [BAND, M, '1fr', G, 'auto', G, 'auto', G, 'auto', 16, 'auto', 40],
  areas: [
    'headline headline headline',
    '. . .',
    '. action .',
    '. . .',
    '. languages .',
    '. . .',
    '. direction .',
    '. . .',
    '. shelter .',
    '. . .',
    '. source .',
    '. . .',
  ],
  required: ['headline', 'action', 'source'],
  pictogramPx: { headline: 112, action: 160, direction: 128, shelter: 64 },
}

export const TEMPLATES: Partial<Record<TemplateId, TemplateDef>> = {
  'evac-now': {
    '16x9': LANDSCAPE,
    '9x16': PORTRAIT,
    '32x9': RIBBON,
    '1x1': SQUARE,
  },
}

export function areaRoles(layout: ShapeLayout): Set<string> {
  return new Set(layout.areas.flatMap((row) => row.split(/\s+/)).filter((name) => name !== '.'))
}
