import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { requireApiKey } from "../apikey.js";
import type { Municipality, WriterOutput } from "../composer/compose.js";
import { liveGateWarning, REPLAY_SITE_MESSAGE, writeLive } from "../delivery/live.js";
import { BODY_NAME } from "../jma/feed.js";
import { replayEntry } from "../jma/replay.js";
import { EVAC_URL, FEED_DIR, TMP_DIR, resolveUserPath } from "../paths.js";
import type { CallUsage } from "../reader/pricing.js";
import { findSite, siteMunicipality, type SiteFile } from "../sites.js";
import type { WriterModel } from "../writer/live.js";
import { browserVerifier } from "./browser-verifier.js";
import { MAX_ATTEMPTS } from "./loop.js";
import { loadMunicipality } from "./municipality.js";
import { composeBulletin, type WriterChoice } from "./one.js";
import { fixtureReviser, liveWriterReviser } from "./revisers.js";
import { staticVerifier } from "./static-verifier.js";

const USAGE = "usage: pnpm -F agents pipeline --alert <bulletin.xml> --site <site id | site.json> [--municipality <id> | --municipality-file <file>] [--writer live|placeholder|<writer.json>] [--revisions <writer.json>...] [--verifier static|browser|vision] [--publish [--go-live]]";

const { values } = parseArgs({
  options: {
    alert: { type: "string" },
    municipality: { type: "string" },
    "municipality-file": { type: "string" },
    site: { type: "string" },
    writer: { type: "string", default: "placeholder" },
    "writer-model": { type: "string", default: "opus" },
    revisions: { type: "string", multiple: true, default: [] },
    "max-attempts": { type: "string", default: String(MAX_ATTEMPTS) },
    verifier: { type: "string", default: "static" },
    publish: { type: "boolean", default: false },
    "go-live": { type: "boolean", default: false },
    "base-url": { type: "string", default: EVAC_URL },
    "skip-browser-shapes": { type: "string", default: "" },
  },
});
const stop = (message: string): never => {
  console.error(message);
  process.exit(2);
};
if (!values.alert || !values.site) stop(USAGE);
if (!["static", "browser", "vision"].includes(values.verifier!)) stop("--verifier must be static, browser or vision");
if (values["go-live"] && !values.publish) stop("--go-live needs --publish: only a published screen can be shown");
if (values.revisions!.length && (values.writer === "live" || values.writer === "placeholder")) stop("--revisions go with a fixture first draft: pass --writer <writer.json>");

const readJson = <T>(p: string): T => JSON.parse(fs.readFileSync(resolveUserPath(p), "utf8")) as T;
const site: SiteFile = values.site!.endsWith(".json") ? readJson<SiteFile>(values.site!) : findSite(values.site!);
if (values["go-live"] && site.replay) stop(`[pipeline stopped] ${REPLAY_SITE_MESSAGE(site.id)}`);
const loaded = values["municipality-file"]
  ? { municipality: readJson<Municipality>(values["municipality-file"]), readerRan: true }
  : loadMunicipality(values.municipality ?? siteMunicipality(site));
const municipality = loaded.municipality;

const usage: CallUsage[] = [];
const visionUsage: CallUsage[] = [];
if (values.writer === "live" || values.verifier === "vision") requireApiKey();
const writer: WriterChoice = values.writer === "live"
  ? { kind: "live", live: { client: new Anthropic(), model: values["writer-model"] as WriterModel } }
  : values.writer === "placeholder"
    ? { kind: "placeholder" }
    : { kind: "fixture", writer: readJson<WriterOutput>(values.writer!), source: `fixture:${path.basename(values.writer!)}`, reviser: values.revisions!.length ? fixtureReviser(values.revisions!.map(resolveUserPath)) : liveWriterReviser };

const browser = values.verifier === "browser" || values.verifier === "vision"
  ? browserVerifier({ baseUrl: values["base-url"]!, skipShapes: values["skip-browser-shapes"]!.split(",").filter(Boolean), ...(values.verifier === "vision" ? { vision: { client: new Anthropic(), model: "sonnet" as const, usage: visionUsage } } : {}) })
  : undefined;
const verifier = browser ?? staticVerifier;

const alertFile = resolveUserPath(values.alert!);
const name = path.basename(alertFile);
const code = name.match(BODY_NAME)?.[2] ?? name.match(/_(V[A-Z]{3}\d{2})\.xml$/)?.[1] ?? "";
const fromFeed = path.relative(FEED_DIR, alertFile);
const entry = replayEntry(fs.readFileSync(alertFile), fromFeed.startsWith("..") ? alertFile : fromFeed, code, municipality.id);
const roots = values.publish ? undefined : { reports: path.join(TMP_DIR, "pipeline", "reports"), layouts: path.join(TMP_DIR, "pipeline", "layouts") };
const composed = await composeBulletin({
  entry, municipality, readerRan: loaded.readerRan, site, verifier, writer, roots,
  persistWriter: values.publish, usage, maxAttempts: Number(values["max-attempts"]),
}).finally(() => browser?.close());

for (const a of composed.attempts ?? []) console.log(`attempt ${a.n} (${a.writer_source}): ${a.findings.length ? a.findings.map((f) => `${f.shape} ${f.check}${f.cell_id ? `[${f.cell_id}]` : ""}`).join(", ") : "no findings"}`);
console.log(`${composed.outcome}${composed.reason ? ` — ${composed.reason}` : ""}`);
if (composed.dir) console.log(`${path.relative(process.cwd(), composed.dir)}/report.json`);
const usd = [...usage, ...visionUsage].reduce((n, u) => n + u.usd, 0);
if (usd) console.log(`api $${usd.toFixed(3)} (writer ${usage.length} calls, vision ${visionUsage.length} checks)`);

if (values["go-live"]) {
  if (composed.outcome !== "pass") {
    console.error(`[go-live skipped] ${entry.bulletin_id} did not pass (${composed.outcome}${composed.reason ? `: ${composed.reason}` : ""}); data/live/${site.id}.json is unchanged`);
    process.exit(1);
  }
  const { file, doc } = writeLive(site.id, entry.bulletin_id);
  console.log(`${file}: ${JSON.stringify(doc)}`);
  const warning = liveGateWarning(site.id, entry.bulletin_id);
  if (warning) console.warn(warning);
}
process.exitCode = composed.outcome === "pass" ? 0 : 1;
