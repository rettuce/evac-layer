import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoData = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "evac-old-records-"));
for (const dir of ["jma", "municipalities", "sites", "writer"]) fs.cpSync(path.join(repoData, dir), path.join(dataDir, dir), { recursive: true });
for (const site of ["15205-demo", "17204-demo"]) fs.cpSync(path.join(repoData, "layouts", site), path.join(dataDir, "layouts", site), { recursive: true });
process.env.EVAC_DATA_DIR = dataDir;

const { APPROVALS_FILE, FEED_DIR, LAYOUTS_DIR, WRITER_DIR } = await import("../src/paths.js");
const { situationFor } = await import("../src/composer/rules.js");
const { headlineSource } = await import("../src/composer/headline.js");
const { replayEntry } = await import("../src/jma/replay.js");
const { loadMunicipality } = await import("../src/loop/municipality.js");
const { runLoop } = await import("../src/loop/loop.js");
const { staticVerifier } = await import("../src/loop/static-verifier.js");
const { writeForBulletin } = await import("../src/writer/step.js");
const { classDigest, screenClass } = await import("../../app/layout/gate");
const { needsRaw } = await import("./raw.js");
import type { SiteFile } from "../src/sites.js";

const site = (id: string) => JSON.parse(fs.readFileSync(path.join(dataDir, "sites", `${id}.json`), "utf8")) as SiteFile;
const W55 = "bodies/20261021/20261021061124_0_VPWW55_170000.xml";
const W56 = "bodies/20261021/20261021150027_0_VPWW56_170000.xml";
const K_L4 = "bodies/20261031/20261031075327_0_VPWW56_150000.xml";
const K_L4_LATER = "bodies/20261031/20261031093903_0_VPWW56_150000.xml";
const skip = needsRaw({ feed: [W55, W56, K_L4, K_L4_LATER] });

function withKind(file: string, cityCode: string, kind: { name: string; code: string; status: string; last?: { name: string; code: string } }, title?: [string, string], city?: [string, string]): string {
  let xml = fs.readFileSync(path.join(FEED_DIR, file), "utf8");
  if (city) xml = xml.replaceAll(`<Name>${city[0]}</Name>\n<Code>${cityCode}</Code>`, `<Name>${city[1]}</Name>\n<Code>${cityCode}</Code>`);
  xml = xml.replace(new RegExp(`<Item>\\s*<Kind>(?:(?!</Item>)[\\s\\S])*?<Code>${cityCode}</Code>(?:(?!</Item>)[\\s\\S])*?</Item>`, "g"), (item) => {
    const last = kind.last ? `<LastKind>\n<Name>${kind.last.name}</Name>\n<Code>${kind.last.code}</Code>\n</LastKind>\n` : "";
    return item.replace(/<Kind>[\s\S]*?<\/Kind>/, `<Kind>\n<Name>${kind.name}</Name>\n<Code>${kind.code}</Code>\n<Status>${kind.status}</Status>\n${last}</Kind>`);
  });
  if (title) xml = xml.replace(`<Title>${title[0]}</Title>`, `<Title>${title[1]}</Title>`);
  return xml.replace(/<ReportDateTime>[^<]*</, "<ReportDateTime>2026-11-20T03:10:00+09:00<");
}

// Stored screens predate the dictionary source a screen carries now, so they are compared as composed today.
function approveFrom(siteId: string, bulletinId: string): { cls: string; digest: string } {
  const dir = path.join(LAYOUTS_DIR, siteId, bulletinId);
  const files = fs.readdirSync(dir).map((f) => {
    const layout = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    return { shape: f.slice(0, -5), body: JSON.stringify({ ...layout, sources: [...layout.sources, headlineSource()] }, null, 2) + "\n" };
  });
  const cls = screenClass(JSON.parse(files[0]!.body));
  const approvals = fs.existsSync(APPROVALS_FILE) ? JSON.parse(fs.readFileSync(APPROVALS_FILE, "utf8")) : { version: "0.1", layouts: {}, sites: {}, classes: {} };
  approvals.classes[`${siteId}/${cls}`] = { approved: true, updated_at: "2026-11-11T00:00:00Z", digest: classDigest(files), approved_from: bulletinId };
  fs.writeFileSync(APPROVALS_FILE, JSON.stringify(approvals));
  return { cls, digest: classDigest(files) };
}

async function compose(siteId: string, xml: string | Buffer, code: string) {
  const s = site(siteId);
  const entry = replayEntry(Buffer.from(xml), "x.xml", code, s.municipality_id);
  const { municipality } = loadMunicipality(s.municipality_id);
  const situation = situationFor(entry.alert, s.municipality_id);
  const step = await writeForBulletin({ alert: entry.alert, municipality, situation, site: s }, { persist: false, usage: [] });
  const result = await runLoop({ alert: entry.alert, municipality, site: s, writer: step.writer, writerSource: step.writerSource, verifier: staticVerifier, reviser: step.reviser });
  const files = result.screens.map((x) => ({ shape: x.shape, body: JSON.stringify(x, null, 2) + "\n" }));
  return { source: step.writerSource, cls: screenClass(result.screens[0] as never), digest: classDigest(files) };
}

