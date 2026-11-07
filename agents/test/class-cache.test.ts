import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "evac-class-cache-"));
fs.cpSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/jma"), path.join(dataDir, "jma"), { recursive: true });
process.env.EVAC_DATA_DIR = dataDir;

const { AGENTS_DIR, APPROVALS_FILE, LAYOUTS_DIR, REPO_ROOT, WRITER_DIR } = await import("../src/paths.js");
const { situationFor } = await import("../src/composer/rules.js");
const { cachedWriterForClass, saveWriterForClass, screenClassFor } = await import("../src/writer/live.js");
const { writeForBulletin } = await import("../src/writer/step.js");
const { layoutDigest, screenClass } = await import("../../app/layout/gate");
const { writeReport } = await import("../src/loop/report.js");
const { needsRaw } = await import("./raw.js");
import type Anthropic from "@anthropic-ai/sdk";
import type { Municipality, WriterOutput } from "../src/composer/compose.js";
import type { ReplayEntry } from "../src/jma/replay.js";

const { entries } = JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, "test/fixtures/replay-05210-koyoshi-20261021.json"), "utf8")) as { entries: ReplayEntry[] };
const L4 = entries.find((e) => e.bulletin_id === "VXKOii-202610211815-e713da0e3c05")!;
const municipality = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/municipalities/05210.json"), "utf8")) as Municipality;
const writer: WriterOutput = { cells: [
  { role: "headline", text: { ja: "レベル４氾濫危険警報" } },
  { role: "action", text: { ja: "高い所へ逃げて", ja_easy: "たかい ところへ にげて" } },
  { role: "languages", text: { ja: "高い所へ逃げて", ja_easy: "たかい ところへ にげて" } },
] } as WriterOutput;
const SITE = "05210-test-site";
const noApi = { messages: { stream: () => { throw new Error("the Writer API was called"); } } } as unknown as Anthropic;

test("the class of a screen is the same string in the agents and in the app", () => {
  const layout = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/layouts/05210-demo-honjo-station", L4.bulletin_id, "16x9.json"), "utf8"));
  const cls = screenClassFor(L4.alert.hazard, situationFor(L4.alert, "05210"));
  assert.equal(cls, "flood/evac-now/4");
  assert.equal(screenClass(layout), cls);
});

test("a class cache is stored per municipality and class, and read back", () => {
  assert.equal(cachedWriterForClass("05210", "flood/evac-now/4"), undefined);
  saveWriterForClass("05210", "flood/evac-now/4", { model: "opus", output: writer, bulletin_id: L4.bulletin_id, issued_at: L4.issued_at, raw_title: L4.alert.raw_title });
  assert.ok(fs.existsSync(path.join(WRITER_DIR, "05210/class/flood-evac-now-4.json")));
  const back = cachedWriterForClass("05210", "flood/evac-now/4")!;
  assert.equal(back.bulletin_id, L4.bulletin_id);
  assert.deepEqual(back.output.cells.map((c) => c.role), ["headline", "action", "languages"]);
});

test("a new bulletin of a cached class is written from the class cache, without the Writer API", async () => {
  saveWriterForClass("05210", "flood/evac-now/4", { model: "opus", output: writer, bulletin_id: L4.bulletin_id, issued_at: L4.issued_at, raw_title: L4.alert.raw_title });
  const alert = { ...L4.alert, bulletin_id: "VXKOii-202611071200-000000000000", issued_at: "2026-11-07T12:00:00+09:00" };
  const situation = situationFor(alert, "05210");
  const step = await writeForBulletin({ alert, municipality, situation, site: { id: SITE } }, { live: { client: noApi, model: "opus" }, persist: false, usage: [] });
  assert.equal(step.writerSource, `writer-class-cache:${L4.bulletin_id}`);
  assert.equal(step.writer.cells.find((c) => c.role === "action")!.text.ja_easy, "たかい ところへ にげて");
  await assert.rejects(step.reviser.revise(step.writer, [], 1), /no Writer to revise with/, "a class-cached screen is not rewritten on findings; it fails and waits for a person");
  const classFile = path.join(WRITER_DIR, "05210/class/flood-evac-now-4.json");
  const before = fs.readFileSync(classFile, "utf8");
  step.afterLoop({ outcome: "pass", writer: { cells: [] } } as never);
  assert.equal(fs.readFileSync(classFile, "utf8"), before, "only --build-class-cache writes the class cache");

  const otherRiver = { ...alert, raw_title: "芋川レベル４氾濫危険警報" };
  await assert.rejects(writeForBulletin({ alert: otherRiver, municipality, situation, site: { id: SITE } }, { live: { client: noApi, model: "opus" }, persist: false, usage: [] }), /Writer API was called/);
});

