import assert from 'node:assert/strict'
import { test } from 'node:test'
import { overflowAttr } from '../layout/overflow.ts'
import { levelScaleAttr, levelScaleFor } from '../layout/levelScale.ts'

test('data-overflow lists <cell id>:<lang> per spilled text, then screen', () => {
  assert.equal(overflowAttr([], false), '')
  assert.equal(overflowAttr([{ cellId: 'headline', langs: ['ja', 'ja'] }], false), 'headline:ja')
  assert.equal(
    overflowAttr([{ cellId: 'action', langs: ['pictogram', 'ja_easy'] }, { cellId: 'languages', langs: ['en', 'zh_hans'] }], true),
    'action:pictogram,action:ja_easy,languages:en,languages:zh_hans,screen',
  )
  assert.equal(overflowAttr([{ cellId: 'shelter', langs: [] }], false), 'shelter:ja')
})

test('data-level-scale is <steps>:<current>; tsunami uses its own three steps; all-clear has none', () => {
  assert.equal(levelScaleAttr(levelScaleFor('evac-now', 'flood', 4)), '5:4')
  assert.equal(levelScaleAttr(levelScaleFor('secure-now', 'landslide', 5)), '5:5')
  const tsunami = levelScaleFor('evac-now', 'tsunami', 4)
  assert.equal(levelScaleAttr(tsunami), '3:3')
  assert.deepEqual(tsunami?.steps.map((step) => step.label), ['注意報', '警報', '大津波警報'])
  assert.equal(levelScaleAttr(levelScaleFor('evac-now', 'tsunami', 3)), '3:2')
  assert.equal(levelScaleFor('all-clear', 'flood', 1), undefined)
})
