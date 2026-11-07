import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { needsRaw } from "./raw.js";
import { FEED_DIR, LAYOUTS_DIR, SAMPLES_DIR } from "../src/paths.js";
import { parseJmaXml } from "../src/jma/parse.js";
import { situationFor } from "../src/composer/rules.js";

type IndexEntry = { bulletin_id: string; file: string; screen: boolean; template?: string };

for (const layout of ["05210-demo-honjo-station", "15205-demo", "22424-demo"]) {
  const index = JSON.parse(fs.readFileSync(path.join(LAYOUTS_DIR, layout, "index.json"), "utf8")) as { municipality: string; name: string; entries: IndexEntry[] };
  const screens = index.entries.filter((e) => e.screen);
  const feed = screens.filter((e) => e.file.startsWith("bodies/")).map((e) => e.file);
  const samples = screens.filter((e) => e.file.startsWith("jma-samples/")).map((e) => e.file.slice("jma-samples/".length));
  test(`${index.name}: every screen of the demo comes from its bulletin with the same template`, { skip: needsRaw({ feed, samples }) }, () => {
    for (const e of screens) {
      const file = e.file.startsWith("jma-samples/") ? path.join(SAMPLES_DIR, e.file.slice("jma-samples/".length)) : path.join(FEED_DIR, e.file);
      const alert = parseJmaXml(fs.readFileSync(file));
      assert.equal(alert.bulletin_id, e.bulletin_id, e.file);
      assert.equal(situationFor(alert, index.municipality).template, e.template, e.file);
    }
  });
}
