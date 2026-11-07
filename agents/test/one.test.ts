import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Site } from "../src/composer/compose.js";
import type { ReplayEntry } from "../src/jma/replay.js";
import { loadMunicipality } from "../src/loop/municipality.js";
import { composeBulletin } from "../src/loop/one.js";
import { staticVerifier } from "../src/loop/static-verifier.js";
import { AGENTS_DIR } from "../src/paths.js";

const fx = <T>(n: string): T => JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, "test/fixtures", n), "utf8"));
const { entries } = fx<{ entries: ReplayEntry[] }>("replay-05210-koyoshi-20261021.json");
const site = fx<Site>("site-05210-test-500m-north.json");
const byId = (id: string) => entries.find((e) => e.bulletin_id === id)!;
const L2 = byId("VXKOii-202610211145-e9c5d2903007");
const L3 = byId("VXKOii-202610211555-d5ccc7c6b547");
const L4 = byId("VXKOii-202610211815-e713da0e3c05");

test("composeBulletin writes one bulletin's layouts, report and index row, keeping the other rows in issue order", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evac-one-"));
  const roots = { layouts: path.join(root, "layouts"), reports: path.join(root, "reports") };
  const { municipality, readerRan } = loadMunicipality("05210");
  const base = { municipality, readerRan, site, verifier: staticVerifier, writer: { kind: "placeholder" } as const, roots };
  const indexFile = path.join(roots.layouts, site.id, "index.json");
  const index = () => JSON.parse(fs.readFileSync(indexFile, "utf8")) as { municipality: string; site: string; entries: { bulletin_id: string; screen: boolean; outcome?: string; layouts?: string[] }[] };

  await composeBulletin({ ...base, entry: L2 });
  await composeBulletin({ ...base, entry: L4 });
  const r = await composeBulletin({ ...base, entry: L3 });

  assert.notEqual(r.outcome, "no-screen");
  assert.deepEqual(fs.readdirSync(path.join(roots.layouts, site.id, L3.bulletin_id)).sort(), ["16x9.json", "1x1.json", "32x9.json", "9x16.json", "pillar.json"]);
  assert.ok(fs.existsSync(path.join(roots.reports, site.id, L3.bulletin_id, "report.json")));
  assert.equal(index().site, site.id);
  assert.deepEqual(index().entries.map((e) => e.bulletin_id), [L2.bulletin_id, L3.bulletin_id, L4.bulletin_id]);
  const row = index().entries[1];
  assert.equal(row.screen, false);
  assert.equal(row.layouts?.length, 5);

  await composeBulletin({ ...base, entry: L3 });
  assert.deepEqual(index().entries.map((e) => e.bulletin_id), [L2.bulletin_id, L3.bulletin_id, L4.bulletin_id]);
});

test("a skipped bulletin gets a no-screen row and no layouts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evac-one-"));
  const roots = { layouts: path.join(root, "layouts"), reports: path.join(root, "reports") };
  const { municipality, readerRan } = loadMunicipality("05210");
  const r = await composeBulletin({ entry: L3, municipality, readerRan, site, verifier: staticVerifier, writer: { kind: "placeholder" }, roots, skipIf: () => "nothing to clear" });
  assert.equal(r.outcome, "no-screen");
  assert.equal(fs.existsSync(path.join(roots.layouts, site.id, L3.bulletin_id)), false);
  const { entries: rows } = JSON.parse(fs.readFileSync(path.join(roots.layouts, site.id, "index.json"), "utf8"));
  assert.deepEqual(rows.map((e: { screen: boolean; reason: string }) => [e.screen, e.reason]), [[false, "nothing to clear"]]);
});
