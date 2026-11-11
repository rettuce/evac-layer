import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoData = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "evac-generation-"));
for (const dir of ["jma", "municipalities"]) fs.cpSync(path.join(repoData, dir), path.join(dataDir, dir), { recursive: true });
const easyTable = path.join(dataDir, "jma", "warning-names-ja-easy.json");
fs.writeFileSync(easyTable, JSON.stringify({ ...JSON.parse(fs.readFileSync(easyTable, "utf8")), reviewed: true }), "utf8");
process.env.EVAC_DATA_DIR = dataDir;

const { APPROVALS_FILE, FEED_DIR, LAYOUTS_DIR, REPORTS_DIR, SYNTHETIC_DIR, WRITER_DIR } = await import("../src/paths.js");
const { cachedWriterRecord } = await import("../src/writer/live.js");
const { generateSite, generationFile } = await import("../src/loop/generation.js");
const { classListing } = await import("../src/jma/synthetic-classes.js");
const { synthesizeXml, TEMPLATES_DIR } = await import("../src/jma/synthetic.js");
const { parseJmaXml } = await import("../src/jma/parse.js");
const { replayEntry } = await import("../src/jma/replay.js");
const { receiveSite } = await import("../src/jma/receive.js");
const { composeBulletin } = await import("../src/loop/one.js");
const { loadMunicipality } = await import("../src/loop/municipality.js");
const { staticVerifier } = await import("../src/loop/static-verifier.js");
const { layoutClassOf, layoutDigestOf } = await import("../src/delivery/gate.js");
const { approvalWith, classDigest, layoutDigest, screenClass } = await import("../../app/layout/gate");
const { needsRaw } = await import("./raw.js");
import type Anthropic from "@anthropic-ai/sdk";
import type { WriterOutput } from "../src/composer/compose.js";
import type { Verifier } from "../src/loop/types.js";
import type { SiteFile } from "../src/sites.js";

const site = (id: string) => JSON.parse(fs.readFileSync(path.join(repoData, "sites", `${id}.json`), "utf8")) as SiteFile;
const KASHIWAZAKI = site("15205-demo");
const WAJIMA = site("17204-demo");
const SIX = ["heavy_rain/evac-prepare/3", "heavy_rain/evac-now/4", "heavy_rain/all-clear/1", "landslide/evac-prepare/3", "landslide/evac-now/4", "landslide/all-clear/1"];

// The browser check needs Chrome and the renderer; the static checks stand in, under a name the gate reads as checked.
const checkedVerifier: Verifier = { name: "static+browser(test)", rendersScreens: true, verify: staticVerifier.verify };

const recorded = (m: string, cls: string) => (JSON.parse(fs.readFileSync(path.join(repoData, "writer", m, "class", `${cls}.json`), "utf8")) as { output: WriterOutput }).output;
const WORDING: Record<string, WriterOutput> = {
  "evac-prepare": recorded("17204", "heavy_rain-evac-prepare-3"),
  "evac-now": recorded("15205", "landslide-evac-now-4"),
  "all-clear": recorded("17204", "heavy_rain-all-clear-1"),
};
const alertBlocks: string[] = [];
const writerClient = {
  messages: {
    stream: (params: { messages: { content: { text: string }[] }[] }) => {
      const text = params.messages.flatMap((m) => m.content.map((c) => c.text)).join("\n");
      alertBlocks.push(params.messages[0]!.content.at(-1)!.text);
      const template = text.match(/テンプレート: ([a-z-]+)/)![1]!;
      return { finalMessage: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ cells: WORDING[template]!.cells }) }], usage: { input_tokens: 1, output_tokens: 1 } }) };
    },
  },
} as unknown as Anthropic;
const liveWriter = { kind: "live" as const, live: { client: writerClient, model: "opus" as const } };

function storedFiles(siteId: string, bulletinId: string) {
  const dir = path.join(LAYOUTS_DIR, siteId, bulletinId);
  return fs.readdirSync(dir).map((f) => ({ shape: f.slice(0, -5), body: fs.readFileSync(path.join(dir, f), "utf8") }));
}

