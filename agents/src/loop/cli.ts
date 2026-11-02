import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { Municipality, Site, WriterOutput } from "../composer/compose.js";
import { parseJmaXml } from "../jma/parse.js";
import { MUNICIPALITIES_DIR, resolveUserPath } from "../paths.js";
import { MAX_ATTEMPTS, runLoop } from "./loop.js";
import { writeReport } from "./report.js";
import { fixtureReviser, liveWriterReviser } from "./revisers.js";
import { staticVerifier } from "./static-verifier.js";
import { browserVerifier } from "./browser-verifier.js";

const { values } = parseArgs({
  options: {
    alert: { type: "string" },
    municipality: { type: "string" },
    "municipality-file": { type: "string" },
    site: { type: "string" },
    writer: { type: "string" },
    revisions: { type: "string", multiple: true, default: [] },
    "max-attempts": { type: "string", default: String(MAX_ATTEMPTS) },
    verifier: { type: "string", default: "static" },
    "base-url": { type: "string", default: process.env.EVAC_URL ?? "http://127.0.0.1:3152" },
  },
});
if (!values.alert || !values.site || !(values.municipality || values["municipality-file"])) {
  console.error("usage: pnpm -F agents pipeline --alert <bulletin.xml> --municipality <id> --site <site.json> --writer <writer.json> [--revisions <writer.json>...] [--municipality-file <file>]");
  process.exit(2);
}
const read = <T>(p: string): T => JSON.parse(fs.readFileSync(resolveUserPath(p), "utf8")) as T;
const municipalityFile = values["municipality-file"] ? resolveUserPath(values["municipality-file"]) : path.join(MUNICIPALITIES_DIR, `${values.municipality}.json`);
if (!fs.existsSync(municipalityFile)) {
  console.error(`[pipeline stopped] ${municipalityFile} not found; run the Reader for this municipality first`);
  process.exit(3);
}
if (!values.writer) {
  console.error("[pipeline stopped] the live Writer lands on Day 2; pass --writer <writer.json> (and --revisions) to run the loop on fixtures");
  process.exit(3);
}

const alert = parseJmaXml(fs.readFileSync(resolveUserPath(values.alert)));
const municipality = JSON.parse(fs.readFileSync(municipalityFile, "utf8")) as Municipality;
const reviser = values.revisions!.length ? fixtureReviser(values.revisions!.map(resolveUserPath)) : liveWriterReviser;
const maxAttempts = Number(values["max-attempts"]);
if (values.verifier !== "static" && values.verifier !== "browser") {
  console.error("--verifier must be static or browser");
  process.exit(2);
}
const browser = values.verifier === "browser" ? browserVerifier({ baseUrl: values["base-url"]! }) : undefined;
const verifier = browser ?? staticVerifier;
const result = await runLoop({
  alert, municipality, site: read<Site>(values.site), writer: read<WriterOutput>(values.writer), writerSource: `fixture:${path.basename(values.writer)}`,
  verifier, reviser, maxAttempts,
}).finally(() => browser?.close());
const { dir, report } = writeReport({ municipalityId: municipality.id, bulletinId: alert.bulletin_id, verifier: verifier.name, reviser: reviser.name, maxAttempts, result });
for (const a of report.attempts) console.log(`attempt ${a.n} (${a.writer_source}): ${a.findings.length ? a.findings.map((f) => `${f.shape} ${f.check}${f.cell_id ? `[${f.cell_id}]` : ""}`).join(", ") : "no findings"}`);
console.log(`${report.outcome}${report.reason ? ` — ${report.reason}` : ""}\n${path.relative(process.cwd(), dir)}/report.json`);
process.exitCode = report.outcome === "pass" ? 0 : 1;
