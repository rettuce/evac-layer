import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "evac-drill-text-"));
const repoData = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data");
fs.cpSync(path.join(repoData, "jma"), path.join(dataDir, "jma"), { recursive: true });
process.env.EVAC_DATA_DIR = dataDir;

const { AGENTS_DIR, APPROVALS_FILE, LAYOUTS_DIR, SAMPLES_DIR, WRITER_DIR } = await import("../src/paths.js");
const { situationFor } = await import("../src/composer/rules.js");
const { saveWriterForClass, screenClassFor } = await import("../src/writer/live.js");
const { writeForBulletin } = await import("../src/writer/step.js");
const { replayEntry } = await import("../src/jma/replay.js");
const { composeBulletin } = await import("../src/loop/one.js");
const { runLoop } = await import("../src/loop/loop.js");
const { liveWriterReviser } = await import("../src/loop/revisers.js");
const { staticVerifier } = await import("../src/loop/static-verifier.js");
const { DRILL_MARKERS, judgeDrill, judgeDrillWordOutsideDrill } = await import("../src/verifier/checks.js");
const { approvalWith, classDigest, layoutDigest, screenClass } = await import("../../app/layout/gate");
const { needsRaw } = await import("./raw.js");
import type Anthropic from "@anthropic-ai/sdk";
import type { Municipality, Site, WriterOutput } from "../src/composer/compose.js";
import type { Alert } from "../src/jma/parse.js";
import type { ReplayEntry } from "../src/jma/replay.js";

const M = "22424";
const SITE_ID = "22424-demo";
const DRILL_FILE = "32-39_12_02_250206_VTSE41.xml";
const DRILL_ID = "VTSE41-201609010713-ff3dd5d5c94f";
const skip = needsRaw({ samples: [DRILL_FILE] });

const readJson = <T>(...p: string[]): T => JSON.parse(fs.readFileSync(path.join(...p), "utf8")) as T;
const site = readJson<Site>(repoData, "sites", `${SITE_ID}.json`);
const municipality = readJson<Municipality>(repoData, "municipalities", `${M}.json`);
const drillText = readJson<{ output: WriterOutput }>(repoData, "writer", M, `${DRILL_ID}.json`).output;
const normalText: WriterOutput = {
  cells: drillText.cells.map((c) => ({
    ...c,
    text: Object.fromEntries(Object.entries(c.text).map(([lang, t]) => [lang, DRILL_MARKERS[lang] && t ? t.replace(DRILL_MARKERS[lang], "").replace(/^[:：\s]+/, "") : t])),
  })) as WriterOutput["cells"],
};
const noApi = { messages: { stream: () => { throw new Error("the Writer API was called"); } } } as unknown as Anthropic;

const drillEntry = (): ReplayEntry => replayEntry(fs.readFileSync(path.join(SAMPLES_DIR, DRILL_FILE)), `jma-samples/${DRILL_FILE}`, "VTSE41", M);
const withStatus = (alert: Alert, status: Alert["status"], n: number): Alert =>
  ({ ...alert, status, bulletin_id: `VTSE41-202611110900-00000000000${n}`, issued_at: "2026-11-11T09:00:00+09:00" });

function anyDrillWord(cells: { text: Record<string, string | undefined> }[]): string[] {
  return cells.flatMap((c) => Object.entries(c.text).filter(([lang, t]) => t !== undefined && DRILL_MARKERS[lang]?.test(t)).map(([lang]) => lang));
}

function writeBulletinRecord(bulletinId: string, output: WriterOutput, status?: Alert["status"]) {
  const f = path.join(WRITER_DIR, M, `${bulletinId}.json`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ model: "opus", output, usage: [], lint: [], ...(status ? { status } : {}) }));
  return f;
}

async function sourceFor(alert: Alert, live = false): Promise<string> {
  const step = await writeForBulletin(
    { alert, municipality, situation: situationFor(alert, M), site: { id: SITE_ID } },
    { ...(live ? { live: { client: noApi, model: "opus" as const } } : {}), persist: false, usage: [] },
  );
  return step.writerSource;
}

