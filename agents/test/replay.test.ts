import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { ReplayEntry } from "../src/jma/replay.js";
import { situationFor, ComposerStop } from "../src/composer/rules.js";
import { AGENTS_DIR } from "../src/paths.js";
import { FEED_DIR } from "../src/jma/feed.js";
import { parseJmaXml } from "../src/jma/parse.js";

const fixture = JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, "test/fixtures/replay-05210-koyoshi-20261021.json"), "utf8")) as { entries: ReplayEntry[] };

test("子吉川 2026-10-21: levels rise 2 → 3 → 4 → 5 and fall back", () => {
  assert.deepEqual(fixture.entries.map((e) => e.municipality_level), [2, 3, 4, 5, 5, 5, 2, 2, null]);
  assert.equal(fixture.entries.at(-1)!.municipality_status.join(), "cleared");
});

test("the real sequence drives the Composer from no screen to evac-prepare to evac-now to all-clear", () => {
  const plan = fixture.entries.map((e) => {
    try { return situationFor(e.alert, "05210").template; } catch (err) { if (err instanceof ComposerStop) return "none"; throw err; }
  });
  assert.deepEqual(plan, ["none", "evac-prepare", "evac-now", "evac-now", "evac-now", "evac-now", "none", "none", "all-clear"]);
});

test("re-parsing the recorded bulletins reproduces the fixture", () => {
  for (const e of fixture.entries) {
    const file = path.join(FEED_DIR, e.file);
    if (!fs.existsSync(file)) throw new Error(`recorded bulletin ${file} not found. Set JMA_FEED_DIR.`);
    assert.deepEqual(parseJmaXml(fs.readFileSync(file)), e.alert, e.file);
  }
});
