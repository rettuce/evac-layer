import { test } from "node:test";
import { needsRaw } from "./raw.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { ReplayEntry } from "../src/jma/replay.js";
import { situationFor, ComposerStop } from "../src/composer/rules.js";
import { AGENTS_DIR } from "../src/paths.js";
import { FEED_DIR } from "../src/jma/feed.js";
import { withinWindow } from "../src/jma/replay.js";
import { parseJmaXml } from "../src/jma/parse.js";

const fixture = JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, "test/fixtures/replay-05210-koyoshi-20261021.json"), "utf8")) as { entries: ReplayEntry[] };

test("子吉川 2026-10-21: levels rise 2 → 3 → 4 → 5 and fall back", () => {
  assert.deepEqual(fixture.entries.map((e) => e.municipality_level), [2, 3, 4, 5, 5, 5, 2, 2, null]);
  assert.equal(fixture.entries.at(-1)!.municipality_status.join(), "cleared");
});

test("the real sequence drives the Composer from no screen to evac-prepare, evac-now, secure-now and all-clear", () => {
  const plan = fixture.entries.map((e) => {
    try { return situationFor(e.alert, "05210").template; } catch (err) { if (err instanceof ComposerStop) return "none"; throw err; }
  });
  assert.deepEqual(plan, ["none", "evac-prepare", "evac-now", "secure-now", "secure-now", "secure-now", "none", "none", "all-clear"]);
});

test("re-parsing the recorded bulletins reproduces the fixture", { skip: needsRaw({ feed: fixture.entries.map((e) => e.file) }) }, () => {
  for (const e of fixture.entries) {
    const file = path.join(FEED_DIR, e.file);
    assert.deepEqual(parseJmaXml(fs.readFileSync(file)), e.alert, e.file);
  }
});

test("an all-clear with nothing shown before produces no screen", async () => {
  const { runReplay } = await import("../src/loop/replay-run.js");
  const { staticVerifier } = await import("../src/loop/static-verifier.js");
  const events: string[] = [];
  const last = fixture.entries.at(-1)!;
  const site = { id: "t", municipality_id: "05210", lat: 39.386, lng: 140.056, facing_deg: 0 };
  const s = await runReplay({ municipalityId: "05210", entries: [last], site, verifier: staticVerifier, persist: false, onEvent: (e) => events.push(`${e.outcome}:${e.reason ?? ""}`) });
  assert.equal(s.screens, 0);
  assert.match(events[0], /nothing to clear/);
});

test("--from/--to keep the bulletins issued inside the window, both ends included", () => {
  const all = fixture.entries;
  const [first, last] = [all[0].issued_at, all[all.length - 1].issued_at];
  assert.deepEqual(withinWindow(all, { from: first, to: last }), all);
  assert.deepEqual(withinWindow(all, {}), all);
  const inner = withinWindow(all, { from: all[1].issued_at, to: all[all.length - 2].issued_at });
  assert.deepEqual(inner.map((e) => e.bulletin_id), all.slice(1, -1).map((e) => e.bulletin_id));
  assert.deepEqual(withinWindow(all, { from: "2026-10-21T15:55:00+09:00", to: "2026-10-21T06:55:00Z" }).map((e) => e.issued_at), ["2026-10-21T15:55:00+09:00"]);
  assert.throws(() => withinWindow(all, { from: "yesterday" }), /not a date/);
});