test("a bulletin's own Writer record is reused only for a bulletin of the same status", { skip }, async () => {
  const drill = drillEntry().alert;
  const normal = withStatus(drill, "normal", 1);
  const drillAgain = withStatus(drill, "drill", 2);

  let f = writeBulletinRecord(normal.bulletin_id, drillText, "drill");
  assert.equal(await sourceFor(normal), "placeholder", "a drill record is not used for a normal bulletin");
  await assert.rejects(sourceFor(normal, true), /Writer API was called/, "with a Writer, the normal bulletin is written anew");
  f = writeBulletinRecord(normal.bulletin_id, normalText, "normal");
  assert.equal(await sourceFor(normal), "writer-cache");
  fs.rmSync(f);

  f = writeBulletinRecord(drillAgain.bulletin_id, normalText, "normal");
  assert.equal(await sourceFor(drillAgain), "placeholder", "a normal record is not used for a drill bulletin");
  f = writeBulletinRecord(drillAgain.bulletin_id, drillText, "drill");
  assert.equal(await sourceFor(drillAgain), "writer-cache");
  fs.rmSync(f);
});

test("a record written before the status was kept counts as a drill record when its text carries the drill word", { skip }, async () => {
  const drill = drillEntry().alert;
  const normal = withStatus(drill, "normal", 1);
  const drillAgain = withStatus(drill, "drill", 2);

  let f = writeBulletinRecord(normal.bulletin_id, drillText);
  assert.equal(await sourceFor(normal), "placeholder");
  fs.rmSync(f);
  f = writeBulletinRecord(normal.bulletin_id, normalText);
  assert.equal(await sourceFor(normal), "writer-cache");
  fs.rmSync(f);
  f = writeBulletinRecord(drillAgain.bulletin_id, drillText);
  assert.equal(await sourceFor(drillAgain), "writer-cache");
  fs.rmSync(f);
  f = writeBulletinRecord(drillAgain.bulletin_id, normalText);
  assert.equal(await sourceFor(drillAgain), "placeholder");
  fs.rmSync(f);
});

test("the municipality's class record is reused only for a bulletin of the same status", { skip }, async () => {
  const drill = drillEntry().alert;
  const normal = withStatus(drill, "normal", 1);
  const drillAgain = withStatus(drill, "drill", 2);
  const cls = screenClassFor(drill.hazard, situationFor(drill, M));
  const classFile = path.join(WRITER_DIR, M, "class", `${cls.replaceAll("/", "-")}.json`);
  const save = (output: WriterOutput, status?: Alert["status"]) =>
    saveWriterForClass(M, cls, { model: "opus", output, bulletin_id: DRILL_ID, issued_at: drill.issued_at, raw_title: drill.raw_title, ...(status ? { status } : {}) });

  save(drillText, "drill");
  assert.equal(await sourceFor(normal), "placeholder");
  assert.equal(await sourceFor(drillAgain), `writer-class-cache:${DRILL_ID}`);
  save(normalText, "normal");
  assert.equal(await sourceFor(normal), `writer-class-cache:${DRILL_ID}`);
  assert.equal(await sourceFor(drillAgain), "placeholder");
  save(drillText);
  assert.equal(await sourceFor(normal), "placeholder", "a class record without a status but with drill text is a drill record");
  assert.equal(await sourceFor(drillAgain), `writer-class-cache:${DRILL_ID}`);
  save(normalText);
  assert.equal(await sourceFor(normal), `writer-class-cache:${DRILL_ID}`);
  fs.rmSync(classFile);
});

test("the wording of an approved class is reused only for a bulletin of the same status as the one it was approved from", { skip }, async () => {
  const entry = drillEntry();
  const drill = entry.alert;
  const cls = screenClassFor(drill.hazard, situationFor(drill, M));
  const own = writeBulletinRecord(DRILL_ID, drillText);
  fs.mkdirSync(path.join(LAYOUTS_DIR, SITE_ID), { recursive: true });
  fs.writeFileSync(path.join(LAYOUTS_DIR, SITE_ID, "index.json"), JSON.stringify({ municipality: M, entries: [{ bulletin_id: DRILL_ID, issued_at: drill.issued_at, file: entry.file, screen: true }] }));
  fs.writeFileSync(APPROVALS_FILE, JSON.stringify({ version: "0.1", layouts: {}, sites: {}, classes: { [`${SITE_ID}/${cls}`]: { approved: true, updated_at: "2026-11-11T00:00:00Z", digest: "sha256:x", approved_from: DRILL_ID } } }));
  assert.equal(await sourceFor(withStatus(drill, "drill", 2)), `writer-class-cache:${DRILL_ID}`);
  assert.equal(await sourceFor(withStatus(drill, "normal", 1)), "placeholder");
  await assert.rejects(sourceFor(withStatus(drill, "normal", 1), true), /Writer API was called/);
  fs.rmSync(APPROVALS_FILE);
  fs.rmSync(path.join(LAYOUTS_DIR, SITE_ID, "index.json"));
  fs.rmSync(own);
});