test("the class list names what can be synthesized and why the rest cannot", () => {
  const wajima = classListing("17204");
  assert.deepEqual(wajima.filter((c) => c.supported).map((c) => c.cls), SIX);
  const held = wajima.filter((c) => !c.supported) as { cls: string; reason: string }[];
  assert.deepEqual(held.map((c) => c.cls).filter((c) => c.endsWith("/5")), ["heavy_rain/secure-now/5", "landslide/secure-now/5", "flood/secure-now/5"]);
  assert.ok(held.some((c) => c.cls.startsWith("tsunami/")), "輪島市 is on a tsunami forecast region");
  assert.ok(!classListing("15205").some((c) => c.cls.startsWith("tsunami/")), "柏崎市 has no region mapped");
  for (const c of held) assert.ok(c.reason.length > 10, c.cls);
});

function templatePlaces(): Set<string> {
  const places = new Set<string>();
  for (const f of fs.readdirSync(TEMPLATES_DIR).filter((n) => n.endsWith(".xml"))) {
    const xml = fs.readFileSync(path.join(TEMPLATES_DIR, f), "utf8");
    for (const m of xml.matchAll(/<Area>\s*<Name>([^<]+)<\/Name>/g)) places.add(m[1]!);
    for (const m of xml.matchAll(/<(?:EditorialOffice|PublishingOffice)>([^<]+)</g)) places.add(m[1]!);
    for (const m of xml.matchAll(/<Text[^>]*>([^<]+)</g)) places.add(m[1]!);
  }
  return places;
}

test("a synthetic bulletin parses as a real one and carries no place of its template", () => {
  const places = templatePlaces();
  assert.ok(places.has("松江市") && places.has("松江地方気象台") && places.has("島根県"));
  for (const plan of classListing("15205").filter((c) => c.supported)) {
    if (!plan.supported) continue;
    const xml = synthesizeXml(plan, { municipalityId: "15205", municipalityName: "柏崎市", prefecture: "新潟県" });
    const alert = parseJmaXml(xml);
    assert.equal(alert.status, "normal");
    assert.equal(alert.raw_title, `新潟県${plan.code === "VPWW55" ? "大雨" : "土砂災害"}警報・注意報`);
    assert.deepEqual(alert.areas.map((a) => [a.code, a.name, a.kind_name]), [["1520500", "柏崎市", plan.kind.name]]);
    const leaked = [...places].filter((p) => xml.includes(p));
    assert.deepEqual(leaked, [], plan.cls);
  }
});

const skip = needsRaw({ feed: ["bodies/20261031/20261031075327_0_VPWW56_150000.xml", "bodies/20261031/20261031190159_0_VPWW56_150000.xml", "bodies/20261021/20261021061124_0_VPWW55_170000.xml"] });

interface Approved { cls: string; digest: string; from: string }

async function generateAndApprove(s: SiteFile): Promise<Map<string, Approved>> {
  const g = await generateSite({ site: s, classes: SIX, verifier: checkedVerifier, writer: liveWriter });
  assert.deepEqual(g.classes.map((c) => [c.class, c.outcome, c.approvable]), SIX.map((c) => [c, "pass", true]));
  assert.deepEqual(JSON.parse(fs.readFileSync(generationFile(s.id), "utf8")).classes.map((c: { class: string }) => c.class), SIX);
  const approvals = fs.existsSync(APPROVALS_FILE) ? JSON.parse(fs.readFileSync(APPROVALS_FILE, "utf8")) : { version: "0.1", layouts: {}, sites: {}, classes: {} };
  const out = new Map<string, Approved>();
  for (const row of g.classes) {
    const files = storedFiles(s.id, row.bulletin_id!);
    const cls = screenClass(JSON.parse(files[0]!.body));
    assert.equal(cls, row.class);
    approvals.layouts[`${s.id}/${row.bulletin_id}`] = { approved: true, updated_at: "2026-11-11T00:00:00Z", digest: layoutDigest(files) };
    approvals.classes[`${s.id}/${cls}`] = { approved: true, updated_at: "2026-11-11T00:00:00Z", digest: classDigest(files), approved_from: row.bulletin_id };
    out.set(cls, { cls, digest: classDigest(files), from: row.bulletin_id! });
  }
  approvals.sites[s.id] = { auto_publish: true, updated_at: "2026-11-11T00:00:00Z" };
  fs.writeFileSync(APPROVALS_FILE, JSON.stringify(approvals));
  return out;
}

