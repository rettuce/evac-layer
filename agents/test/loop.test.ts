import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { Municipality, Site, WriterOutput } from "../src/composer/compose.js";
import { parseJmaXml } from "../src/jma/parse.js";
import { runLoop } from "../src/loop/loop.js";
import { fixtureReviser, liveWriterReviser } from "../src/loop/revisers.js";
import { staticVerifier } from "../src/loop/static-verifier.js";
import type { Verifier } from "../src/loop/types.js";
import { AGENTS_DIR } from "../src/paths.js";

const SAMPLES_DIR = process.env.JMA_SAMPLES_DIR ?? "/Users/you/Dropbox/dev/claude-hackathon-2026/data/raw/jma-samples/unzipped";
const fxPath = (n: string) => path.join(AGENTS_DIR, "test/fixtures", n);
const fx = <T>(n: string): T => JSON.parse(fs.readFileSync(fxPath(n), "utf8"));
const base = () => ({
  alert: parseJmaXml(fs.readFileSync(path.join(SAMPLES_DIR, "32-39_12_02_250206_VTSE41.xml"))),
  municipality: fx<Municipality>("municipality-17204-min.json"),
  site: fx<Site>("site-wajima-test.json"),
  verifier: staticVerifier,
});

test("a clean Writer output passes on the first attempt", async () => {
  const r = await runLoop({ ...base(), writer: fx<WriterOutput>("writer-tsunami-advisory.json"), writerSource: "clean", reviser: liveWriterReviser });
  assert.equal(r.outcome, "pass");
  assert.equal(r.attempts.length, 1);
  assert.equal(r.screens.length, 4);
});

test("repeated distance is sent back and fixed by the next revision", async () => {
  const r = await runLoop({
    ...base(), writer: fx<WriterOutput>("writer-tsunami-advisory-distance.json"), writerSource: "distance",
    reviser: fixtureReviser([fxPath("writer-tsunami-advisory.json")]),
  });
  assert.equal(r.outcome, "pass");
  assert.equal(r.attempts.length, 2);
  assert.ok(r.attempts[0].findings.every((f) => f.check === "distance-duplicated" && f.cell_id === "direction"));
  assert.deepEqual(r.attempts[1].findings, []);
});

test("over-budget text becomes a finding, not a crash", async () => {
  const r = await runLoop({
    ...base(), writer: fx<WriterOutput>("writer-tsunami-advisory-long.json"), writerSource: "long",
    reviser: fixtureReviser([fxPath("writer-tsunami-advisory.json")]),
  });
  assert.equal(r.attempts[0].findings[0].check, "over-budget");
  assert.equal(r.outcome, "pass");
});

test("the loop gives up after the attempt limit and says why", async () => {
  const bad = fxPath("writer-tsunami-advisory-distance.json");
  const r = await runLoop({ ...base(), writer: fx<WriterOutput>("writer-tsunami-advisory-distance.json"), writerSource: "distance", reviser: fixtureReviser([bad, bad, bad]), maxAttempts: 3 });
  assert.equal(r.outcome, "fail");
  assert.equal(r.attempts.length, 3);
  assert.match(r.reason!, /after 3 attempts/);
});

test("findings a rewrite cannot fix stop the loop at once", async () => {
  const flickering: Verifier = { name: "stub", verify: async (screens) => screens.map((s) => ({ shape: s.shape, ok: false, findings: [{ check: "flicker", detail: "3 reversals" }] })) };
  const r = await runLoop({ ...base(), verifier: flickering, writer: fx<WriterOutput>("writer-tsunami-advisory.json"), writerSource: "clean", reviser: liveWriterReviser });
  assert.equal(r.outcome, "fail");
  assert.equal(r.attempts.length, 1);
  assert.match(r.reason!, /not fixable/);
});

test("without an API key the live reviser declines instead of inventing text", async () => {
  const r = await runLoop({ ...base(), writer: fx<WriterOutput>("writer-tsunami-advisory-distance.json"), writerSource: "distance", reviser: liveWriterReviser });
  assert.equal(r.outcome, "fail");
  assert.match(r.reason!, /Day 2/);
});

test("an overflowing shelter cell is not sent back to the Writer", async () => {
  const overflowing: Verifier = { name: "stub", verify: async (screens) => screens.map((s) => ({ shape: s.shape, ok: false, findings: [{ check: "overflow", cell_id: "shelter", detail: "cell shelter overflows its slot" }] })) };
  const r = await runLoop({ ...base(), verifier: overflowing, writer: fx<WriterOutput>("writer-tsunami-advisory.json"), writerSource: "clean", reviser: fixtureReviser([fxPath("writer-tsunami-advisory.json")]) });
  assert.equal(r.outcome, "fail");
  assert.equal(r.attempts.length, 1);
  assert.match(r.reason!, /overflow\[shelter\]/);
});

test("an action text that contradicts its pictogram goes back to the Writer; a headline pictogram does not", async () => {
  const misuse = (cell: string): Verifier => ({ name: "stub", verify: async (screens) => screens.map((s) => ({ shape: s.shape, ok: false, findings: [{ check: "pictogram-misuse", cell_id: cell, detail: "text and pictogram disagree" }] })) });
  const clean = fxPath("writer-tsunami-advisory.json");
  const action = await runLoop({ ...base(), verifier: misuse("action"), writer: fx<WriterOutput>("writer-tsunami-advisory.json"), writerSource: "clean", reviser: fixtureReviser([clean, clean]), maxAttempts: 2 });
  assert.equal(action.attempts.length, 2);
  assert.match(action.reason!, /after 2 attempts/);
  const headline = await runLoop({ ...base(), verifier: misuse("headline"), writer: fx<WriterOutput>("writer-tsunami-advisory.json"), writerSource: "clean", reviser: fixtureReviser([clean]) });
  assert.equal(headline.attempts.length, 1);
  assert.match(headline.reason!, /not fixable/);
});
