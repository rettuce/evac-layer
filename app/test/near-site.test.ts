import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SITE_MATCH_RADIUS_M, nearestSiteWithin, parseCoordinate } from '../layout/nearSite.ts'

const METERS_PER_DEG_LAT = 111_195
const HONJO = { id: '05210-demo-honjo-station', lat: 39.38633978, lng: 140.0563304 }
const north = (m: number) => ({ lat: HONJO.lat + m / METERS_PER_DEG_LAT, lng: HONJO.lng })

test('points 99 m and 100 m north of a registered site resolve to it; 101 m resolves to none', () => {
  assert.equal(SITE_MATCH_RADIUS_M, 100)
  const at99 = nearestSiteWithin([HONJO], north(99))
  assert.equal(at99?.site.id, HONJO.id)
  assert.ok(Math.abs(at99!.distanceM - 99) < 0.05, `99 m measured as ${at99!.distanceM}`)
  assert.equal(nearestSiteWithin([HONJO], north(100))?.site.id, HONJO.id)
  assert.equal(nearestSiteWithin([HONJO], north(101)), undefined)
  assert.equal(nearestSiteWithin([], north(0)), undefined)
})

test('the nearest site wins, and of two at the same distance the smaller id', () => {
  const farther = { id: 'a-farther', ...north(130) }
  assert.equal(nearestSiteWithin([farther, HONJO], north(50))?.site.id, HONJO.id)
  const z = { ...HONJO, id: 'z-site' }
  const b = { ...HONJO, id: 'b-site' }
  assert.equal(nearestSiteWithin([z, b], north(10))?.site.id, 'b-site')
  assert.equal(nearestSiteWithin([b, z], north(10))?.site.id, 'b-site')
})

test('sites without valid coordinates are never candidates', () => {
  const broken = [
    { id: 'no-coordinates' },
    { id: 'lat-out-of-range', lat: 91, lng: HONJO.lng },
    { id: 'lng-out-of-range', lat: HONJO.lat, lng: 181 },
    { id: 'not-finite', lat: Number.NaN, lng: HONJO.lng },
    { id: 'as-strings', lat: String(HONJO.lat), lng: String(HONJO.lng) },
  ]
  assert.equal(nearestSiteWithin(broken, north(0)), undefined)
})

test('a query coordinate that is empty, not a number or out of range is invalid', () => {
  for (const bad of [undefined, '', '  ', 'x', 'NaN', 'Infinity', '91', '-90.0001']) assert.equal(parseCoordinate(bad, 90), undefined, String(bad))
  assert.equal(parseCoordinate('181', 180), undefined)
  assert.equal(parseCoordinate('39.5', 90), 39.5)
  assert.equal(parseCoordinate('-180', 180), -180)
})
