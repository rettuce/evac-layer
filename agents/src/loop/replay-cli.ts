import fs from "node:fs";
import { parseArgs } from "node:util";
import type { Site } from "../composer/compose.js";
import type { ReplayEntry } from "../jma/replay.js";
import { resolveUserPath } from "../paths.js";
import { browserVerifier } from "./browser-verifier.js";
import { runReplay } from "./replay-run.js";
import { staticVerifier } from "./static-verifier.js";
import Anthropic from "@anthropic-ai/sdk";
import { requireApiKey } from "../apikey.js";
import type { WriterModel } from "../writer/live.js";

const { values } = parseArgs({ options: { replay: { type: "string" }, site: { type: "string" }, verifier: { type: "string", default: "static" }, writer: { type: "string", default: "placeholder" }, "writer-model": { type: "string", default: "opus" }, "base-url": { type: "string", default: process.env.EVAC_URL ?? "http://127.0.0.1:3152" } } });
if (!values.replay || !values.site) {
  console.error("usage: pnpm -F agents replay-pipeline --replay <replay.json> --site <site.json> [--verifier static|browser]");
  process.exit(2);
}
const replay = JSON.parse(fs.readFileSync(resolveUserPath(values.replay), "utf8")) as { municipality: string; entries: ReplayEntry[] };
const site = JSON.parse(fs.readFileSync(resolveUserPath(values.site), "utf8")) as Site;
if (values.writer === "live") requireApiKey();
const writer = values.writer === "live" ? { client: new Anthropic(), model: values["writer-model"] as WriterModel } : undefined;
const browser = values.verifier === "browser" ? browserVerifier({ baseUrl: values["base-url"]! }) : undefined;
try {
  const summary = await runReplay({
    municipalityId: replay.municipality, entries: replay.entries, site, verifier: browser ?? staticVerifier, writer,
    onEvent: (e) => console.log(`${e.issued_at}  ${(e.template ?? "no screen").padEnd(12)} ${e.level ? `L${e.level}` : "  "}  ${e.outcome}${e.reason ? ` — ${e.reason}` : ""}`),
  });
  console.log(JSON.stringify(summary));
} finally {
  await browser?.close();
}
