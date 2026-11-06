import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { directionToward, pickShelter } from "../src/composer/compose.js";
import type { ReplayEntry } from "../src/jma/replay.js";
import { loadMunicipality } from "../src/loop/municipality.js";
import { runReplay } from "../src/loop/replay-run.js";
import { staticVerifier } from "../src/loop/static-verifier.js";
import { AGENTS_DIR, SITES_DIR } from "../src/paths.js";
import { formatErrors, validateDoc } from "../src/schemas.js";
import { findSite, readSites, siteMunicipality, type SiteFile } from "../src/sites.js";

const fixture = (name: string) => JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, "test/fixtures", name), "utf8"));
const read = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));

test("every site file is named <id>.json and validates against site.schema.json", () => {
  const files = fs.readdirSync(SITES_DIR).filter((n) => n.endsWith(".json"));
  assert.ok(files.length >= 5);
  for (const f of files) {
    const doc = read(path.join(SITES_DIR, f));
    assert.equal(f, `${doc.id}.json`);
    const r = validateDoc(doc);
    assert.equal(r.schema, "site");
    assert.ok(r.ok, `${f}\n${formatErrors(r.errors)}`);
  }
  assert.equal(validateDoc({ id: "x-site", municipality_id: "05210", lat: 39, lng: 140 }, "site").ok, false, "facing_deg is required");
  assert.equal(validateDoc({ ...read(path.join(SITES_DIR, files[0])), extra: 1 }, "site").ok, false);
});

test("a replay borrows the municipality named in site.replay", () => {
  assert.equal(siteMunicipality(findSite("05210-demo-honjo-station")), "05210");
  assert.equal(siteMunicipality({ id: "x", municipality_id: "01100", lat: 0, lng: 0, replay: { municipality: "05210", from: "a", to: "b", speed: 1 } }), "05210");
  assert.equal(readSites().length, fs.readdirSync(SITES_DIR).filter((n) => n.endsWith(".json")).length);
});

test("two sites in 05210 get their own layouts with their own shelter, direction and distance", async () => {
  const a: SiteFile = findSite("05210-demo-honjo-station");
  const b: SiteFile = fixture("site-05210-test-500m-north.json");
  assert.ok(validateDoc(b, "site").ok);
  const { entries } = fixture("replay-05210-koyoshi-20261021.json") as { entries: ReplayEntry[] };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evac-sites-"));
  const roots = { layouts: path.join(root, "layouts"), reports: path.join(root, "reports") };
  try {
    for (const site of [a, b]) await runReplay({ municipalityId: "05210", entries, site, verifier: staticVerifier, roots });
    assert.deepEqual(fs.readdirSync(roots.layouts).sort(), [a.id, b.id].sort());
    const { municipality } = loadMunicipality("05210");
    let compared = 0, differ = 0;
    for (const e of entries) {
      const cellsOf = (site: SiteFile) => {
        const file = path.join(roots.layouts, site.id, e.bulletin_id, "16x9.json");
        if (!fs.existsSync(file)) return undefined;
        const cells = read(file).cells as { id: string; text: { ja: string }; rotation?: number; distance_m?: number }[];
        return { shelter: cells.find((c) => c.id === "shelter"), direction: cells.find((c) => c.id === "direction") };
      };
      const [ca, cb] = [cellsOf(a), cellsOf(b)];
      assert.equal(Boolean(ca), Boolean(cb), `${e.bulletin_id} has screens at one site only`);
      if (!ca?.shelter || !cb?.shelter) continue;
      for (const [site, c] of [[a, ca], [b, cb]] as const) {
        const want = pickShelter(municipality, site, e.alert.hazard);
        const way = directionToward(site, want.shelter);
        assert.equal(c.shelter!.text.ja, want.shelter.name, `${site.id} ${e.bulletin_id} shelter`);
        assert.equal(c.shelter!.distance_m, want.distance_m, `${site.id} ${e.bulletin_id} distance`);
        assert.equal(c.direction!.text.ja, way.text_ja, `${site.id} ${e.bulletin_id} direction`);
        assert.equal(c.direction!.rotation, way.rotation, `${site.id} ${e.bulletin_id} rotation`);
      }
      compared++;
      if (ca.shelter.text.ja !== cb.shelter.text.ja || ca.shelter.distance_m !== cb.shelter.distance_m || ca.direction!.rotation !== cb.direction!.rotation) differ++;
    }
    assert.ok(compared > 0, "no screen with a shelter in the replay");
    assert.ok(differ > 0, "the two sites got identical guidance; the fixture no longer exercises per-site layouts");
    for (const site of [a, b]) assert.equal(read(path.join(roots.layouts, site.id, "index.json")).site, site.id);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
