import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { classDigest } from "../../app/layout/gate";
import { DRILL_PREFIX_JA as SHARED_DRILL_PREFIX, headlineFromTables, headlineTableVersion } from "../../app/layout/headlineTable";
import { parseJmaXml } from "../src/jma/parse.js";
import { tsunamiRegionsFor } from "../src/jma/regions.js";
import { SAMPLES_DIR } from "../src/paths.js";
import { needsRaw } from "./raw.js";
import { compose, type Municipality, type Site, type WriterOutput } from "../src/composer/compose.js";
import { CANCEL_FORM, DRILL_WORD, headlineTables, headlineText, TABLE_LANGS, warningKey } from "../src/composer/headline.js";
const warningNames = () => headlineTables().names;
const jaEasyNames = () => headlineTables().easy;
import { ComposerStop, DRILL_PREFIX_JA, situationFor } from "../src/composer/rules.js";
import type { Alert } from "../src/jma/parse.js";
import { runLoop } from "../src/loop/loop.js";
import { liveWriterReviser } from "../src/loop/revisers.js";
import { staticVerifier } from "../src/loop/static-verifier.js";
import { LAYOUTS_DIR, REPO_ROOT } from "../src/paths.js";
import type { Verifier } from "../src/loop/types.js";
import type { LayoutCell } from "../../app/layout/types";
import { judgeDrill, judgeHeadline } from "../src/verifier/checks.js";
import { writeCells } from "../src/writer/live.js";
import { placeholderWriter } from "../src/writer/placeholder.js";
import { WRITER_OUTPUT_SCHEMA, writerSystem } from "../src/writer/request.js";
import { lintEasyJapanese, lintJaEasyScript } from "../src/writer/rules.js";

const wajima = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/municipalities/17204.json"), "utf8")) as Municipality;
const site = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/sites/17204-demo.json"), "utf8")) as Site;

function heavyRain(kind: string, kindCode: string, status: "issued" | "cleared", level: number | null, drill = false): Alert {
  return {
    bulletin_id: `VPWW55-202611111000-${kindCode.padStart(12, "0")}`, code: "VPWW55", hazard: "heavy_rain", level, info_type: "issued", issued_at: "2026-11-11T10:00:00+09:00",
    raw_title: "石川県大雨警報・注意報", headline_text: "", publishing_office: "気象庁", status: drill ? "drill" : "normal",
    areas: [{ code: "1720400", name: "輪島市", code_type: "city", level, kind_code: kindCode, kind_name: kind, status }],
  };
}

const wording = (): WriterOutput => ({ cells: [
  { role: "headline", text: { ja: "x", en: "Heavy rain (Writer)" }, basis: "an old record" },
  ...placeholderWriter(3, false).cells,
] });

