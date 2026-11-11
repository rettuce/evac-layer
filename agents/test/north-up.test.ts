import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { compose, directionToward, type Site, type WriterOutput } from "../src/composer/compose.js";
import { loadMunicipality } from "../src/loop/municipality.js";
import { staticVerifier } from "../src/loop/static-verifier.js";
import { judgeNorthUp } from "../src/verifier/checks.js";
import { formatErrors, validateDoc } from "../src/schemas.js";
import { AGENTS_DIR, LAYOUTS_DIR, REPO_ROOT } from "../src/paths.js";
import { northDistanceOn } from "../../app/layout/northUp";
import type { Alert } from "../src/jma/parse.js";
import type { LayoutCell } from "../../app/layout/types";

type Entry = { alert: Alert; municipality_level: number | null; bulletin_id: string };
const replay = JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, "test/fixtures/replay-05210-koyoshi-20261021.json"), "utf8")) as { entries: Entry[] };
const { municipality: yurihonjo } = loadMunicipality("05210");
const honjo = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/sites/05210-demo-honjo-station.json"), "utf8")) as Site;
const { facing_deg: _facing, ...unoriented } = honjo;
const writerFor = (bulletin: string) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/writer/05210", `${bulletin}.json`), "utf8")).output as WriterOutput;
const atLevel = (level: number) => replay.entries.find((e) => e.municipality_level === level)!;
const composeAt = (level: number, site: Site) => {
  const e = atLevel(level);
  return compose({ alert: e.alert, municipality: yurihonjo, site, writer: writerFor(e.bulletin_id) });
};
const cell = (screen: { cells: LayoutCell[] }, role: string) => screen.cells.find((c) => c.role === role);

test("a site without facing_deg gets a north-up arrow, the 8-point map angle and the distance beside the direction word", () => {
  for (const screen of composeAt(3, unoriented)) {
    const direction = cell(screen, "direction")!;
    const shelter = cell(screen, "shelter")!;
    assert.equal(direction.orientation, "north-up", screen.shape);
    assert.equal(direction.text.ja, "南西へ", screen.shape);
    assert.equal(direction.rotation, 135, `${screen.shape}: south-west is down-left`);
    assert.equal(direction.distance_m, 570, screen.shape);
    assert.equal(shelter.distance_m, undefined, `${screen.shape}: the distance is shown once`);
    const v = validateDoc(screen, "layout");
    assert.ok(v.ok, `${screen.shape}\n${formatErrors(v.errors)}`);
  }
});

test("where the shape has no room for the dial and two lines, the distance stays on the shelter row", () => {
  assert.equal(northDistanceOn("secure-now", "9x16"), "shelter");
  assert.equal(northDistanceOn("evac-now", "9x16"), "shelter");
  assert.equal(northDistanceOn("evac-prepare", "9x16"), "direction");
  for (const shape of ["16x9", "32x9", "1x1", "pillar"] as const) {
    for (const template of ["evac-prepare", "evac-now", "secure-now"] as const) assert.equal(northDistanceOn(template, shape), "direction", `${template} ${shape}`);
  }
  for (const screen of composeAt(5, unoriented)) {
    const direction = cell(screen, "direction")!;
    const shelter = cell(screen, "shelter")!;
    assert.equal(screen.template, "secure-now");
    assert.equal(direction.orientation, "north-up");
    const on = northDistanceOn("secure-now", screen.shape);
    assert.equal(direction.distance_m, on === "direction" ? 570 : undefined, screen.shape);
    assert.equal(shelter.distance_m, on === "shelter" ? 570 : undefined, screen.shape);
  }
});

test("north-up rounds the map bearing to 8 points: north is up, east right, south-west down-left; 22.5° is the boundary", () => {
  const origin: Site = { id: "origin", municipality_id: "00000", lat: 0, lng: 0 };
  const toward = (deg: number) => directionToward(origin, { lat: Math.cos((deg * Math.PI) / 180) * 0.01, lng: Math.sin((deg * Math.PI) / 180) * 0.01 });
  const cases: [number, string, number][] = [
    [0, "北へ", 270], [22.4, "北へ", 270], [22.6, "北東へ", 315], [67.4, "北東へ", 315], [67.6, "東へ", 0], [90, "東へ", 0],
    [135, "南東へ", 45], [180, "南へ", 90], [202.4, "南へ", 90], [202.6, "南西へ", 135], [225, "南西へ", 135], [270, "西へ", 180], [315, "北西へ", 225], [337.4, "北西へ", 225], [337.6, "北へ", 270],
  ];
  for (const [deg, word, rotation] of cases) {
    const way = toward(deg);
    assert.deepEqual([way.text_ja, way.rotation, way.orientation], [word, rotation, "north-up"], `bearing ${deg}`);
  }
});