const L4_ID = "VXKOii-202610211815-e713da0e3c05";
const replay05210 = readJson<{ entries: ReplayEntry[] }>(AGENTS_DIR, "test/fixtures/replay-05210-koyoshi-20261021.json");
const L4 = replay05210.entries.find((e) => e.bulletin_id === L4_ID)!;

test("the wording of a class approved from a normal bulletin is not reused for a drill bulletin", { skip: needsRaw({ feed: [L4.file] }) }, async () => {
  const m05210 = readJson<Municipality>(repoData, "municipalities", "05210.json");
  const testSite = "05210-test-site";
  const cls = screenClassFor(L4.alert.hazard, situationFor(L4.alert, "05210"));
  const own = path.join(WRITER_DIR, "05210", `${L4_ID}.json`);
  fs.mkdirSync(path.dirname(own), { recursive: true });
  fs.copyFileSync(path.join(repoData, "writer", "05210", `${L4_ID}.json`), own);
  fs.mkdirSync(path.join(LAYOUTS_DIR, testSite), { recursive: true });
  fs.writeFileSync(path.join(LAYOUTS_DIR, testSite, "index.json"), JSON.stringify({ municipality: "05210", entries: [{ bulletin_id: L4_ID, issued_at: L4.issued_at, file: L4.file, screen: true }] }));
  fs.writeFileSync(APPROVALS_FILE, JSON.stringify({ version: "0.1", layouts: {}, sites: {}, classes: { [`${testSite}/${cls}`]: { approved: true, updated_at: "2026-11-11T00:00:00Z", digest: "sha256:x", approved_from: L4_ID } } }));
  const source = async (status: Alert["status"]) => {
    const alert = { ...L4.alert, status, bulletin_id: "VXKOii-202611110900-000000000000", issued_at: "2026-11-11T09:00:00+09:00" };
    return (await writeForBulletin({ alert, municipality: m05210, situation: situationFor(alert, "05210"), site: { id: testSite } }, { persist: false, usage: [] })).writerSource;
  };
  assert.equal(await source("normal"), `writer-class-cache:${L4_ID}`);
  assert.equal(await source("drill"), "placeholder");
  fs.rmSync(APPROVALS_FILE);
  fs.rmSync(path.join(LAYOUTS_DIR, testSite, "index.json"));
  fs.rmSync(own);
});

test("a drill word in any language of a screen for a bulletin that is not a drill is a finding", () => {
  const samples = drillText.cells.flatMap((c) => Object.entries(c.text).filter(([lang, t]) => t && DRILL_MARKERS[lang]?.test(t)).map(([lang, t]) => ({ role: c.role, lang, t: t! })));
  samples.push({ role: "headline", lang: "ja", t: "【訓練】大津波警報" });
  assert.equal(new Set(samples.map((s) => s.lang)).size, Object.keys(DRILL_MARKERS).length, "every language with a drill word is covered");
  for (const s of samples) {
    const cells = [{ id: s.role, role: s.role, text: { [s.lang]: s.t } }];
    assert.deepEqual(judgeDrillWordOutsideDrill(cells, "normal").map((f) => `${f.check} ${f.cell_id}:${f.lang}`), [`drill-word-outside-drill ${s.role}:${s.lang}`]);
    assert.equal(judgeDrillWordOutsideDrill(cells, "test").length, 1);
    assert.deepEqual(judgeDrillWordOutsideDrill(cells, "drill"), []);
  }
  assert.deepEqual(judgeDrillWordOutsideDrill(normalText.cells.map((c) => ({ id: c.role, role: c.role, text: c.text })), "normal"), []);
  const missing = [{ id: "action", role: "action", text: { en: "Go higher" } }];
  assert.deepEqual(judgeDrill(missing, "drill").map((f) => f.check), ["drill-marker"], "a drill without the drill word is still sent back");
});

