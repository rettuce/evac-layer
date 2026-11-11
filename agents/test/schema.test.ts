import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../src/paths.js";
import { formatErrors, validateDoc } from "../src/schemas.js";

const fixture = () =>
  JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "schema/fixtures/layout-wajima-tsunami-16x9.json"), "utf8"));

test("contract v0 fixture validates as layout", () => {
  const r = validateDoc(fixture());
  assert.equal(r.schema, "layout");
  assert.ok(r.ok, formatErrors(r.errors));
});

test("layout rejects a blink motion", () => {
  const doc = fixture();
  doc.cells[0].motion = "blink";
  assert.equal(validateDoc(doc).ok, false);
});

test("layout rejects a cell without ja text", () => {
  const doc = fixture();
  delete doc.cells[1].text.ja;
  assert.equal(validateDoc(doc).ok, false);
});

test("layout rejects colors written by the composer", () => {
  const doc = fixture();
  doc.cells[0].color = "#A21C86";
  assert.equal(validateDoc(doc).ok, false);
});

test("layout requires a numeric display level", () => {
  const doc = fixture();
  doc.alert.level = null;
  assert.equal(validateDoc(doc).ok, false);
});

test("languages cell is required on every shape, 1x1 and the pillar included", () => {
  const doc = fixture();
  doc.cells = doc.cells.filter((c: { role: string }) => c.role !== "languages");
  for (const shape of ["16x9", "9x16", "32x9", "1x1", "pillar"]) {
    doc.shape = shape;
    assert.equal(validateDoc(doc).ok, false, shape);
  }
});

test("languages cell must carry ja_easy, en, zh_hans and ko at priority 3", () => {
  const doc = fixture();
  const lang = doc.cells.find((c: { role: string }) => c.role === "languages");
  delete lang.text.ko;
  assert.equal(validateDoc(doc).ok, false);
});

test("committed GSI shelter files validate", () => {
  for (const id of ["17204", "22424", "14100", "05210"]) {
    const doc = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, `data/municipalities/${id}.shelters.json`), "utf8"));
    const r = validateDoc(doc);
    assert.equal(r.schema, "shelters");
    assert.ok(r.ok, formatErrors(r.errors));
    assert.equal(doc.shelters.length, doc.counts.emergency_evacuation_site + doc.counts.evacuation_shelter);
  }
});

test("shelter cells carry kind; other cells may not", () => {
  const doc = fixture();
  const shelter = doc.cells.find((c: { role: string }) => c.role === "shelter");
  delete shelter.kind;
  assert.equal(validateDoc(doc).ok, false);
  const doc2 = fixture();
  doc2.cells[0].kind = "evacuation_shelter";
  assert.equal(validateDoc(doc2).ok, false);
});

const feedWith = (layout: Record<string, unknown>) => ({
  feed_version: "0.1",
  site: { id: "demo", municipality_id: "17204" },
  state: "alert",
  alert: { source: "jma", bulletin_id: "B1", hazard: "tsunami", level: 4, issued_at: "2026-11-01T00:00:00+09:00", template: "evac-now" },
  bulletin_id: "B1",
  issued_at: "2026-11-01T00:00:00+09:00",
  layouts: { "16x9": layout },
  assets: {},
  sources: (layout.sources as unknown[]) ?? [],
  approved_at: "2026-11-01T00:01:00+09:00",
});

test("public schema: a feed carrying unknown optional fields at every level still validates", () => {
  const layout = fixture();
  layout.cells[0].future_hint = "north-up";
  layout.cells[0].text.future = "x";
  layout.sources[0].note = "added later";
  layout.alert.extra = 1;
  layout.municipality.extra = 1;
  layout.extra = 1;
  const feed = { ...feedWith(layout), extra: 1, site: { id: "demo", municipality_id: "17204", extra: 1 } };
  (feed.alert as Record<string, unknown>).extra = 1;
  const r = validateDoc(feed, "feed", { public: true });
  assert.ok(r.ok, formatErrors(r.errors));
  assert.ok(validateDoc(layout, "layout", { public: true }).ok);
});

test("public schema: a feed missing a required field is still refused", () => {
  const feed = feedWith(fixture()) as Record<string, unknown>;
  delete feed.approved_at;
  assert.equal(validateDoc(feed, "feed", { public: true }).ok, false);
  const layout = fixture();
  delete layout.cells[0].priority;
  assert.equal(validateDoc(feedWith(layout), "feed", { public: true }).ok, false);
  const bad = fixture();
  bad.cells[0].motion = "blink";
  assert.equal(validateDoc(bad, "layout", { public: true }).ok, false);
});

test("our own validation stays strict: unknown cell, source and feed fields are refused", () => {
  const layout = fixture();
  layout.cells[0].orientaton = "north-up";
  assert.equal(validateDoc(layout, "layout").ok, false);
  const src = fixture();
  src.sources[0].note = "x";
  assert.equal(validateDoc(src, "layout").ok, false);
  const cellInFeed = fixture();
  cellInFeed.cells[0].orientaton = "north-up";
  assert.equal(validateDoc(feedWith(cellInFeed), "feed").ok, false);
  assert.equal(validateDoc({ ...feedWith(fixture()), extra: 1 }, "feed").ok, false);
  assert.ok(validateDoc(feedWith(fixture()), "feed").ok);
});

test("every committed layout and feed example passes both the public and the strict schema", () => {
  const files: string[] = [];
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".json")) files.push(p);
    }
  };
  for (const d of ["schema/fixtures", "examples", "data/layouts"]) walk(path.join(REPO_ROOT, d));
  let checked = 0;
  for (const f of files) {
    const doc = JSON.parse(fs.readFileSync(f, "utf8"));
    if (doc?.kind !== "evac-screen" && !(doc && "feed_version" in doc && "state" in doc)) continue;
    const pub = validateDoc(doc, undefined, { public: true });
    assert.ok(pub.ok, `${f}\n${formatErrors(pub.errors)}`);
    const strict = validateDoc(doc);
    assert.ok(strict.ok, `strict ${f}\n${formatErrors(strict.errors)}`);
    checked++;
  }
  assert.ok(checked > 0);
});
