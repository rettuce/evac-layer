import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AMBIENT_SLOT_MS, D21_MARGIN, overlayGeometry, pickAmbient } from '../layout/ambient/index.ts'

const BASE = Date.parse('2026-10-21T11:00:00+09:00')

test('the same site and hour give the same ambient pick', () => {
  assert.deepEqual(pickAmbient('05210-demo-honjo-station', BASE + 10), pickAmbient('05210-demo-honjo-station', BASE + 3_500_000))
})

test('the pick is redrawn at each hour boundary', () => {
  const picks = Array.from({ length: 6 }, (_, h) => pickAmbient('05210-demo-honjo-station', BASE + h * AMBIENT_SLOT_MS))
  assert.equal(new Set(picks.map((pick) => pick.slot)).size, 6)
  assert.equal(new Set(picks.map((pick) => pick.seed)).size, 6)
})

test('scene= pins a known scene and ignores an unknown one', () => {
  assert.equal(pickAmbient('x', BASE, 'color-planes').scene.id, 'color-planes')
  assert.equal(pickAmbient('x', BASE, 'unknown').scene.id, pickAmbient('x', BASE).scene.id)
})

test('the D21 block sits on the outer margin in every corner and shape', () => {
  for (const [width, height] of [[1920, 1080], [1080, 1920], [3840, 1080], [1080, 1080]]) {
    const scale = Math.min(width, height) / 720
    const right = overlayGeometry(width, height, 'bottom-right')
    assert.ok(Math.abs(width - right.block.left - right.block.width - D21_MARGIN * scale) < 1e-6)
    assert.equal(right.block.bottom, D21_MARGIN * scale)
    assert.equal(overlayGeometry(width, height, 'top-left').block.left, D21_MARGIN * scale)
  }
  assert.deepEqual(overlayGeometry(0, 0, 'top-left').rules, [])
})

test('clock-grid can be pinned, and adjacent hours never repeat a scene', () => {
  assert.equal(pickAmbient('05210-demo-honjo-station', BASE, 'clock-grid').scene.id, 'clock-grid')
  assert.equal(pickAmbient('05210-demo-honjo-station', BASE, 'clock-grid').scene.drawsGrid, true)
  for (let h = 1; h < 48; h++) {
    const previous = pickAmbient('05210-demo-honjo-station', BASE + (h - 1) * AMBIENT_SLOT_MS).scene.id
    assert.notEqual(pickAmbient('05210-demo-honjo-station', BASE + h * AMBIENT_SLOT_MS).scene.id, previous)
  }
})