function rewriteKind(xml: string, cityCode: string, kind: { name: string; code: string; status: string; last?: { name: string; code: string } }, at: string): string {
  let n = 0;
  const out = xml.replace(new RegExp(`<Item>\\s*<Kind>(?:(?!</Item>)[\\s\\S])*?<Code>${cityCode}</Code>(?:(?!</Item>)[\\s\\S])*?</Item>`, "g"), (item) => {
    n++;
    const last = kind.last ? `<LastKind>\n<Name>${kind.last.name}</Name>\n<Code>${kind.last.code}</Code>\n</LastKind>\n` : "";
    return item.replace(/<Kind>[\s\S]*?<\/Kind>/, `<Kind>\n<Name>${kind.name}</Name>\n<Code>${kind.code}</Code>\n<Status>${kind.status}</Status>\n${last}</Kind>`);
  });
  assert.ok(n >= 1, `an Item for ${cityCode}`);
  return out.replace(/<ReportDateTime>[^<]*</, `<ReportDateTime>${at}<`).replace(/<TargetDateTime>[^<]*</, `<TargetDateTime>${at}<`);
}

function feedOf(bodies: { name: string; xml: string | Buffer; updated: string }[]): string {
  const feedDir = fs.mkdtempSync(path.join(os.tmpdir(), "evac-generation-feed-"));
  fs.mkdirSync(path.join(feedDir, "index"), { recursive: true });
  const lines = bodies.map(({ name, xml, updated }) => {
    fs.mkdirSync(path.join(feedDir, "bodies", name.slice(0, 8)), { recursive: true });
    fs.writeFileSync(path.join(feedDir, "bodies", name.slice(0, 8), name), xml);
    const url = `https://www.data.jma.go.jp/developer/xml/data/${name}`;
    return JSON.stringify({ id: url, title: "t", updated, author: "a", url, content: "", recorded_at: updated });
  });
  fs.writeFileSync(path.join(feedDir, "index", "extra_l.jsonl"), lines.join("\n") + "\n");
  return feedDir;
}

async function receiveAndGate(s: SiteFile, bodies: { name: string; xml: string | Buffer; updated: string }[], approved: Map<string, Approved>) {
  const feedDir = feedOf(bodies);
  const liveDir = fs.mkdtempSync(path.join(os.tmpdir(), "evac-generation-live-"));
  const round = await receiveSite({ site: s, verifier: checkedVerifier, writer: { kind: "placeholder" }, usage: [], initialSince: "2026-10-01T00:00:00Z", feedDir, liveDir });
  assert.deepEqual(round.errors, []);
  const approvals = JSON.parse(fs.readFileSync(APPROVALS_FILE, "utf8"));
  return round.bulletins.map(({ entry, outcome }) => {
    const dir = path.join(LAYOUTS_DIR, s.id, entry.bulletin_id);
    const cls = layoutClassOf(dir, path.join(REPORTS_DIR, s.id, entry.bulletin_id, "report.json"))!;
    const gate = approvalWith(approvals, s.id, entry.bulletin_id, layoutDigestOf(dir), cls);
    return { bulletin: entry.bulletin_id, outcome, cls: cls.key, checked: cls.checked, matches: approved.get(cls.key)?.digest === cls.digest, by: gate.by, live: round.live };
  });
}