test("the table carries its source, and every name has all eight languages, a dictionary No. and a ja_easy paraphrase marked unreviewed", () => {
  const table = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/jma/warning-names.json"), "utf8"));
  assert.equal(table.source.page, "https://www.data.jma.go.jp/developer/multilingual.html");
  assert.match(table.source.credit, /気象庁「多言語辞書」を加工して作成/);
  assert.match(table.source.updated, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(table.source.retrieved, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(warningNames().cancel.no, 20);
  const easy = jaEasyNames();
  assert.equal(easy.reviewed, false);
  assert.deepEqual(easy.names.map((n) => warningKey(n.ja)).sort(), warningNames().names.map((n) => warningKey(n.ja)).sort());
  for (const row of warningNames().names) {
    assert.ok(Number.isInteger(row.no), row.ja);
    for (const lang of TABLE_LANGS) assert.ok(row.text[lang] && row.text[lang] === row.text[lang].trim(), `${row.ja} ${lang}`);
  }
});

test("the ja_easy paraphrases keep the easy-Japanese rules the Writer is held to", () => {
  const { names, cancel } = jaEasyNames();
  for (const text of [...names.map((n) => n.ja_easy), cancel]) {
    assert.deepEqual([...lintEasyJapanese(text), ...lintJaEasyScript(text)], [], text);
  }
});

test("every headline on a stored screen names a warning the table holds", () => {
  const headlines = new Set<string>();
  for (const siteId of fs.readdirSync(LAYOUTS_DIR)) {
    for (const bulletin of fs.readdirSync(path.join(LAYOUTS_DIR, siteId)).filter((d) => !d.endsWith(".json"))) {
      for (const f of fs.readdirSync(path.join(LAYOUTS_DIR, siteId, bulletin))) {
        const layout = JSON.parse(fs.readFileSync(path.join(LAYOUTS_DIR, siteId, bulletin, f), "utf8")) as { cells: { role: string; text: { ja: string } }[] };
        headlines.add(layout.cells.find((c) => c.role === "headline")!.text.ja);
      }
    }
  }
  const known = new Set(warningNames().names.map((n) => warningKey(n.ja)));
  for (const h of headlines) assert.ok(known.has(warningKey(h.replace(DRILL_PREFIX_JA, "").replace(/解除$/, ""))), h);
  assert.ok(headlines.size >= 10);
});

test("a name spelt with half-width digits or spaces is the same name", () => {
  assert.equal(warningKey("レベル 3 大雨警報"), warningKey("レベル３大雨警報"));
  assert.deepEqual(headlineText(heavyRain("レベル 3 大雨警報", "03", "issued", 3), "17204").en, "Level 3 Warning (Heavy Rain)");
});

test("an all-clear joins the warning's entry and the entry for 解除 in each language's one form", () => {
  const text = headlineText(heavyRain("レベル２大雨注意報", "10", "cleared", null), "17204");
  assert.equal(text.ja, "レベル２大雨注意報解除");
  assert.equal(text.ja_easy, "おおあめ ちゅういほう おわり");
  assert.equal(text.en, "Level 2 Advisory (Heavy Rain): Cancel");
  assert.equal(text.zh_hans, "等级2 大雨注意报解除");
  assert.equal(text.ko, "레벨 2 호우 주의보 해제");
  assert.equal(text.th, "ยกเลิกประกาศเฝ้าระวังฝนตกหนักระดับ 2");
  const row = warningNames().names.find((n) => n.ja === "レベル２大雨注意報")!;
  for (const lang of TABLE_LANGS) assert.equal(text[lang], CANCEL_FORM[lang](row.text[lang], warningNames().cancel.text[lang]), lang);
});

test("a drill headline opens every language with the drill word, and the Verifier's drill check passes it", () => {
  assert.equal(SHARED_DRILL_PREFIX, DRILL_PREFIX_JA, "the headline table module keeps the gate's drill prefix");
  const text = headlineText(heavyRain("レベル３大雨警報", "03", "issued", 3, true), "17204");
  assert.equal(text.ja, "【訓練】レベル３大雨警報");
  for (const [lang, word] of Object.entries(DRILL_WORD)) assert.ok(text[lang as keyof typeof text].startsWith(word), lang);
  assert.deepEqual(judgeDrill([{ id: "headline", role: "headline", text }], "drill"), []);
});

test("the headline comes from the table whatever the Writer output says, and the placeholder Writer writes none", () => {
  const alert = heavyRain("レベル３大雨警報", "03", "issued", 3);
  for (const screen of compose({ alert, municipality: wajima, site, writer: wording() })) {
    assert.deepEqual(screen.cells.find((c) => c.role === "headline")!.text, headlineText(alert, "17204"), screen.shape);
  }
  assert.deepEqual(placeholderWriter(3, false).cells.map((c) => c.role), ["action", "languages"]);
});

test("a warning name the table does not hold stops the Composer with the reason", async () => {
  const old = heavyRain("大雨警報", "03", "issued", 3);
  assert.throws(() => compose({ alert: old, municipality: wajima, site, writer: wording() }), (e: unknown) => e instanceof ComposerStop && /大雨警報.*not in the JMA multilingual dictionary table/.test((e as Error).message));
  const r = await runLoop({ alert: old, municipality: wajima, site, writer: wording(), writerSource: "test", verifier: staticVerifier, reviser: liveWriterReviser });
  assert.equal(r.outcome, "stopped");
});

test("the Verifier stops a fresh screen whose headline is not the table's, and leaves a stored screen alone", async () => {
  const alert = heavyRain("レベル３大雨警報", "03", "issued", 3);
  const good = compose({ alert, municipality: wajima, site, writer: wording() });
  const bad = good.map((s) => ({ ...s, cells: s.cells.map((c) => (c.role === "headline" ? { ...c, text: { ...c.text, en: "Heavy Rain Warning" } } : c)) }));
  const findings = (await staticVerifier.verify(bad, { alert, municipalityId: "17204" }))[0]!.findings;
  assert.deepEqual(findings.map((f) => [f.check, f.lang]), [["headline-table", "en"]]);
  assert.deepEqual((await staticVerifier.verify(bad))[0]!.findings, [], "without the bulletin (a stored screen checked again) there is nothing to hold it to");
  assert.deepEqual(judgeHeadline(good[0]!.cells, headlineText(alert, "17204")), []);
  const extra = good[0]!.cells.map((c) => (c.role === "headline" ? { ...c, text: { ...c.text, es: "Alerta" } } : c));
  assert.deepEqual(judgeHeadline(extra, headlineText(alert, "17204")).map((f) => f.lang), ["es"], "a language the table does not give");
  const stub: Verifier = { name: "stub", rendersScreens: false, verify: (screens, ctx) => staticVerifier.verify(screens.map((s) => ({ ...s, cells: (s.cells as LayoutCell[]).map((c) => (c.role === "headline" ? { ...c, text: { ja: c.text.ja } } : c)) })), ctx) };
  const r = await runLoop({ alert, municipality: wajima, site, writer: wording(), writerSource: "test", verifier: stub, reviser: liveWriterReviser });
  assert.equal(r.outcome, "fail");
  assert.match(r.reason!, /not fixable by rewriting text: .*headline-table\[headline/);
});

test("the live Writer is not asked for a headline, and a headline it returns anyway is dropped", async () => {
  assert.ok(!JSON.stringify(WRITER_OUTPUT_SCHEMA).includes("headline"));
  assert.match(writerSystem(), /見出し（headline）は書きません/);
  let asked = "";
  const reply = { cells: wording().cells };
  const client = { messages: { stream: (req: { messages: { content: { text: string }[] }[] }) => {
    asked = req.messages[0]!.content.map((c) => c.text).join("\n");
    return { finalMessage: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(reply) }], usage: { input_tokens: 1, output_tokens: 1 } }) };
  } } } as unknown as Anthropic;
  const alert = heavyRain("レベル３大雨警報", "03", "issued", 3);
  const r = await writeCells({ client, model: "opus", alert, municipality: wajima, municipalityId: "17204", situation: situationFor(alert, "17204") });
  assert.deepEqual(r.output.cells.map((c) => c.role), ["action", "languages"]);
  assert.match(asked, /書くセルは action・languages だけ/);
  assert.ok(!asked.includes('"role": "headline"'), "no headline budget is sent");
});