test("an old class record is restored from its bulletin's screens: the advisory's all-clear is not reused for a warning's", { skip }, async () => {
  assert.equal(JSON.parse(fs.readFileSync(path.join(WRITER_DIR, "17204/class/heavy_rain-all-clear-1.json"), "utf8")).match, undefined, "the record is an old one");
  const fromWarning = withKind(W55, "1720400", { name: "レベル３大雨警報", code: "03", status: "解除", last: { name: "レベル３大雨警報", code: "03" } });
  assert.equal((await compose("17204-demo", fromWarning, "VPWW55")).source, "placeholder");
  const fromAdvisory = withKind(W55, "1720400", { name: "レベル２大雨注意報", code: "10", status: "解除", last: { name: "レベル２大雨注意報", code: "10" } });
  assert.equal((await compose("17204-demo", fromAdvisory, "VPWW55")).source, "writer-class-cache:VPWW55-202610211942-7720a18f5cfa");
});

test("once its record is marked blind, the advisory's all-clear wording serves a warning's all-clear under one class approval", { skip }, async () => {
  const classFile = path.join(WRITER_DIR, "17204/class/heavy_rain-all-clear-1.json");
  const kept = fs.readFileSync(classFile, "utf8");
  fs.writeFileSync(classFile, JSON.stringify({ ...JSON.parse(kept), blind: true }));
  const fromWarning = await compose("17204-demo", withKind(W55, "1720400", { name: "レベル３大雨警報", code: "03", status: "解除", last: { name: "レベル３大雨警報", code: "03" } }), "VPWW55");
  const fromAdvisory = await compose("17204-demo", withKind(W55, "1720400", { name: "レベル２大雨注意報", code: "10", status: "解除", last: { name: "レベル２大雨注意報", code: "10" } }), "VPWW55");
  fs.writeFileSync(classFile, kept);
  assert.equal(fromAdvisory.source, "writer-class-cache:VPWW55-202610211942-7720a18f5cfa");
  assert.equal(fromWarning.source, fromAdvisory.source);
  assert.equal(fromWarning.cls, "heavy_rain/all-clear/1");
  assert.equal(fromWarning.digest, fromAdvisory.digest, "the headlines differ, and the class digest leaves every headline language out");
});

test("an old record whose bulletin left neither XML nor screens is not reused for another bulletin", { skip }, async () => {
  const classFile = path.join(WRITER_DIR, "17204/class/heavy_rain-all-clear-1.json");
  const kept = fs.readFileSync(classFile, "utf8");
  fs.writeFileSync(classFile, JSON.stringify({ ...JSON.parse(kept), bulletin_id: "VPWW55-202001010000-000000000000" }));
  const fromAdvisory = withKind(W55, "1720400", { name: "レベル２大雨注意報", code: "10", status: "解除", last: { name: "レベル２大雨注意報", code: "10" } });
  assert.equal((await compose("17204-demo", fromAdvisory, "VPWW55")).source, "placeholder");
  fs.writeFileSync(classFile, kept);
});

test("classes approved from real bulletins keep opening the bulletins they matched before", { skip }, async () => {
  const l4 = approveFrom("15205-demo", "VPWW56-202610311653-b3fa1b3a2ced");
  fs.rmSync(path.join(WRITER_DIR, "15205", "VPWW56-202610311839-e6123510be74.json"));
  const later = await compose("15205-demo", fs.readFileSync(path.join(FEED_DIR, K_L4_LATER)), "VPWW56");
  assert.deepEqual([later.source, later.cls, later.digest], ["writer-class-cache:VPWW56-202610311653-b3fa1b3a2ced", l4.cls, l4.digest]);

  const clear = approveFrom("15205-demo", "VPWW56-202611010401-fc7d8fb812f9");
  const moved = withKind(W56, "1520500", { name: "レベル２土砂災害注意報", code: "29", status: "解除", last: { name: "レベル２土砂災害注意報", code: "29" } }, ["石川県土砂災害警報・注意報", "新潟県土砂災害警報・注意報"], ["輪島市", "柏崎市"])
    .replaceAll("<Code>1720400</Code>", "<Code>1520500</Code>");
  const g1 = await compose("15205-demo", moved, "VPWW56");
  assert.deepEqual([g1.source, g1.cls, g1.digest], ["writer-class-cache:VPWW56-202611010401-fc7d8fb812f9", clear.cls, clear.digest]);
});

test("a class approved from a bulletin whose XML is gone is restored from its screens", { skip }, async () => {
  const l3 = approveFrom("17204-demo", "VPWW55-202610200500-e9e69c6c3b73");
  const real = withKind(W55, "1720400", { name: "レベル３大雨警報", code: "03", status: "継続", last: { name: "レベル３大雨警報", code: "03" } });
  const composed = await compose("17204-demo", real, "VPWW55");
  assert.deepEqual([composed.source, composed.cls, composed.digest], ["writer-class-cache:VPWW55-202610200500-e9e69c6c3b73", l3.cls, l3.digest]);
});
