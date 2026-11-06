import { parseArgs } from "node:util";
import { replay, withinWindow } from "../jma/replay.js";
import { EVAC_URL, FEED_DIR, requireRawDir } from "../paths.js";
import { findSite, readSites, siteMunicipality, type SiteFile } from "../sites.js";
import { browserVerifier } from "./browser-verifier.js";
import { runReplay, type ReplaySummary, promptTokens, type PromptTokens } from "./replay-run.js";
import { staticVerifier } from "./static-verifier.js";
import Anthropic from "@anthropic-ai/sdk";
import { requireApiKey } from "../apikey.js";
import type { WriterModel } from "../writer/live.js";

const { values } = parseArgs({
  options: {
    sites: { type: "string" },
    municipalities: { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
    verifier: { type: "string", default: "static" },
    writer: { type: "string", default: "placeholder" },
    "writer-model": { type: "string", default: "opus" },
    "base-url": { type: "string", default: EVAC_URL },
    "skip-browser-shapes": { type: "string", default: "" },
  },
});
const skipShapes = values["skip-browser-shapes"]!.split(",").map((s) => s.trim()).filter(Boolean);
if (values.writer === "live" || values.verifier === "vision") requireApiKey();
const writer = values.writer === "live" ? { client: new Anthropic(), model: values["writer-model"] as WriterModel } : undefined;
const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
// --municipalities is kept as a shorthand for "every site in these municipalities".
const sites: SiteFile[] = values.sites
  ? list(values.sites).map((id) => findSite(id))
  : values.municipalities
    ? readSites().filter((s) => list(values.municipalities).includes(siteMunicipality(s)))
    : readSites();
if (!sites.length) {
  console.error(`no sites to run${values.municipalities ? ` for municipalities ${values.municipalities}` : ""}; add data/sites/<id>.json`);
  process.exit(2);
}
requireRawDir(`${FEED_DIR}/bodies`, "JMA feed recording (JMA_FEED_DIR)");
const stamp = () => new Date().toLocaleTimeString("ja-JP", { hour12: false, timeZone: "Asia/Tokyo" });
const log = (id: string, msg: string) => console.log(`${stamp()}  [${id}] ${msg}`);
const t0 = Date.now();

console.log(`${stamp()}  fan-out: ${sites.length} sites, verifier=${values.verifier}, writer=${writer ? `live(${writer.model})` : "placeholder"}`);
const results = await Promise.all(sites.map(async (site): Promise<(ReplaySummary & { site: string }) | { site: string; error: string }> => {
  const id = site.id;
  const recorded = replay(siteMunicipality(site));
  const errors = recorded.errors;
  const entries = withinWindow(recorded.entries, { from: values.from, to: values.to });
  if (errors.length) return { site: id, error: `${errors.length} recorded bulletins failed to parse: ${errors[0].file}: ${errors[0].error}` };
  log(id, `start: ${entries.length} recorded bulletins`);
  const visionUsage: import("../reader/pricing.js").CallUsage[] = [];
  const browser = values.verifier === "browser" || values.verifier === "vision"
    ? browserVerifier({ baseUrl: values["base-url"]!, skipShapes, ...(values.verifier === "vision" ? { vision: { client: new Anthropic(), model: "sonnet" as const, usage: visionUsage } } : {}) })
    : undefined;
  try {
    const s = await runReplay({
      municipalityId: siteMunicipality(site), entries, site, verifier: browser ?? staticVerifier, writer,
      onEvent: (e) => { if (e.outcome !== "no-screen") log(id, `${e.issued_at.slice(5, 16).replace("T", " ")} ${e.template} L${e.level} ${e.outcome}${e.reason ? ` — ${e.reason}` : ""}`); },
    });
    log(id, `done: ${s.name} bulletins=${s.bulletins} screens=${s.screens} pass=${s.pass} fail=${s.fail} no-screen=${s.no_screen} layouts=${s.layouts} writer=$${s.writer_usd.toFixed(3)} vision=${visionUsage.reduce((n, u) => n + u.usd, 0).toFixed(3)} (${visionUsage.length} checks) ${s.seconds.toFixed(1)}s`);
    log(id, `prompt tokens: writer ${cacheLine(s.writer_tokens)} / vision ${cacheLine(promptTokens(visionUsage))}`);
    return { ...s, site: id };
  } catch (e) {
    return { site: id, error: (e as Error).message };
  } finally {
    await browser?.close();
  }
}));

const ok = results.filter((r): r is ReplaySummary & { site: string } => !("error" in r));
const failed = results.filter((r): r is { site: string; error: string } => "error" in r);
const sum = (k: keyof ReplaySummary) => ok.reduce((n, r) => n + (r[k] as number), 0);
console.log("");
console.log("site                      bulletins  screens  pass  fail  layouts  seconds");
for (const r of ok) console.log(`${r.site.padEnd(24)}  ${String(r.bulletins).padStart(9)}  ${String(r.screens).padStart(7)}  ${String(r.pass).padStart(4)}  ${String(r.fail).padStart(4)}  ${String(r.layouts).padStart(7)}  ${r.seconds.toFixed(1).padStart(7)}`);
console.log(`${"total".padEnd(24)}  ${String(sum("bulletins")).padStart(9)}  ${String(sum("screens")).padStart(7)}  ${String(sum("pass")).padStart(4)}  ${String(sum("fail")).padStart(4)}  ${String(sum("layouts")).padStart(7)}  ${((Date.now() - t0) / 1000).toFixed(1).padStart(7)}`);
for (const f of failed) console.log(`[${f.site}] stopped: ${f.error}`);
process.exitCode = failed.length || sum("fail") ? 1 : 0;

function cacheLine(t: PromptTokens): string {
  const total = t.input + t.cache_write + t.cache_read;
  return `${total} tok (cache read ${t.cache_read}, written ${t.cache_write}, uncached ${t.input}; hit ${total ? Math.round((100 * t.cache_read) / total) : 0}%)`;
}
