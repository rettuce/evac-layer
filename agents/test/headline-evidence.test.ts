import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoData = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "evac-headline-evidence-"));
for (const dir of ["jma", "municipalities", "sites"]) fs.cpSync(path.join(repoData, dir), path.join(dataDir, dir), { recursive: true });
process.env.EVAC_DATA_DIR = dataDir;
const easyFile = path.join(dataDir, "jma", "warning-names-ja-easy.json");
const namesFile = path.join(dataDir, "jma", "warning-names.json");
const setReviewed = (reviewed: boolean) => fs.writeFileSync(easyFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(easyFile, "utf8")), reviewed }));

const { SAMPLES_DIR } = await import("../src/paths.js");
const { compose } = await import("../src/composer/compose.js");
const { headlineTables, headlineText } = await import("../src/composer/headline.js");
const { ComposerStop, situationFor } = await import("../src/composer/rules.js");
const { parseJmaXml } = await import("../src/jma/parse.js");
const { tsunamiRegionsFor } = await import("../src/jma/regions.js");
const { runLoop } = await import("../src/loop/loop.js");
const { writeReport } = await import("../src/loop/report.js");
const { liveWriterReviser } = await import("../src/loop/revisers.js");
const { staticVerifier } = await import("../src/loop/static-verifier.js");
const { browserVerifier } = await import("../src/loop/browser-verifier.js");
const { generateSite } = await import("../src/loop/generation.js");
const { layoutClassOf } = await import("../src/delivery/gate.js");
const { placeholderWriter } = await import("../src/writer/placeholder.js");
const { validateDoc, formatErrors } = await import("../src/schemas.js");
const { alertFeed } = await import("../../app/layout/feed");
const { headlineTableVersion } = await import("../../app/layout/headlineTable");
const { needsRaw } = await import("./raw.js");
import type { Municipality, Site } from "../src/composer/compose.js";
import type { Alert } from "../src/jma/parse.js";
import type { Verifier } from "../src/loop/types.js";

const wajima = JSON.parse(fs.readFileSync(path.join(dataDir, "municipalities/17204.json"), "utf8")) as Municipality;
const yoshida = JSON.parse(fs.readFileSync(path.join(dataDir, "municipalities/22424.json"), "utf8")) as Municipality;
const site = (id: string) => JSON.parse(fs.readFileSync(path.join(dataDir, "sites", `${id}.json`), "utf8")) as Site;

function heavyRain(kind: string, kindCode: string, status: "issued" | "cleared", level: number | null): Alert {
  return {
    bulletin_id: `VPWW55-202611111000-${kindCode.padStart(12, "0")}`, code: "VPWW55", hazard: "heavy_rain", level, info_type: "issued", issued_at: "2026-11-11T10:00:00+09:00",
    raw_title: "石川県大雨警報・注意報", headline_text: "", publishing_office: "気象庁", status: "normal",
    areas: [{ code: "1720400", name: "輪島市", code_type: "city", level, kind_code: kindCode, kind_name: kind, status }],
  };
}

async function composedReport(verifier: Verifier, bulletin = heavyRain("レベル３大雨警報", "03", "issued", 3)) {
  const roots = { layouts: fs.mkdtempSync(path.join(os.tmpdir(), "evac-he-l-")), reports: fs.mkdtempSync(path.join(os.tmpdir(), "evac-he-r-")) };
  const result = await runLoop({ alert: bulletin, municipality: wajima, site: site("17204-demo"), writer: placeholderWriter(3, false), writerSource: "placeholder", verifier, reviser: liveWriterReviser });
  assert.equal(result.outcome, "pass", result.reason);
  const { dir, report } = writeReport({ siteId: "17204-demo", municipalityId: "17204", bulletinId: bulletin.bulletin_id, verifier: verifier.name, reviser: "none", maxAttempts: 3, result, roots });
  return { report: report as Record<string, any>, reportFile: path.join(dir, "report.json"), layoutDir: path.join(roots.layouts, "17204-demo", bulletin.bulletin_id) };
}

