import assert from 'node:assert/strict'
import { test } from 'node:test'
import { overflowAttr } from '../layout/overflow.ts'
import { headlineParts } from '../layout/headline.ts'
import { levelLabelFor } from '../layout/palette.ts'

test('data-overflow lists <cell id>:<lang> per spilled text, then screen', () => {
  assert.equal(overflowAttr([], false), '')
  assert.equal(overflowAttr([{ cellId: 'headline', langs: ['ja', 'ja'] }], false), 'headline:ja')
  assert.equal(
    overflowAttr([{ cellId: 'action', langs: ['pictogram', 'ja_easy'] }, { cellId: 'languages', langs: ['en', 'zh_hans'] }], true),
    'action:pictogram,action:ja_easy,languages:en,languages:zh_hans,screen',
  )
  assert.equal(overflowAttr([{ cellId: 'shelter', langs: [] }], false), 'shelter:ja')
})

test('a cleared bulletin shows no warning-level label', () => {
  assert.equal(levelLabelFor('all-clear', 1), undefined)
  assert.equal(levelLabelFor('evac-now', 4), '警戒レベル4')
})

test('the headline keeps レベル and its numeral together and may wrap only after them', () => {
  assert.deepEqual(headlineParts('レベル５氾濫特別警報'), { lead: 'レベル５', rest: '氾濫特別警報' })
  assert.deepEqual(headlineParts('レベル 4 土砂災害警報'), { lead: 'レベル4', rest: '土砂災害警報' })
  assert.deepEqual(headlineParts('津波警報'), { rest: '津波警報' })
})
