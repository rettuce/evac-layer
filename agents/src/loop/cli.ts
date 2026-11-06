import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { Municipality, Site, WriterOutput } from "../composer/compose.js";
import { parseJmaXml } from "../jma/parse.js";
import { EVAC_URL, TMP_DIR, resolveUserPath } from "../paths.js";
import { loadMunicipality } from "./municipality.js";
import { MAX_ATTEMPTS, runLoop } from "./loop.js";
import { writeReport } from "./report.js";
import { fixtureReviser, liveWriterReviser } from "./revisers.js";
import { staticVerifier } from "./static-verifier.js";
import { browserVerifier } from "./browser-verifier.js";
import Anthropic from "@anthropic-ai/sdk";
import { requireApiKey } from "../apikey.js";

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
    publish: { type: "boolean", default: false },
    "base-url": { type: "string", default: EVAC_URL },
    "skip-browser-shapes": { type: "string", default: "" },
  },
});
if (!values.alert || !values.site || !(values.municipality || values["municipality-file"])) {
  console.error("usage: pnpm -F agents pipeline --alert <bulletin.xml> --municipality <id> --site <site.json> --writer <writer.json> [--revisions <writer.json>...] [--municipality-file <file>]");
  process.exit(2);
}
const read = <T>(p: string): T => JSON.parse(fs.readFileSync(resolveUserPath(p), "utf8")) as T;
const loaded = values["municipality-file"]
  ? { municipality: JSON.parse(fs.readFileSync(resolveUserPath(values["municipality-file"]), "utf8")) as Municipality, readerRan: true }
  : loadMunicipality(values.municipality!);
if (!values.writer) {
  console.error("[pipeline stopped] the live Writer lands on Day 2; pass --writer <writer.json> (and --revisions) to run the loop on fixtures");
  process.exit(3);
}

const alert = parseJmaXml(fs.readFileSync(resolveUserPath(values.alert)));
const municipality = loaded.municipality;
const reviser = values.revisions!.length ? fixtureReviser(values.revisions!.map(resolveUserPath)) : liveWriterReviser;
const maxAttempts = Number(values["max-attempts"]);
if (!["static", "browser", "vision"].includes(values.verifier!)) {
  console.error("--verifier must be static, browser or vision");
  process.exit(2);
}
const visionUsage: import("../reader/pricing.js").CallUsage[] = [];
if (values.verifier === "vision") requireApiKey();
const browser = values.verifier === "browser" || values.verifier === "vision"
  ? browserVerifier({ baseUrl: values["base-url"]!, skipShapes: values["skip-browser-shapes"]!.split(",").filter(Boolean), ...(values.verifier === "vision" ? { vision: { client: new Anthropic(), model: "sonnet" as const, usage: visionUsage } } : {}) })
  : undefined;
const verifier = browser ?? staticVerifier;
const site = read<Site>(values.site);
const result = await runLoop({
  alert, municipality, site, writer: read<WriterOutput>(values.writer), writerSource: `fixture:${path.basename(values.writer)}`,
  verifier, reviser, maxAttempts,
}).finally(() => browser?.close());
// Fixture runs must not land in the published data tree; --publish writes to data/.
const roots = values.publish ? undefined : { reports: path.join(TMP_DIR, "pipeline", "reports"), layouts: path.join(TMP_DIR, "pipeline", "layouts") };
const { dir, report } = writeReport({ siteId: site.id, municipalityId: municipality.id, bulletinId: alert.bulletin_id, verifier: verifier.name, reviser: reviser.name, maxAttempts, result, roots });
for (const a of report.attempts) console.log(`attempt ${a.n} (${a.writer_source}): ${a.findings.length ? a.findings.map((f) => `${f.shape} ${f.check}${f.cell_id ? `[${f.cell_id}]` : ""}`).join(", ") : "no findings"}`);
console.log(`${report.outcome}${report.reason ? ` — ${report.reason}` : ""}\n${path.relative(process.cwd(), dir)}/report.json`);
process.exitCode = report.outcome === "pass" ? 0 : 1;
