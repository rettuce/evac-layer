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