test("a class approved from a synthetic bulletin opens the real bulletins of that class: landslide at 柏崎市", { skip }, async () => {
  const approved = await generateAndApprove(KASHIWAZAKI);
  const l4 = fs.readFileSync(path.join(FEED_DIR, "bodies/20261031/20261031075327_0_VPWW56_150000.xml"));
  const l3 = rewriteKind(l4.toString("utf8"), "1520500", { name: "レベル３土砂災害警報", code: "09", status: "発表" }, "2026-10-31T15:00:00+09:00");
  const clear = fs.readFileSync(path.join(FEED_DIR, "bodies/20261031/20261031190159_0_VPWW56_150000.xml"));
  const rows = await receiveAndGate(KASHIWAZAKI, [
    { name: "20261031060000_0_VPWW56_150000.xml", xml: l3, updated: "2026-10-31T06:00:00Z" },
    { name: "20261031075327_0_VPWW56_150000.xml", xml: l4, updated: "2026-10-31T07:53:27Z" },
    { name: "20261031190159_0_VPWW56_150000.xml", xml: clear, updated: "2026-10-31T19:01:59Z" },
  ], approved);
  assert.deepEqual(rows.map((r) => [r.cls, r.outcome, r.checked, r.matches, r.by]), [
    ["landslide/evac-prepare/3", "pass", true, true, "class"],
    ["landslide/evac-now/4", "pass", true, true, "class"],
    ["landslide/all-clear/1", "pass", true, true, "class"],
  ]);
  assert.equal(rows.at(-1)!.live, "VPWW56-202611010401-fc7d8fb812f9", "the real bulletin goes live; the synthetic one never does");
});

test("a class approved from a synthetic bulletin opens the real bulletins of that class: heavy rain at 輪島市", { skip }, async () => {
  const approved = await generateAndApprove(WAJIMA);
  const base = fs.readFileSync(path.join(FEED_DIR, "bodies/20261021/20261021061124_0_VPWW55_170000.xml"), "utf8");
  const rows = await receiveAndGate(WAJIMA, [
    { name: "20261021040000_0_VPWW55_170000.xml", xml: rewriteKind(base, "1720400", { name: "レベル３大雨警報", code: "03", status: "発表" }, "2026-10-21T13:00:00+09:00"), updated: "2026-10-21T04:00:00Z" },
    { name: "20261021050000_0_VPWW55_170000.xml", xml: rewriteKind(base, "1720400", { name: "レベル４大雨危険警報", code: "43", status: "継続", last: { name: "レベル３大雨警報", code: "03" } }, "2026-10-21T14:00:00+09:00"), updated: "2026-10-21T05:00:00Z" },
    { name: "20261021070000_0_VPWW55_170000.xml", xml: rewriteKind(base, "1720400", { name: "レベル２大雨注意報", code: "10", status: "解除", last: { name: "レベル２大雨注意報", code: "10" } }, "2026-10-21T16:00:00+09:00"), updated: "2026-10-21T07:00:00Z" },
  ], approved);
  assert.deepEqual(rows.map((r) => [r.cls, r.outcome, r.checked, r.matches, r.by]), [
    ["heavy_rain/evac-prepare/3", "pass", true, true, "class"],
    ["heavy_rain/evac-now/4", "pass", true, true, "class"],
    ["heavy_rain/all-clear/1", "pass", true, true, "class"],
  ]);
});

test("the Writer of a synthetic bulletin is told no place of the template, and no place at all in the bulletin block", { skip }, () => {
  assert.ok(alertBlocks.length >= 6);
  for (const text of alertBlocks) {
    assert.match(text, /"hazard"/);
    assert.doesNotMatch(text, /柏崎市|輪島市/, "the bulletin block carries the class, not the areas");
    for (const place of templatePlaces()) assert.ok(!text.includes(place), `the Writer was told "${place}"`);
  }
});

