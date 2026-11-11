import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "evac-writer-match-"));
fs.cpSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/jma"), path.join(dataDir, "jma"), { recursive: true });
process.env.EVAC_DATA_DIR = dataDir;

const { AGENTS_DIR, REPO_ROOT, WRITER_DIR } = await import("../src/paths.js");
const { situationFor } = await import("../src/composer/rules.js");
const { cachedWriterRecord, saveWriterForClass, screenClassFor } = await import("../src/writer/live.js");
const { writerMatchFor } = await import("../src/writer/match.js");
const { writeForBulletin } = await import("../src/writer/step.js");
import type Anthropic from "@anthropic-ai/sdk";
import type { Municipality, WriterOutput } from "../src/composer/compose.js";
import type { Alert } from "../src/jma/parse.js";
import type { ReplayEntry } from "../src/jma/replay.js";

const { entries } = JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, "test/fixtures/replay-05210-koyoshi-20261021.json"), "utf8")) as { entries: ReplayEntry[] };
const L4 = entries.find((e) => e.bulletin_id === "VXKOii-202610211815-e713da0e3c05")!;
const koyoshi = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/municipalities/05210.json"), "utf8")) as Municipality;
const wajima = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/municipalities/17204.json"), "utf8")) as Municipality;
const noApi = { messages: { stream: () => { throw new Error("the Writer API was called"); } } } as unknown as Anthropic;

const wording = (easy: string): WriterOutput => ({ cells: [
  { role: "headline", text: { ja: "x", ja_easy: easy }, basis: "test" },
  { role: "action", text: { ja: "避難", ja_easy: easy }, basis: "test" },
  { role: "languages", text: { ja: "避難", ja_easy: easy }, basis: "test" },
] });

function heavyRain(opts: { title: string; kind: string; kindCode: string; status: "issued" | "cleared"; level: number | null; id: string; drill?: boolean }): Alert {
  return {
    bulletin_id: opts.id, code: "VPWW55", hazard: "heavy_rain", level: opts.level, info_type: "issued", issued_at: "2026-11-01T10:00:00+09:00",
    raw_title: opts.title, headline_text: "", publishing_office: "気象庁", status: opts.drill ? "drill" : "normal",
    areas: [{ code: "1720400", name: "輪島市", code_type: "city", level: opts.level, kind_code: opts.kindCode, kind_name: opts.kind, status: opts.status }],
  };
}

const step = (alert: Alert, municipality: Municipality, site = "17204-test") =>
  writeForBulletin({ alert, municipality, situation: situationFor(alert, municipality.id), site: { id: site } }, { live: { client: noApi, model: "opus" }, persist: false, usage: [] });

test("the match names what the Writer wrote from: the class, the status, the warning on screen and, for a flood forecast, the river", () => {
  assert.deepEqual(writerMatchFor(L4.alert, "05210", situationFor(L4.alert, "05210")), {
    hazard: "flood", template: "evac-now", level: 4, status: "normal", warning: "レベル４氾濫危険警報", river: "子吉川",
  });
  const clear = heavyRain({ title: "石川県大雨警報・注意報", kind: "レベル２大雨注意報", kindCode: "10", status: "cleared", level: null, id: "VPWW55-202611011000-000000000001" });
  assert.deepEqual(writerMatchFor(clear, "17204", situationFor(clear, "17204")), {
    hazard: "heavy_rain", template: "all-clear", level: 1, status: "normal", warning: "レベル２大雨注意報解除",
  });
});

