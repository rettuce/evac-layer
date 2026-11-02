import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { Site } from "../composer/compose.js";
import { ComposerStop, situationFor } from "../composer/rules.js";
import type { ReplayEntry } from "../jma/replay.js";
import { REPO_ROOT, resolveUserPath } from "../paths.js";
import { placeholderWriter } from "../writer/placeholder.js";
import { runLoop } from "./loop.js";
import { loadMunicipality } from "./municipality.js";
import { LAYOUTS_DIR, writeReport } from "./report.js";
import { liveWriterReviser } from "./revisers.js";
import { staticVerifier } from "./static-verifier.js";
import { browserVerifier } from "./browser-verifier.js";

const PLACEHOLDER_NOTE = "文言は仮: Writer は API キー未設定のため未実行。見出しは気象庁の警報名をそのまま使い、それ以外は【仮】/[draft] のプレースホルダ。";

const { values } = parseArgs({ options: { replay: { type: "string" }, site: { type: "string" }, verifier: { type: "string", default: "static" }, "base-url": { type: "string", default: process.env.EVAC_URL ?? "http://127.0.0.1:3152" } } });
if (!values.replay || !values.site) {
  console.error("usage: pnpm -F agents replay-pipeline --replay <replay.json> --site <site.json>");
  process.exit(2);
}
const replay = JSON.parse(fs.readFileSync(resolveUserPath(values.replay), "utf8")) as { municipality: string; entries: ReplayEntry[] };
const site = JSON.parse(fs.readFileSync(resolveUserPath(values.site), "utf8")) as Site;
const { municipality, readerRan } = loadMunicipality(replay.municipality);
const browser = values.verifier === "browser" ? browserVerifier({ baseUrl: values["base-url"]! }) : undefined;
const verifier = browser ?? staticVerifier;
const notes = [PLACEHOLDER_NOTE, ...(readerRan ? [] : ["自治体 PDF 由来の情報なし: Reader 未実行のため避難所（国土地理院）と警報だけで構成。"])].join(" ");

const index = [];
for (const e of replay.entries) {
  const row = { issued_at: e.issued_at, bulletin_id: e.bulletin_id, wmo_code: e.wmo_code, raw_title: e.alert.raw_title, municipality_level: e.municipality_level };
  let situation;
  try {
    situation = situationFor(e.alert, municipality.id);
  } catch (err) {
    if (!(err instanceof ComposerStop)) throw err;
    index.push({ ...row, screen: false, reason: err.message });
    console.log(`${e.issued_at}  no screen  ${err.message}`);
    continue;
  }
  const result = await runLoop({
    alert: e.alert, municipality, site,
    writer: placeholderWriter(e.alert, municipality.id, situation.level, situation.cleared), writerSource: "placeholder",
    verifier, reviser: liveWriterReviser,
  });
  const { dir, report } = writeReport({ municipalityId: municipality.id, bulletinId: e.bulletin_id, verifier: verifier.name, reviser: liveWriterReviser.name, maxAttempts: 3, result, writerNote: notes });
  index.push({ ...row, screen: report.outcome === "pass", template: situation.template, display_level: situation.level, outcome: report.outcome, layouts: report.layouts, report: path.relative(REPO_ROOT, path.join(dir, "report.json")) });
  console.log(`${e.issued_at}  ${situation.template.padEnd(12)} L${situation.level}  ${report.outcome}${report.reason ? ` — ${report.reason}` : ""}`);
}
await browser?.close();
const indexFile = path.join(LAYOUTS_DIR, municipality.id, "index.json");
fs.mkdirSync(path.dirname(indexFile), { recursive: true });
fs.writeFileSync(indexFile, JSON.stringify({ municipality: municipality.id, name: municipality.name, site: site.id, writer_note: notes, entries: index }, null, 2) + "\n");
console.log(path.relative(process.cwd(), indexFile));