test("a moved screen does not match the approval of the class", { skip }, async () => {
  const approvals = JSON.parse(fs.readFileSync(APPROVALS_FILE, "utf8"));
  const from = approvals.classes[`${KASHIWAZAKI.id}/landslide/evac-now/4`];
  const moved: SiteFile = { ...KASHIWAZAKI, id: "15205-moved", lat: 37.3297, lng: 138.4977 };
  const roots = { layouts: fs.mkdtempSync(path.join(os.tmpdir(), "evac-moved-")), reports: fs.mkdtempSync(path.join(os.tmpdir(), "evac-moved-r-")) };
  const file = "bodies/20261031/20261031075327_0_VPWW56_150000.xml";
  const entry = replayEntry(fs.readFileSync(path.join(FEED_DIR, file)), file, "VPWW56", "15205");
  const { municipality, readerRan } = loadMunicipality("15205");
  const composed = await composeBulletin({ entry, municipality, readerRan, site: moved, verifier: checkedVerifier, writer: { kind: "placeholder" }, roots, persistWriter: false });
  assert.notEqual(composed.attempts![0]!.writer_source, "placeholder");
  const dir = path.join(roots.layouts, moved.id, entry.bulletin_id);
  const files = fs.readdirSync(dir).map((f) => ({ shape: f.slice(0, -5), body: fs.readFileSync(path.join(dir, f), "utf8") }));
  const original = storedFiles(KASHIWAZAKI.id, entry.bulletin_id);
  assert.notEqual(JSON.parse(files[0]!.body).cells.find((c: { role: string }) => c.role === "shelter").text.ja, JSON.parse(original[0]!.body).cells.find((c: { role: string }) => c.role === "shelter").text.ja, "the moved screen points at another shelter");
  const action = (body: string) => JSON.parse(body).cells.find((c: { role: string }) => c.role === "action").text;
  assert.deepEqual(action(files[0]!.body), action(storedFiles(KASHIWAZAKI.id, from.approved_from)[0]!.body), "the wording is the class's");
  assert.notEqual(classDigest(files), from.digest);
});

test("generating again composes the same synthetic bulletins, and a new id or issue time keeps the class digest", { skip }, async () => {
  const before = JSON.parse(fs.readFileSync(generationFile(KASHIWAZAKI.id), "utf8")).classes as { class: string; bulletin_id: string }[];
  const again = await generateSite({ site: KASHIWAZAKI, classes: ["landslide/evac-now/4"], verifier: checkedVerifier, writer: { kind: "placeholder" } });
  const row = again.classes[0]!;
  assert.equal(row.bulletin_id, before.find((c) => c.class === row.class)!.bulletin_id);
  assert.equal(row.writer_source, "writer-cache", "the wording written the first time is reused, without the Writer");
  assert.equal(row.approvable, true);
  const digest = classDigest(storedFiles(KASHIWAZAKI.id, row.bulletin_id!));
  const xml = fs.readFileSync(path.join(SYNTHETIC_DIR, "15205", `${row.bulletin_id}.xml`), "utf8").replaceAll("2024-11-02T08:00:00+09:00", "2025-06-01T03:00:00+09:00");
  const parsed = replayEntry(Buffer.from(xml), "synthetic/15205/retimed.xml", "VPWW56", "15205");
  const retimedId = `SYN-${parsed.bulletin_id}`;
  assert.notEqual(retimedId, row.bulletin_id);
  const { municipality, readerRan } = loadMunicipality("15205");
  await composeBulletin({ entry: { ...parsed, bulletin_id: retimedId, alert: { ...parsed.alert, bulletin_id: retimedId } }, municipality, readerRan, site: KASHIWAZAKI, verifier: checkedVerifier, writer: { kind: "placeholder" }, persistWriter: false });
  assert.equal(classDigest(storedFiles(KASHIWAZAKI.id, retimedId)), digest);
});