test("a record with a match is reused across Head/Titles, and only for the same match", async () => {
  const written = heavyRain({ title: "新潟県大雨警報・注意報", kind: "レベル３大雨警報", kindCode: "03", status: "issued", level: 3, id: "VPWW55-202611011000-000000000002" });
  const cls = screenClassFor("heavy_rain", situationFor(written, "17204"));
  saveWriterForClass("17204", cls, { model: "opus", output: wording("かぎ あり"), bulletin_id: written.bulletin_id, issued_at: written.issued_at, raw_title: written.raw_title, match: writerMatchFor(written, "17204", situationFor(written, "17204")) });
  const real = heavyRain({ title: "石川県大雨警報・注意報", kind: "レベル３大雨警報", kindCode: "03", status: "issued", level: 3, id: "VPWW55-202611021000-000000000003" });
  const reused = await step(real, wajima);
  assert.equal(reused.writerSource, `writer-class-cache:${written.bulletin_id}`);
  assert.equal(reused.writer.cells[1]!.text.ja_easy, "かぎ あり");
  await assert.rejects(step({ ...real, status: "drill" }, wajima), /Writer API was called/, "a drill never takes normal wording");

  const clearAdvisory = heavyRain({ title: "新潟県大雨警報・注意報", kind: "レベル２大雨注意報", kindCode: "10", status: "cleared", level: null, id: "VPWW55-202611011000-000000000004" });
  saveWriterForClass("17204", "heavy_rain/all-clear/1", { model: "opus", output: wording("おわり"), bulletin_id: clearAdvisory.bulletin_id, issued_at: clearAdvisory.issued_at, raw_title: "石川県大雨警報・注意報", match: writerMatchFor(clearAdvisory, "17204", situationFor(clearAdvisory, "17204")) });
  const clearWarning = heavyRain({ title: "石川県大雨警報・注意報", kind: "レベル３大雨警報", kindCode: "03", status: "cleared", level: null, id: "VPWW55-202611021000-000000000005" });
  await assert.rejects(step(clearWarning, wajima), /Writer API was called/, "the clearance of another warning is written anew even under the same Head/Title");
  assert.equal((await step({ ...clearAdvisory, raw_title: "石川県大雨警報・注意報" }, wajima)).writerSource, `writer-class-cache:${clearAdvisory.bulletin_id}`);
});

test("a record without a match keeps the old rule: same Head/Title, caution and status", async () => {
  const old = heavyRain({ title: "石川県大雨警報・注意報", kind: "レベル４大雨危険警報", kindCode: "43", status: "issued", level: 4, id: "VPWW55-202610011000-000000000006" });
  saveWriterForClass("17204", "heavy_rain/evac-now/4", { model: "opus", output: wording("ふるい"), bulletin_id: old.bulletin_id, issued_at: old.issued_at, raw_title: old.raw_title, status: "normal" });
  const sameTitle = await step({ ...old, bulletin_id: "VPWW55-202611031000-000000000007" }, wajima);
  assert.equal(sameTitle.writerSource, `writer-class-cache:${old.bulletin_id}`);
  assert.equal(sameTitle.match, undefined, "a reuse under the old rule passes no match on");
  await assert.rejects(step({ ...old, raw_title: "新潟県大雨警報・注意報" }, wajima), /Writer API was called/);
});

test("a flood forecast on another river is written anew", async () => {
  saveWriterForClass("05210", "flood/evac-now/4", { model: "opus", output: wording("かわ"), bulletin_id: L4.bulletin_id, issued_at: L4.issued_at, raw_title: L4.alert.raw_title, match: writerMatchFor(L4.alert, "05210", situationFor(L4.alert, "05210")) });
  const next = { ...L4.alert, bulletin_id: "VXKOii-202611071200-000000000008" };
  assert.equal((await step(next, koyoshi, "05210-test")).writerSource, `writer-class-cache:${L4.bulletin_id}`);
  await assert.rejects(step({ ...next, raw_title: "芋川レベル４氾濫危険警報" }, koyoshi, "05210-test"), /Writer API was called/);
});

test("wording the Writer writes is saved with its match, and a reuse saves the match it was found by", async () => {
  const reply = { cells: wording("あたらしい").cells };
  const client = { messages: { stream: () => ({ finalMessage: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(reply) }], usage: { input_tokens: 1, output_tokens: 1 } }) }) } } as unknown as Anthropic;
  const alert = heavyRain({ title: "石川県大雨警報・注意報", kind: "レベル３大雨警報", kindCode: "03", status: "issued", level: 3, id: "VPWW55-202611041000-000000000009", drill: true });
  const situation = situationFor(alert, "17204");
  const s = await writeForBulletin({ alert, municipality: wajima, situation, site: { id: "17204-test" } }, { live: { client, model: "opus" }, persist: true, usage: [] });
  assert.equal(s.writerSource, "writer-api:opus");
  assert.deepEqual(cachedWriterRecord("17204", alert.bulletin_id)!.match, writerMatchFor(alert, "17204", situation));

  const real = heavyRain({ title: "石川県大雨警報・注意報", kind: "レベル３大雨警報", kindCode: "03", status: "issued", level: 3, id: "VPWW55-202611051000-000000000010" });
  const reused = await writeForBulletin({ alert: real, municipality: wajima, situation: situationFor(real, "17204"), site: { id: "17204-test" } }, { persist: true, usage: [] });
  reused.afterLoop({ outcome: "pass", writer: reused.writer } as never);
  assert.deepEqual(cachedWriterRecord("17204", real.bulletin_id)!.match, writerMatchFor(real, "17204", situationFor(real, "17204")));
  fs.rmSync(path.join(WRITER_DIR, "17204"), { recursive: true });
});
