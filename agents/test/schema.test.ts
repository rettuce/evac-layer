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
