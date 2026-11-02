import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { Site } from "../composer/compose.js";
import { replay } from "../jma/replay.js";
import { REPO_ROOT } from "../paths.js";
import { browserVerifier } from "./browser-verifier.js";
import { runReplay, type ReplaySummary } from "./replay-run.js";
import { staticVerifier } from "./static-verifier.js";

const { values } = parseArgs({
  options: {
    municipalities: { type: "string", default: "05210,17204,22424,14100" },
    verifier: { type: "string", default: "static" },
    "base-url": { type: "string", default: process.env.EVAC_URL ?? "http://127.0.0.1:3152" },
  },
});
const ids = values.municipalities!.split(",").map((s) => s.trim()).filter(Boolean);
const stamp = () => new Date().toLocaleTimeString("ja-JP", { hour12: false, timeZone: "Asia/Tokyo" });
const log = (id: string, msg: string) => console.log(`${stamp()}  [${id}] ${msg}`);
const t0 = Date.now();

console.log(`${stamp()}  fan-out: ${ids.length} municipalities, verifier=${values.verifier}`);
const results = await Promise.all(ids.map(async (id): Promise<ReplaySummary | { municipality: string; error: string }> => {
  const siteFile = path.join(REPO_ROOT, "data", "sites", `${id}-demo.json`);
  const site = JSON.parse(fs.readFileSync(siteFile, "utf8")) as Site;
  const { entries, errors } = replay(id);
  if (errors.length) return { municipality: id, error: `${errors.length} recorded bulletins failed to parse: ${errors[0].file}: ${errors[0].error}` };
  log(id, `start: ${entries.length} recorded bulletins`);
  const browser = values.verifier === "browser" ? browserVerifier({ baseUrl: values["base-url"]! }) : undefined;
  try {
    const s = await runReplay({
      municipalityId: id, entries, site, verifier: browser ?? staticVerifier,
      onEvent: (e) => { if (e.outcome !== "no-screen") log(id, `${e.issued_at.slice(5, 16).replace("T", " ")} ${e.template} L${e.level} ${e.outcome}${e.reason ? ` — ${e.reason}` : ""}`); },
    });
    log(id, `done: ${s.name} bulletins=${s.bulletins} screens=${s.screens} pass=${s.pass} fail=${s.fail} no-screen=${s.no_screen} layouts=${s.layouts} ${s.seconds.toFixed(1)}s`);
    return s;
  } catch (e) {
    return { municipality: id, error: (e as Error).message };
  } finally {
    await browser?.close();
  }
}));

const ok = results.filter((r): r is ReplaySummary => !("error" in r));
const failed = results.filter((r): r is { municipality: string; error: string } => "error" in r);
const sum = (k: keyof ReplaySummary) => ok.reduce((n, r) => n + (r[k] as number), 0);
console.log("");
console.log("municipality      bulletins  screens  pass  fail  layouts  seconds");
for (const r of ok) console.log(`${(r.municipality + " " + r.name).padEnd(16)}  ${String(r.bulletins).padStart(9)}  ${String(r.screens).padStart(7)}  ${String(r.pass).padStart(4)}  ${String(r.fail).padStart(4)}  ${String(r.layouts).padStart(7)}  ${r.seconds.toFixed(1).padStart(7)}`);
console.log(`${"total".padEnd(16)}  ${String(sum("bulletins")).padStart(9)}  ${String(sum("screens")).padStart(7)}  ${String(sum("pass")).padStart(4)}  ${String(sum("fail")).padStart(4)}  ${String(sum("layouts")).padStart(7)}  ${((Date.now() - t0) / 1000).toFixed(1).padStart(7)}`);
for (const f of failed) console.log(`[${f.municipality}] stopped: ${f.error}`);
process.exitCode = failed.length || sum("fail") ? 1 : 0;
