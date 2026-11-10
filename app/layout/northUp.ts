import { describeLayout, resolveLayout, type ResolvedTemplate } from './templates'
import type { NorthDial, Orientation, Shape, ShapeLayout, TemplateId } from './types'

// A site whose facing is unknown shows the way on a north-fixed dial (decision 2026-11-11, mock B): the circle with
// N and 北 on its top, the arrow at the 8-point map angle, and the direction word with the distance beside it. The
// distance leaves the shelter row so that it is shown once, except where the dial and two lines do not fit.

type AreaEdit = (areas: string[]) => string[]

function claim(rows: number[], cols: number[], role: string): AreaEdit {
  return (areas) =>
    areas.map((row, r) => {
      if (!rows.includes(r)) return row
      const names = row.split(/\s+/)
      for (const c of cols) {
        if (names[c] !== '.' && names[c] !== role) throw new Error(`north-up ${role} would cover ${names[c]} at row ${r}, column ${c}`)
        names[c] = role
      }
      return names.join(' ')
    })
}

// 9:16 sets the column from the top with auto rows: at levels 4 and 5 the action takes two lines (高い所へ上がって,
// 危険な場所から避難) and leaves about 100 px, so the dial is smaller and the distance stays on the shelter row. A level 3
// action of more than six characters also takes two lines; the screen then steps to the compact dial.
const PORTRAIT_ROOMY = new Set<TemplateId>(['evac-prepare'])

function landscape(base: ShapeLayout): ShapeLayout {
  return { ...base, areas: claim([4], [3], 'direction')(base.areas), north: { dialPx: 290, markPx: 58, words: 'stack', distanceOn: 'direction' } }
}

function portrait(base: ShapeLayout, template: TemplateId): ShapeLayout {
  const north: NorthDial = PORTRAIT_ROOMY.has(template)
    ? { dialPx: 300, markPx: 60, words: 'stack', distanceOn: 'direction', compact: { dialPx: 180, markPx: 44 } }
    : { dialPx: 180, markPx: 44, words: 'stack', distanceOn: 'shelter' }
  return { ...base, north }
}

// 32:9 keeps the direction's rows and takes the empty column on its left, so the dial and "南西へ 570m" sit on one line.
function ribbon(base: ShapeLayout): ShapeLayout {
  return { ...base, areas: claim([1, 2, 3], [3], 'direction')(base.areas), north: { dialPx: 260, markPx: 56, words: 'line', distanceOn: 'direction' } }
}

// 1:1 has 314 × 88 for the direction, so the artboard's shelter group becomes one block: the designation over the dial,
// the name and "南西へ 570 m" beside it. The two cells share the block's middle row (the shelter's name, the dial's
// upper half), so they are placed by grid lines; the flag pictogram gives its room to the dial.
function square(base: ShapeLayout): ShapeLayout {
  return {
    ...base,
    columns: [48, 202, 14, 136, 30, 614, 36],
    rows: [200, 27, 335, 26, 2, 44, 80, 86, '1fr', 260],
    areas: [
      'headline headline headline headline headline headline headline',
      '. . . . . . .',
      '. action action action action action .',
      '. . . . . . .',
      '. . . . . . .',
      '. hero . . . . .',
      '. hero . . . . .',
      '. hero . . . . .',
      'source source source source source source source',
      'languages languages languages languages languages languages languages',
    ],
    placement: { shelter: '6 / 4 / 8 / 7', direction: '7 / 4 / 9 / 7' },
    pictogramPx: { ...base.pictogramPx, shelter: 0 },
    type: { ...base.type, direction: 72 },
    north: { dialPx: 136, markPx: 32, words: 'line', distanceOn: 'direction' },
  }
}

// The pillar face takes the free row under the direction, so the word and the distance stand on two lines.
function pillar(base: ShapeLayout): ShapeLayout {
  return { ...base, areas: claim([11], [1, 2, 3], 'direction')(base.areas), north: { dialPx: 440, markPx: 96, words: 'stack', distanceOn: 'direction' } }
}

function northUp(base: ShapeLayout, shape: Shape, template: TemplateId): ShapeLayout {
  if (!base.required.includes('direction') && !base.required.includes('shelter')) return base
  const layout =
    shape === '16x9' ? landscape(base)
    : shape === '9x16' ? portrait(base, template)
    : shape === '32x9' ? ribbon(base)
    : shape === '1x1' ? square(base)
    : pillar(base)
  return { ...layout, id: `${base.id}-north` }
}

export function resolveScreenLayout(templateId: TemplateId, shape: Shape, variant = 0, orientation?: Orientation): ShapeLayout {
  const base = resolveLayout(templateId, shape, variant)
  return orientation === 'north-up' ? northUp(base, shape, templateId) : base
}

export function resolveNorthUpTemplate(templateId: TemplateId, shape: Shape): ResolvedTemplate {
  return describeLayout(resolveScreenLayout(templateId, shape, 0, 'north-up'))
}

export function northDistanceOn(templateId: TemplateId, shape: Shape): NorthDial['distanceOn'] {
  return resolveScreenLayout(templateId, shape, 0, 'north-up').north?.distanceOn ?? 'shelter'
}
