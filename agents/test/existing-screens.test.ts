import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { FEED_DIR, LAYOUTS_DIR, SAMPLES_DIR, SITES_DIR } from "../src/paths.js";
import { replayEntry } from "../src/jma/replay.js";
import { situationFor } from "../src/composer/rules.js";
import { loadMunicipality } from "../src/loop/municipality.js";
import { runLoop } from "../src/loop/loop.js";
import { staticVerifier } from "../src/loop/static-verifier.js";
import { writeForBulletin } from "../src/writer/step.js";
import { layoutDigest } from "../../app/layout/gate";
import type { SiteFile } from "../src/sites.js";

type IndexEntry = { bulletin_id: string; file: string; wmo_code: string; screen: boolean };

function xmlOf(file: string): string {
  return file.startsWith("jma-samples/") ? path.join(SAMPLES_DIR, file.slice("jma-samples/".length)) : path.join(FEED_DIR, file);
}

function storedFiles(dir: string): { shape: string; body: string }[] {
  return fs.readdirSync(dir).filter((f) => /^(16x9|9x16|32x9|1x1|pillar)\.json$/.test(f)).map((f) => ({ shape: f.slice(0, -5), body: fs.readFileSync(path.join(dir, f), "utf8") }));
}

const reproducible = fs.readdirSync(LAYOUTS_DIR).flatMap((siteId) => {
  const indexFile = path.join(LAYOUTS_DIR, siteId, "index.json");
  if (!fs.existsSync(indexFile)) return [];
  const site = JSON.parse(fs.readFileSync(path.join(SITES_DIR, `${siteId}.json`), "utf8")) as SiteFile;
  const index = JSON.parse(fs.readFileSync(indexFile, "utf8")) as { municipality: string; entries: IndexEntry[] };
  return index.entries.filter((e) => e.screen && fs.existsSync(xmlOf(e.file))).map((e) => ({ site, municipality: index.municipality, entry: e }));
});

test("the stored screens whose bulletins are in the fixtures are composed again byte for byte", { skip: reproducible.length ? false : "no stored screen has its bulletin here" }, async () => {
  let normal = 0;
  for (const { site, municipality: id, entry } of reproducible) {
    const parsed = replayEntry(fs.readFileSync(xmlOf(entry.file)), entry.file, entry.wmo_code, id);
    const { municipality } = loadMunicipality(id);
    const situation = situationFor(parsed.alert, id);
    const step = await writeForBulletin({ alert: parsed.alert, municipality, situation, site }, { persist: false, usage: [] });
    assert.equal(step.writerSource, "writer-cache", `${site.id} ${entry.bulletin_id}`);
    const result = await runLoop({ alert: parsed.alert, municipality, site, writer: step.writer, writerSource: step.writerSource, verifier: staticVerifier, reviser: step.reviser });
    const composed = result.screens.map((s) => ({ shape: s.shape, body: JSON.stringify(s, null, 2) + "\n" }));
    const stored = storedFiles(path.join(LAYOUTS_DIR, site.id, entry.bulletin_id));
    if (parsed.alert.status !== "normal") continue;
    normal++;
    assert.equal(layoutDigest(composed), layoutDigest(stored), `${site.id} ${entry.bulletin_id}`);
  }
  assert.ok(normal >= 5, `only ${normal} normal screens could be composed from the fixtures`);
});