test("drill text on a normal bulletin's screen stops the loop instead of going back to the Writer", { skip }, async () => {
  const normal = withStatus(drillEntry().alert, "normal", 1);
  const r = await runLoop({ alert: normal, municipality, site, verifier: staticVerifier, writer: drillText, writerSource: "writer-cache", reviser: liveWriterReviser });
  assert.equal(r.outcome, "fail");
  assert.equal(r.attempts.length, 1);
  assert.match(r.reason!, /not fixable by rewriting text/);
  assert.match(r.reason!, /drill-word-outside-drill\[/);
  const drill = await runLoop({ alert: drillEntry().alert, municipality, site, verifier: staticVerifier, writer: drillText, writerSource: "writer-cache", reviser: liveWriterReviser });
  assert.equal(drill.outcome, "pass");
});

test("a normal bulletin of a class approved from a drill gets no drill text and does not match the approval", { skip }, async () => {
  const roots = { reports: path.join(dataDir, "e2e-reports"), layouts: LAYOUTS_DIR };
  const own = writeBulletinRecord(DRILL_ID, drillText);
  const entry = drillEntry();
  const compose = (e: ReplayEntry) => composeBulletin({ entry: e, municipality, readerRan: true, site, verifier: staticVerifier, writer: { kind: "placeholder" }, roots });
  const files = (bulletinId: string) => {
    const dir = path.join(LAYOUTS_DIR, SITE_ID, bulletinId);
    return fs.readdirSync(dir).map((f) => ({ shape: f.slice(0, -5), body: fs.readFileSync(path.join(dir, f), "utf8") }));
  };

  const approvedFrom = await compose(entry);
  assert.equal(approvedFrom.outcome, "pass");
  const drillFiles = files(DRILL_ID);
  const cls = screenClass(JSON.parse(drillFiles[0].body));
  assert.equal(cls, "tsunami/evac-now/4/drill", "a drill screen has a class of its own");
  const approvals = {
    version: "0.1" as const,
    layouts: { [`${SITE_ID}/${DRILL_ID}`]: { approved: true, updated_at: "2026-11-11T00:00:00Z", digest: layoutDigest(drillFiles) } },
    sites: { [SITE_ID]: { auto_publish: true, updated_at: "2026-11-11T00:00:00Z" } },
    classes: { [`${SITE_ID}/${cls}`]: { approved: true, updated_at: "2026-11-11T00:00:00Z", digest: classDigest(drillFiles), approved_from: DRILL_ID } },
  };
  fs.writeFileSync(APPROVALS_FILE, JSON.stringify(approvals));

  const normalAlert = withStatus(entry.alert, "normal", 1);
  const normal = await compose({ ...entry, alert: normalAlert, bulletin_id: normalAlert.bulletin_id, issued_at: normalAlert.issued_at });
  assert.equal(normal.attempts?.[0].writer_source, "placeholder");
  const normalFiles = files(normalAlert.bulletin_id);
  assert.equal(normalFiles.length, drillFiles.length);
  for (const f of normalFiles) {
    const layout = JSON.parse(f.body) as { cells: { text: Record<string, string | undefined> }[] };
    assert.deepEqual(anyDrillWord(layout.cells), [], `${f.shape} carries no drill word`);
    assert.equal(screenClass(layout), cls.replace(/\/drill$/, ""), "the normal screen has the class without the drill mark");
  }
  assert.notEqual(classDigest(normalFiles), approvals.classes[`${SITE_ID}/${cls}`].digest);
  const gate = approvalWith(approvals, SITE_ID, normalAlert.bulletin_id, layoutDigest(normalFiles), { key: cls, digest: classDigest(normalFiles), checked: true });
  assert.equal(gate.approved, false);
  fs.rmSync(APPROVALS_FILE);
  fs.rmSync(own);
});
