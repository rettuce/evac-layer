import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { compose, pickShelter, type Municipality, type Site, type WriterOutput } from "../src/composer/compose.js";
import { ComposerStop } from "../src/composer/rules.js";
import { shapeContract } from "../src/composer/template.js";
import { parseJmaXml } from "../src/jma/parse.js";
import { formatErrors, validateDoc } from "../src/schemas.js";
import { AGENTS_DIR } from "../src/paths.js";

const SAMPLES_DIR = process.env.JMA_SAMPLES_DIR ?? "/Users/you/Dropbox/dev/claude-hackathon-2026/data/raw/jma-samples/unzipped";
const fx = <T>(name: string): T => JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, "test/fixtures", name), "utf8"));
const municipality = fx<Municipality>("municipality-17204-min.json");
const site = fx<Site>("site-wajima-test.json");
const writer = fx<WriterOutput>("writer-tsunami-advisory.json");
const advisory = () => parseJmaXml(fs.readFileSync(path.join(SAMPLES_DIR, "32-39_12_02_250206_VTSE41.xml")));

test("tsunami advisory for 石川県能登 composes four valid layouts at display level 2", () => {
  const screens = compose({ alert: advisory(), municipality, site, writer });
  assert.deepEqual(screens.map((s) => s.shape), ["16x9", "9x16", "32x9", "1x1"]);
  for (const s of screens) {
    const r = validateDoc(s, "layout");
    assert.ok(r.ok, `${s.shape}\n${formatErrors(r.errors)}`);
    assert.equal(s.alert.level, 2);
    assert.equal(s.template, "evac-now");
  }
});

test("shelter is the nearest undisputed tsunami site; distance appears once, on the shelter cell", () => {
  const [landscape] = compose({ alert: advisory(), municipality, site, writer });
  const shelter = landscape.cells.find((c) => c.role === "shelter")!;
  const direction = landscape.cells.find((c) => c.role === "direction")!;
  assert.equal(shelter.text.ja, "ホテル　ルートイン輪島（指定緊急避難場所）");
  assert.equal(shelter.distance_m, 800);
  assert.ok(shelter.distance_m! > 0 && shelter.distance_m! % 10 === 0);
  assert.ok(!/\d+\s*m/.test(direction.text.ja));
  assert.equal(direction.rotation, 180);
});

test("every emitted cell has a slot in the render template", () => {
  for (const screen of compose({ alert: advisory(), municipality, site, writer })) {
    const { slots } = shapeContract("evac-now", screen.shape);
    for (const c of screen.cells) assert.ok(slots.has(c.role), `${screen.shape} ${c.role}`);
  }
});

test("same inputs produce identical output", () => {
  assert.deepEqual(compose({ alert: advisory(), municipality, site, writer }), compose({ alert: advisory(), municipality, site, writer }));
});

test("a shelter named in a conflict is never chosen", () => {
  const m = { ...municipality, conflicts: [{ gsi_candidates: ["ホテル　ルートイン輪島"] }] };
  assert.equal(pickShelter(m, site, "tsunami").shelter.name, "輪島市健康ふれあい広場");
});

test("text over the shape budget stops composition instead of truncating", () => {
  const long = structuredClone(writer);
  long.cells[0].text.ja = "津波注意報が発表されました";
  assert.throws(() => compose({ alert: advisory(), municipality, site, writer: long }), ComposerStop);
});

test("a bulletin that does not cover the municipality stops", () => {
  const other = parseJmaXml(fs.readFileSync(path.join(SAMPLES_DIR, "32-39_11_02_250206_VTSE41.xml")));
  assert.throws(() => compose({ alert: other, municipality, site, writer }), /does not cover/);
});