test("a site with facing_deg composes byte for byte what it composed before", () => {
  const site = honjo.id;
  for (const e of replay.entries) {
    const dir = path.join(LAYOUTS_DIR, site, e.bulletin_id);
    if (!fs.existsSync(dir)) continue;
    for (const screen of compose({ alert: e.alert, municipality: yurihonjo, site: honjo, writer: writerFor(e.bulletin_id) })) {
      const saved = fs.readFileSync(path.join(dir, `${screen.shape}.json`), "utf8");
      assert.equal(`${JSON.stringify(screen, null, 2)}\n`, saved, `${e.bulletin_id} ${screen.shape}`);
      assert.equal(cell(screen, "direction")?.orientation, undefined);
    }
  }
});

test("site schema: facing_deg is optional, and when given still 0-360", () => {
  assert.ok(validateDoc(unoriented, "site").ok);
  assert.equal(validateDoc({ ...unoriented, facing_deg: 361 }, "site").ok, false);
});

test("layout schema: orientation is north-up on a direction cell only, and every committed layout still validates", () => {
  const [screen] = composeAt(3, unoriented);
  const shelterWithOrientation = { ...screen, cells: screen.cells.map((c) => (c.role === "shelter" ? { ...c, orientation: "north-up" } : c)) };
  assert.equal(validateDoc(shelterWithOrientation, "layout").ok, false, "orientation on a shelter cell");
  const otherOrientation = { ...screen, cells: screen.cells.map((c) => (c.role === "direction" ? { ...c, orientation: "heading-up" } : c)) };
  assert.equal(validateDoc(otherOrientation, "layout").ok, false, "an unknown orientation");
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith(".json") && d.name !== "index.json" ? [path.join(dir, d.name)] : []));
  const files = walk(LAYOUTS_DIR);
  assert.ok(files.length >= 110);
  for (const f of files) {
    const v = validateDoc(JSON.parse(fs.readFileSync(f, "utf8")), "layout");
    assert.ok(v.ok, `${path.relative(LAYOUTS_DIR, f)}\n${formatErrors(v.errors)}`);
  }
});

test("the static Verifier passes north-up screens and fails an arrow that contradicts its direction word", async () => {
  const screens = composeAt(3, unoriented);
  for (const v of await staticVerifier.verify(screens)) assert.deepEqual(v.findings, [], v.shape);
  const turned = screens.map((s) => ({ ...s, cells: s.cells.map((c) => (c.role === "direction" ? { ...c, rotation: 45 } : c)) }));
  for (const v of await staticVerifier.verify(turned)) {
    assert.equal(v.ok, false, v.shape);
    assert.deepEqual(v.findings.map((f) => [f.check, f.cell_id]), [["direction-mismatch", "direction"]], v.shape);
  }
});

test("north-up findings: a missing N, an N off the dial, an arrow turned away from its word", () => {
  const marks = [{ text: "N", visible: true, onDial: true }];
  const ok = { id: "direction", word: "南西へ", rotation: 135 };
  assert.deepEqual(judgeNorthUp([{ ...ok, marks }]), []);
  assert.deepEqual(judgeNorthUp([{ ...ok, rotation: 495 }]), [], "angles are compared modulo 360");
  assert.deepEqual(judgeNorthUp([{ ...ok, marks: [{ ...marks[0], visible: false }] }]).map((f) => f.check), ["north-missing"]);
  assert.deepEqual(judgeNorthUp([{ ...ok, marks: [{ ...marks[0], onDial: false }] }]).map((f) => f.check), ["north-missing"]);
  assert.deepEqual(judgeNorthUp([{ ...ok, marks: [{ text: "北", visible: true, onDial: true }] }]).map((f) => f.check), ["north-missing"]);
  assert.deepEqual(judgeNorthUp([{ ...ok, marks: [] }]).map((f) => f.check), ["north-missing"]);
  assert.deepEqual(judgeNorthUp([{ ...ok, rotation: 225, marks }]).map((f) => f.check), ["direction-mismatch"]);
  assert.deepEqual(judgeNorthUp([{ ...ok, rotation: undefined, marks }]).map((f) => f.check), ["direction-mismatch"]);
  assert.deepEqual(judgeNorthUp([{ ...ok, word: "まっすぐ", marks }]).map((f) => f.check), ["direction-mismatch"]);
});

test("the renderer's north-up fixtures are what the Composer makes today", () => {
  for (const level of [3, 5]) {
    const fixture = fs.readFileSync(path.join(REPO_ROOT, "app/fixtures", `north-up-l${level}.json`), "utf8");
    assert.equal(fixture, `${JSON.stringify(composeAt(level, unoriented), null, 2)}\n`, `app/fixtures/north-up-l${level}.json`);
  }
});