const browserChecked = (inner: Verifier): Verifier => ({ ...inner, name: "static+browser(test)", rendersScreens: true, verify: (screens, ctx) => inner.verify(screens, ctx) });

test("a pass of the loop with the bulletin records the headline-table check against the layout digest and the table version", async () => {
  const { report } = await composedReport(staticVerifier);
  assert.deepEqual(report.headline_table, { ok: true, table_version: headlineTableVersion(headlineTables()), layout_digest: report.layout_digest, shapes: ["16x9", "9x16", "32x9", "1x1", "pillar"] });
});

test("the agents gate holds a class to the headline evidence: report, stored headline, table version and the reviewed ja_easy table", async () => {
  setReviewed(true);
  const { reportFile, layoutDir } = await composedReport(browserChecked(staticVerifier));
  assert.equal(layoutClassOf(layoutDir, reportFile)!.headline, true);

  const noContext: Verifier = browserChecked({ ...staticVerifier, verify: (screens) => staticVerifier.verify(screens) });
  const blind = await composedReport(noContext);
  assert.equal(blind.report.headline_table, undefined, "a check without the bulletin is no evidence");
  assert.equal(layoutClassOf(blind.layoutDir, blind.reportFile)!.headline, false);

  const kept = fs.readFileSync(namesFile, "utf8");
  const changed = JSON.parse(kept);
  changed.names.find((n: { ja: string }) => n.ja === "レベル３大雨警報").text.en = "Level 3 Warning (Rain)";
  fs.writeFileSync(namesFile, JSON.stringify(changed));
  assert.equal(layoutClassOf(layoutDir, reportFile)!.headline, false, "a table changed by one word voids the earlier evidence");
  fs.writeFileSync(namesFile, kept);
  assert.equal(layoutClassOf(layoutDir, reportFile)!.headline, true);

  setReviewed(false);
  assert.equal(layoutClassOf(layoutDir, reportFile)!.headline, false, "not while the ja_easy table is unreviewed");
  setReviewed(true);

  const file = path.join(layoutDir, "16x9.json");
  const layout = JSON.parse(fs.readFileSync(file, "utf8"));
  layout.cells.find((c: { role: string }) => c.role === "headline").text.en = "Lv3 Heavy Rain Warning";
  fs.writeFileSync(file, JSON.stringify(layout, null, 2) + "\n");
  const forged = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  const digest = layoutClassOf(layoutDir, reportFile)!;
  const { layoutDigestOf } = await import("../src/delivery/gate.js");
  const now = layoutDigestOf(layoutDir)!;
  fs.writeFileSync(reportFile, JSON.stringify({ ...forged, layout_digest: now, headline_table: { ...forged.headline_table, layout_digest: now } }));
  assert.equal(digest.headline, false);
  assert.equal(layoutClassOf(layoutDir, reportFile)!.headline, false, "a report that claims the check does not outweigh a stored Writer headline");
});

