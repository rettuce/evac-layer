import assert from 'node:assert/strict'
import { test } from 'node:test'
import { overflowAttr } from '../layout/overflow.ts'
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