test("the wording of a class approved from a synthetic bulletin is found after a fan-out rewrote the site's index", { skip }, async () => {
  const { writerOfBulletin } = await import("../src/writer/class-cache.js");
  const from = JSON.parse(fs.readFileSync(APPROVALS_FILE, "utf8")).classes[`${KASHIWAZAKI.id}/landslide/evac-now/4`].approved_from as string;
  const indexFile = path.join(LAYOUTS_DIR, KASHIWAZAKI.id, "index.json");
  const index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
  fs.writeFileSync(indexFile, JSON.stringify({ ...index, entries: index.entries.filter((e: { synthetic?: boolean }) => !e.synthetic) }));
  const record = writerOfBulletin(KASHIWAZAKI.id, "15205", from);
  assert.equal(record?.bulletin_id, from);
  assert.ok(record?.match);
  fs.writeFileSync(indexFile, JSON.stringify(index));
});

test("a site takes its approved class wording over another site's record for a bulletin it has no screen for yet", { skip }, async () => {
  const other = (easy: string): WriterOutput => ({ cells: WORDING["evac-now"]!.cells.map((c) => (c.role === "headline" ? c : { ...c, text: { ...c.text, ja_easy: easy } })) });
  const clientFor = (output: WriterOutput) => ({ messages: { stream: () => ({ finalMessage: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ cells: output.cells }) }], usage: { input_tokens: 1, output_tokens: 1 } }) }) } }) as unknown as Anthropic;
  const siteA: SiteFile = { ...KASHIWAZAKI, id: "15205-site-a" };
  const siteB: SiteFile = { ...KASHIWAZAKI, id: "15205-site-b" };
  const real = "bodies/20261031/20261031093903_0_VPWW56_150000.xml";
  const body = { name: path.basename(real), xml: fs.readFileSync(path.join(FEED_DIR, real)), updated: "2026-10-31T09:39:03Z" };
  const feedDir = feedOf([body]);
  for (const f of fs.readdirSync(path.join(WRITER_DIR, "15205")).filter((n) => n.startsWith("SYN-") || n === path.basename(real))) fs.rmSync(path.join(WRITER_DIR, "15205", f));
  fs.rmSync(path.join(WRITER_DIR, "15205", "class"), { recursive: true, force: true });
  const roundA = await receiveSite({ site: siteA, verifier: checkedVerifier, writer: { kind: "live", live: { client: clientFor(other("いますぐ にげて")), model: "opus" } }, usage: [], initialSince: "2026-10-01T00:00:00Z", feedDir, liveDir: fs.mkdtempSync(path.join(os.tmpdir(), "evac-a-")) });
  assert.deepEqual(roundA.bulletins.map((b) => b.outcome), ["pass"]);
  assert.equal(cachedWriterRecord("15205", roundA.bulletins[0]!.entry.bulletin_id)!.output.cells[1]!.text.ja_easy, "いますぐ にげて");

  const g = await generateSite({ site: siteB, classes: ["landslide/evac-now/4"], verifier: checkedVerifier, writer: { kind: "live", live: { client: clientFor(other("すぐに にげて")), model: "opus" } } });
  const synthetic = g.classes[0]!.bulletin_id!;
  const files = storedFiles(siteB.id, synthetic);
  const approvals = JSON.parse(fs.readFileSync(APPROVALS_FILE, "utf8"));
  approvals.classes[`${siteB.id}/landslide/evac-now/4`] = { approved: true, updated_at: "2026-11-11T00:00:00Z", digest: classDigest(files), approved_from: synthetic };
  fs.writeFileSync(APPROVALS_FILE, JSON.stringify(approvals));

  const rows = await receiveAndGate(siteB, [body], new Map([["landslide/evac-now/4", { cls: "landslide/evac-now/4", digest: classDigest(files), from: synthetic }]]));
  assert.deepEqual(rows.map((r) => [r.cls, r.matches, r.by]), [["landslide/evac-now/4", true, "class"]]);
  assert.equal(cachedWriterRecord("15205", roundA.bulletins[0]!.entry.bulletin_id)!.output.cells[1]!.text.ja_easy, "いますぐ にげて", "site A's record of the bulletin is kept");
});