test("a report carries the digest of the layout files it wrote, as the app computes it, and the shapes the browser skipped", () => {
  const roots = { reports: path.join(dataDir, "r-reports"), layouts: path.join(dataDir, "r-layouts") };
  const screens = [{ shape: "16x9", cells: [] }, { shape: "pillar", cells: [] }];
  const { report } = writeReport({ siteId: SITE, municipalityId: "05210", bulletinId: "B1", verifier: "static+browser", skippedShapes: ["pillar", "1x1"], reviser: "r", maxAttempts: 1, result: { outcome: "pass", screens, attempts: [] } as never, roots });
  const dir = path.join(roots.layouts, SITE, "B1");
  const files = fs.readdirSync(dir).map((f) => ({ shape: f.slice(0, -5), body: fs.readFileSync(path.join(dir, f), "utf8") }));
  assert.equal(report.layout_digest, layoutDigest(files));
  assert.deepEqual(report.browser_skipped, ["pillar"]);
});

test("the class wording comes from the bulletin the class was approved from", { skip: needsRaw({ feed: [L4.file] }) }, async () => {
  const approvedWriter: WriterOutput = { cells: writer.cells.map((c) => (c.role === "action" || c.role === "languages" ? { ...c, text: { ...c.text, ja_easy: "しょうにんした ぶん" } } : c)) } as WriterOutput;
  fs.mkdirSync(path.join(WRITER_DIR, "05210"), { recursive: true });
  fs.writeFileSync(path.join(WRITER_DIR, "05210", `${L4.bulletin_id}.json`), JSON.stringify({ model: "opus", output: approvedWriter, usage: [], lint: [] }));
  saveWriterForClass("05210", "flood/evac-now/4", { model: "opus", output: writer, bulletin_id: "VXKOii-202610212000-000000000000", issued_at: "2026-10-21T20:00:00+09:00", raw_title: L4.alert.raw_title });
  fs.mkdirSync(path.join(LAYOUTS_DIR, SITE), { recursive: true });
  fs.writeFileSync(path.join(LAYOUTS_DIR, SITE, "index.json"), JSON.stringify({ municipality: "05210", entries: [{ bulletin_id: L4.bulletin_id, issued_at: L4.issued_at, file: L4.file, screen: true }] }));
  fs.writeFileSync(APPROVALS_FILE, JSON.stringify({ version: "0.1", layouts: {}, sites: {}, classes: { [`${SITE}/flood/evac-now/4`]: { approved: true, updated_at: "2026-11-07T00:00:00Z", digest: "sha256:x", approved_from: L4.bulletin_id } } }));
  const alert = { ...L4.alert, bulletin_id: "VXKOii-202611071200-000000000000", issued_at: "2026-11-07T12:00:00+09:00" };
  const step = await writeForBulletin({ alert, municipality, situation: situationFor(alert, "05210"), site: { id: SITE } }, { live: { client: noApi, model: "opus" }, persist: false, usage: [] });
  assert.equal(step.writerSource, `writer-class-cache:${L4.bulletin_id}`);
  assert.equal(step.writer.cells.find((c) => c.role === "action")!.text.ja_easy, "しょうにんした ぶん");
  fs.rmSync(APPROVALS_FILE);
});