test("the class digest leaves every headline language out: an advisory's and a warning's all-clear with the same wording share one class approval", () => {
  const writer = wording();
  const files = (alert: Alert) => compose({ alert, municipality: wajima, site, writer }).map((s) => ({ shape: s.shape, body: JSON.stringify(s, null, 2) + "\n" }));
  const advisory = files(heavyRain("レベル２大雨注意報", "10", "cleared", null));
  const warning = files(heavyRain("レベル３大雨警報", "03", "cleared", null));
  assert.notEqual(advisory[0]!.body, warning[0]!.body);
  assert.equal(classDigest(advisory), classDigest(warning));
  const otherAction = compose({ alert: heavyRain("レベル３大雨警報", "03", "cleared", null), municipality: wajima, site, writer: { cells: writer.cells.map((c) => (c.role === "action" ? { ...c, text: { ...c.text, en: "[draft] Other" } } : c)) } })
    .map((s) => ({ shape: s.shape, body: JSON.stringify(s) }));
  assert.notEqual(classDigest(otherAction), classDigest(warning), "the action wording still binds the class approval");
});

const TSUNAMI_NAMES = ["大津波警報", "津波警報", "津波注意報"];
const VERSION_WITH_NO20_ONLY = "sha256:b676ea0da23952ece14255a3095371d99c4869fec2ca94ff8faef543f0f86d25";

