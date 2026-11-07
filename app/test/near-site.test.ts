import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SITE_MATCH_RADIUS_M, haversineMeters, nearestSiteWithin } from '../layout/nearSite.ts'

const HONJO = { id: '05210-demo-honjo-station', lat: 39.38633978, lng: 140.0563304 }
const METERS_PER_DEG_LAT = haversineMeters({ lat: HONJO.lat, lng: HONJO.lng }, { lat: HONJO.lat + 1, lng: HONJO.lng })
const north = (m: number) => ({ lat: HONJO.lat + m / METERS_PER_DEG_LAT, lng: HONJO.lng })

test('a point 100 m from a registered site resolves to that site, the nearest one first', () => {
  const farther = { id: 'farther', ...north(130) }
  const hit = nearestSiteWithin([farther, HONJO, { id: 'no-coordinates' }], north(SITE_MATCH_RADIUS_M - 50))
  assert.equal(hit?.site.id, HONJO.id)
  const edge = nearestSiteWithin([HONJO], north(SITE_MATCH_RADIUS_M - 0.01))
  assert.equal(edge?.site.id, HONJO.id)
  assert.ok(Math.abs(edge!.distanceM - 100) < 0.1)
})

test('a point 101 m from every registered site resolves to none', () => {
  assert.equal(nearestSiteWithin([HONJO], north(101)), undefined)
  assert.equal(nearestSiteWithin([], north(0)), undefined)
})
