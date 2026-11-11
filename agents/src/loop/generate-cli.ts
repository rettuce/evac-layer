import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { requireApiKey } from "../apikey.js";
import { EVAC_URL } from "../paths.js";
import { findSite, SiteNotFound, type SiteFile } from "../sites.js";
import type { WriterModel } from "../writer/live.js";
import { browserVerifier } from "./browser-verifier.js";
import { generateSite, generationExitCode, generationFile } from "./generation.js";
import type { WriterChoice } from "./one.js";
import { staticVerifier } from "./static-verifier.js";

const USAGE = "usage: pnpm -F agents generate --site <site_id> [--classes <class,...>] [--writer placeholder|live] [--writer-model opus|sonnet] [--verifier static|browser] [--base-url <url>]";

const { values } = parseArgs({
  options: {
    site: { type: "string" },
    classes: { type: "string" },
    writer: { type: "string", default: "placeholder" },
    "writer-model": { type: "string", default: "opus" },
    verifier: { type: "string", default: "browser" },
    "base-url": { type: "string", default: EVAC_URL },
  },
});
if (!values.site || !["placeholder", "live"].includes(values.writer!) || !["static", "browser"].includes(values.verifier!) || !["opus", "sonnet"].includes(values["writer-model"]!)) {
  console.error(USAGE);
  process.exit(2);
}
let site: SiteFile;
try {
  site = findSite(values.site);
} catch (e) {
  if (!(e instanceof SiteNotFound)) throw e;
  console.error(`[generate stopped] ${e.message}`);
  process.exit(2);
}
if (values.writer === "live") requireApiKey();
const writer: WriterChoice = values.writer === "live" ? { kind: "live", live: { client: new Anthropic(), model: values["writer-model"] as WriterModel } } : { kind: "placeholder" };
const classes = (values.classes ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const browser = values.verifier === "browser" ? browserVerifier({ baseUrl: values["base-url"]! }) : undefined;
const usage: import("../reader/pricing.js").CallUsage[] = [];
console.log(`generate: ${site.id}, writer=${values.writer}, verifier=${values.verifier}`);
try {
  const result = await generateSite({ site, classes, verifier: browser ?? staticVerifier, writer, usage, log: (m) => console.log(m) });
  const usd = usage.reduce((n, u) => n + u.usd, 0);
  if (usd) console.log(`  api $${usd.toFixed(3)}`);
  console.log(`${generationFile(site.id)}: ${result.classes.filter((c) => c.approvable).length} of ${result.classes.length} classes ready for approval`);
  process.exitCode = generationExitCode(result.classes);
} finally {
  await browser?.close();
}