test("a tsunami warning or major warning cleared outright (code 50, 警報解除) takes its translations from LastKind", { skip: needsRaw({ samples: ["32-39_12_13_250206_VTSE41.xml"] }) }, () => {
  const sample = parseJmaXml(fs.readFileSync(path.join(SAMPLES_DIR, "32-39_12_13_250206_VTSE41.xml")));
  const region = tsunamiRegionsFor("22424")[0]!;
  for (const [last, en, fil] of [["津波警報", "Tsunami Warning: Lifted", "Babala ng tsunami: Kanselahin"], ["大津波警報", "Major Tsunami Warning: Lifted", "Babala ng malaking tsunami: Kanselahin"]] as const) {
    const area = sample.areas.find((a) => a.kind_code === "50" && a.last_kind_name === last);
    assert.ok(area, `the sample clears a ${last} with code 50`);
    const alert = { ...sample, areas: [{ ...area!, code: region }] };
    assert.equal(situationFor(alert, "22424").template, "all-clear");
    const screens = compose({ alert, municipality: yoshida, site: site("22424-demo"), writer: placeholderWriter(1, true) });
    const text = screens[0]!.cells.find((c) => c.role === "headline")!.text;
    assert.equal(text.ja, "【訓練】警報解除", "the Japanese headline is the one composed before");
    assert.equal(text.en, `DRILL: ${en}`);
    assert.equal(text.fil, `Pagsasanay: ${fil}`, "the sentence-final period of the dictionary entry is dropped only when joined");
    const noLast = { ...sample, areas: [{ ...area!, code: region, last_kind_name: undefined }] };
    assert.throws(() => headlineText(noLast, "22424"), (e: unknown) => e instanceof ComposerStop);
  }
  const fil = headlineTables().names.names.find((n) => n.ja === "津波警報")!.text.fil;
  assert.match(fil, /\.$/, "the table keeps the dictionary's own spelling");
});

test("a screen made from the table carries the dictionary as a source, which the layout and feed schemas accept", () => {
  const screens = compose({ alert: heavyRain("レベル３大雨警報", "03", "issued", 3), municipality: wajima, site: site("17204-demo"), writer: placeholderWriter(3, false) });
  for (const s of screens) {
    const dictionary = s.sources.filter((x) => x.type === "jma-dictionary");
    assert.equal(dictionary.length, 1, s.shape);
    assert.match(JSON.stringify(dictionary[0]), /https:\/\/www\.data\.jma\.go\.jp\/developer\/multilingual\.html/);
    assert.match(JSON.stringify(dictionary[0]), /加工して作成/);
    const v = validateDoc(s, "layout");
    assert.ok(v.ok, formatErrors(v.errors));
  }
  const feed = alertFeed({ id: "17204-demo", municipality_id: "17204" }, Object.fromEntries(screens.map((s) => [s.shape, s])) as never, {}, "2026-11-11T00:00:00Z");
  const v = validateDoc(feed, "feed");
  assert.ok(v.ok, formatErrors(v.errors));
  assert.ok(feed.sources.some((x: { type: string }) => x.type === "jma-dictionary"));
});

test("a shape left out of the browser still gets the content checks with the bulletin, headline-table included", async () => {
  const alert = heavyRain("レベル３大雨警報", "03", "issued", 3);
  const screens = compose({ alert, municipality: wajima, site: site("17204-demo"), writer: placeholderWriter(3, false) })
    .map((s) => ({ ...s, cells: s.cells.map((c) => (c.role === "headline" ? { ...c, text: { ...c.text, en: "Heavy rain" } } : c)) }));
  const verifier = browserVerifier({ baseUrl: "http://127.0.0.1:9", chrome: "/nonexistent", skipShapes: ["16x9", "9x16", "32x9", "1x1", "pillar"] });
  const verdicts = await verifier.verify(screens, { alert, municipalityId: "17204" });
  await verifier.close();
  for (const v of verdicts) assert.deepEqual(v.findings.map((f) => [f.check, f.lang]), [["headline-table", "en"]], v.shape);
});

test("generate says when class approvals cannot open screens yet because the ja_easy table is unreviewed", async () => {
  const roots = { layouts: fs.mkdtempSync(path.join(os.tmpdir(), "evac-he-gl-")), reports: fs.mkdtempSync(path.join(os.tmpdir(), "evac-he-gr-")) };
  const run = () => generateSite({ site: site("17204-demo"), classes: ["heavy_rain/evac-prepare/3"], verifier: staticVerifier, writer: { kind: "placeholder" }, roots });
  setReviewed(false);
  assert.ok((await run()).classes[0]!.reasons.some((r) => /warning-names-ja-easy\.json.*not reviewed/.test(r)));
  setReviewed(true);
  assert.ok(!(await run()).classes[0]!.reasons.some((r) => /not reviewed/.test(r)));
});