test("the table holds the dictionary's tsunami entry for 解除 (No.923, en Lifted) beside the general one (No.20)", () => {
  const { cancel, tsunami_cancel } = warningNames();
  assert.deepEqual([cancel.no, cancel.ja, cancel.text.en], [20, "解除", "Cancel"]);
  assert.deepEqual([tsunami_cancel.no, tsunami_cancel.ja, tsunami_cancel.text.en], [923, "解除", "Lifted"]);
  for (const lang of TABLE_LANGS) assert.ok(tsunami_cancel.text[lang] && tsunami_cancel.text[lang] === tsunami_cancel.text[lang].trim(), lang);
  assert.deepEqual([...tsunami_cancel.applies_to].sort(), [...TSUNAMI_NAMES].sort());
});

test("a tsunami warning's all-clear joins its entry and No.923 in every language; every other all-clear keeps No.20", () => {
  const tables = headlineTables();
  const clearedText = (name: string) => {
    const found = headlineFromTables({ ja: `${name}解除`, name, cleared: true, drill: false }, tables);
    assert.ok("text" in found, name);
    return found.text;
  };
  for (const name of TSUNAMI_NAMES) {
    const row = tables.names.names.find((n) => n.ja === name)!;
    const text = clearedText(name);
    assert.equal(text.ja, `${name}解除`);
    for (const lang of TABLE_LANGS) assert.equal(text[lang], CANCEL_FORM[lang](row.text[lang].replace(/[.。]$/, ""), tables.names.tsunami_cancel.text[lang]), `${name} ${lang}`);
  }
  assert.equal(clearedText("津波注意報").en, "Tsunami Advisory: Lifted");
  assert.equal(clearedText("大津波警報").en, "Major Tsunami Warning: Lifted");
  assert.equal(clearedText("津波注意報").ja_easy, "つなみ ちゅういほう おわり", "the ja_easy word for 解除 stays");
  for (const row of tables.names.names.filter((n) => !TSUNAMI_NAMES.includes(n.ja))) {
    const text = clearedText(row.ja);
    for (const lang of TABLE_LANGS) assert.equal(text[lang], CANCEL_FORM[lang](row.text[lang].replace(/[.。]$/, ""), tables.names.cancel.text[lang]), `${row.ja} ${lang}`);
  }
  assert.equal(clearedText("レベル２土砂災害注意報").en, "Level 2 Advisory (Landslide): Cancel");
});

test("the tsunami all-clears of the official sample get No.923, and their Japanese headlines are as before", { skip: needsRaw({ samples: ["32-39_12_13_250206_VTSE41.xml"] }) }, () => {
  const sample = parseJmaXml(fs.readFileSync(path.join(SAMPLES_DIR, "32-39_12_13_250206_VTSE41.xml")));
  const region = tsunamiRegionsFor("22424")[0]!;
  const advisoryCleared = sample.areas.find((a) => a.kind_code === "60")!;
  const warningCleared = sample.areas.find((a) => a.kind_code === "50" && a.last_kind_name === "津波警報")!;
  const downgraded = sample.areas.find((a) => a.code === region)!;
  const cases: [typeof advisoryCleared, string, string][] = [
    [advisoryCleared, "【訓練】津波注意報解除", "DRILL: Tsunami Advisory: Lifted"],
    [warningCleared, "【訓練】警報解除", "DRILL: Tsunami Warning: Lifted"],
    [downgraded, "【訓練】大津波警報解除", "DRILL: Major Tsunami Warning: Lifted"],
  ];
  for (const [area, ja, en] of cases) {
    const text = headlineText({ ...sample, areas: [{ ...area, code: region }] }, "22424");
    assert.deepEqual([text.ja, text.en], [ja, en]);
  }
});

test("the table version changes with the tsunami entry for 解除", () => {
  const tables = headlineTables();
  assert.notEqual(headlineTableVersion(tables), VERSION_WITH_NO20_ONLY, "a check made against the table without No.923 no longer counts");
  const otherWord = { ...tables, names: { ...tables.names, tsunami_cancel: { ...tables.names.tsunami_cancel, text: { ...tables.names.tsunami_cancel.text, en: "Cancel" } } } };
  assert.notEqual(headlineTableVersion(otherWord), headlineTableVersion(tables));
  const otherNames = { ...tables, names: { ...tables.names, tsunami_cancel: { ...tables.names.tsunami_cancel, applies_to: ["津波警報"] } } };
  assert.notEqual(headlineTableVersion(otherNames), headlineTableVersion(tables));
});
