import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "evac-class-cache-"));
fs.cpSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/jma"), path.join(dataDir, "jma"), { recursive: true });
process.env.EVAC_DATA_DIR = dataDir;

const { AGENTS_DIR, REPO_ROOT, WRITER_DIR } = await import("../src/paths.js");
const { situationFor } = await import("../src/composer/rules.js");
const { cachedWriterForClass, saveWriterForClass, screenClassFor } = await import("../src/writer/live.js");
const { writeForBulletin } = await import("../src/writer/step.js");
const { screenClass } = await import("../../app/layout/gate");
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
  const step = await writeForBulletin({ alert, municipality, situation }, { live: { client: noApi, model: "opus" }, persist: false, usage: [] });
  assert.equal(step.writerSource, `writer-class-cache:${L4.bulletin_id}`);
  assert.equal(step.writer.cells.find((c) => c.role === "action")!.text.ja_easy, "たかい ところへ にげて");

  const otherRiver = { ...alert, raw_title: "芋川レベル４氾濫危険警報" };
  await assert.rejects(writeForBulletin({ alert: otherRiver, municipality, situation }, { live: { client: noApi, model: "opus" }, persist: false, usage: [] }), /Writer API was called/);
});
