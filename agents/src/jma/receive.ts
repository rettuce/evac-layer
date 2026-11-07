import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { requireApiKey } from "../apikey.js";
import { liveGateWarning, REPLAY_SITE_MESSAGE, writeLive } from "../delivery/live.js";
import { browserVerifier } from "../loop/browser-verifier.js";
import { loadMunicipality } from "../loop/municipality.js";
import { composeBulletin, type WriterChoice } from "../loop/one.js";
import { staticVerifier } from "../loop/static-verifier.js";
import type { Verifier } from "../loop/types.js";
import { EVAC_URL, FEED_DIR, LIVE_DIR } from "../paths.js";
import type { CallUsage } from "../reader/pricing.js";
import { findSite, siteMunicipality, SiteNotFound, type SiteFile } from "../sites.js";
import type { WriterModel } from "../writer/live.js";
import { BODY_NAME, mentionsMunicipality } from "./feed.js";
import { bodyPath, FEEDS_WITH_BODIES, readIndex, recordFeeds, roundLine, type IndexedEntry } from "./record.js";
import { REPLAYABLE, replayEntry, type ReplayEntry } from "./replay.js";

export interface ReceiverState { since: string; showing: Record<string, string> }

export function receiverStateFile(siteId: string, liveDir = LIVE_DIR): string {
  return path.join(liveDir, `${siteId}.receiver.json`);
}

export function readReceiverState(siteId: string, initialSince: string, liveDir = LIVE_DIR): ReceiverState {
  const file = receiverStateFile(siteId, liveDir);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as ReceiverState) : { since: initialSince, showing: {} };
}

function writeReceiverState(siteId: string, state: ReceiverState, liveDir = LIVE_DIR) {
  const file = receiverStateFile(siteId, liveDir);
  fs.mkdirSync(liveDir, { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2) + "\n");
  fs.renameSync(`${file}.tmp`, file);
}

export function recordedSince(since: string, feedDir = FEED_DIR): { entry: IndexedEntry; file: string; code: string }[] {
  const t = Date.parse(since);
  return FEEDS_WITH_BODIES.flatMap((feed) => readIndex(feedDir, feed))
    .filter((e) => e.url && Date.parse(e.updated) > t)
    .flatMap((entry) => {
      const file = bodyPath(feedDir, entry.url);
      const code = path.basename(file).match(BODY_NAME)?.[2];
      return code && REPLAYABLE.test(code) && fs.existsSync(file) ? [{ entry, file, code }] : [];
    })
    .sort((a, b) => Date.parse(a.entry.updated) - Date.parse(b.entry.updated));
}

export interface SiteRound { site: string; bulletins: { entry: ReplayEntry; outcome: string; reason?: string }[]; live?: string; errors: string[] }

export async function receiveSite(args: { site: SiteFile; verifier: Verifier; writer: WriterChoice; usage: CallUsage[]; initialSince: string; feedDir?: string; log?: (m: string) => void }): Promise<SiteRound> {
  const { site } = args;
  const log = args.log ?? (() => {});
  const feedDir = args.feedDir ?? FEED_DIR;
  const municipalityId = siteMunicipality(site);
  const state = readReceiverState(site.id, args.initialSince);
  const round: SiteRound = { site: site.id, bulletins: [], errors: [] };
  const bodies = recordedSince(state.since, feedDir);
  const entries: ReplayEntry[] = [];
  for (const b of bodies) {
    const xml = fs.readFileSync(b.file);
    if (!mentionsMunicipality(xml.toString("utf8"), b.code, municipalityId)) continue;
    try {
      entries.push(replayEntry(xml, path.relative(feedDir, b.file), b.code, municipalityId));
    } catch (e) {
      round.errors.push(`${path.relative(feedDir, b.file)}: ${(e as Error).message}`);
    }
  }
  entries.sort((a, b) => a.issued_at.localeCompare(b.issued_at) || a.file.localeCompare(b.file));
  const { municipality, readerRan } = entries.length ? loadMunicipality(municipalityId) : { municipality: undefined, readerRan: false };
  let lastPass: string | undefined;
  for (const entry of entries) {
    const hazard = entry.alert.hazard;
    // A clearance only means something to people who saw the warning; per hazard, all-clear follows a shown screen.
    const composed = await composeBulletin({
      entry, municipality: municipality!, readerRan, site, verifier: args.verifier, writer: args.writer, usage: args.usage,
      skipIf: (s) => (s.cleared && !(hazard in state.showing) ? `all-clear for ${hazard} but no ${hazard} screen was shown before; nothing to clear` : undefined),
    });
    if (composed.outcome === "no-screen") {
      round.bulletins.push({ entry, outcome: "no-screen", reason: composed.reason });
      log(`  [${site.id}] ${entry.issued_at} ${entry.bulletin_id} no-screen — ${composed.reason}`);
      continue;
    }
    round.bulletins.push({ entry, outcome: composed.outcome, reason: composed.reason });
    log(`  [${site.id}] ${entry.issued_at} ${entry.bulletin_id} ${composed.situation?.template} L${composed.situation?.level} ${composed.outcome}${composed.reason ? ` — ${composed.reason}` : ""}`);
    if (composed.outcome !== "pass") continue;
    if (composed.situation!.cleared) delete state.showing[hazard];
    else state.showing[hazard] = entry.bulletin_id;
    lastPass = entry.bulletin_id;
  }
  if (lastPass) {
    writeLive(site.id, lastPass);
    round.live = lastPass;
    log(`  [${site.id}] live → ${lastPass}`);
    const warning = liveGateWarning(site.id, lastPass);
    if (warning) log(warning);
  }
  if (bodies.length) state.since = bodies[bodies.length - 1].entry.updated;
  writeReceiverState(site.id, state);
  return round;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { sites: { type: "string" }, every: { type: "string" }, writer: { type: "string", default: "placeholder" }, "writer-model": { type: "string", default: "opus" }, verifier: { type: "string", default: "browser" }, "base-url": { type: "string", default: EVAC_URL }, since: { type: "string" } } });
  const every = values.every === undefined ? undefined : Number(values.every);
  const ids = (values.sites ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids.length || !["placeholder", "live"].includes(values.writer!) || !["static", "browser", "vision"].includes(values.verifier!) || (every !== undefined && !(every > 0)) || (values.since !== undefined && Number.isNaN(Date.parse(values.since)))) {
    console.error("usage: pnpm -F agents receive --sites <id,...> [--every <sec>] [--writer placeholder|live] [--verifier static|browser|vision] [--base-url <url>] [--since <ISO>]");
    process.exit(2);
  }
  let sites: SiteFile[] = [];
  try {
    sites = ids.map((id) => findSite(id));
  } catch (e) {
    if (!(e instanceof SiteNotFound)) throw e;
    console.error(`[receive stopped] ${e.message}`);
    process.exit(2);
  }
  const replaying = sites.find((s) => s.replay);
  if (replaying) {
    console.error(`[receive stopped] ${REPLAY_SITE_MESSAGE(replaying.id)}`);
    process.exit(2);
  }
  if (values.writer === "live" || values.verifier === "vision") requireApiKey();
  const writer: WriterChoice = values.writer === "live" ? { kind: "live", live: { client: new Anthropic(), model: values["writer-model"] as WriterModel } } : { kind: "placeholder" };
  const initialSince = values.since ?? new Date().toISOString();
  const round = async () => {
    const t0 = Date.now();
    const { feeds, saved } = await recordFeeds({});
    console.log(`${roundLine(t0, feeds)}  saved=${saved.length}`);
    const usage: CallUsage[] = [];
    const visionUsage: CallUsage[] = [];
    for (const site of sites) {
      const browser = values.verifier === "static" ? undefined : browserVerifier({ baseUrl: values["base-url"]!, ...(values.verifier === "vision" ? { vision: { client: new Anthropic(), model: "sonnet" as const, usage: visionUsage } } : {}) });
      try {
        const r = await receiveSite({ site, verifier: browser ?? staticVerifier, writer, usage, initialSince, log: (m) => console.log(m) });
        for (const err of r.errors) console.error(`  [${site.id}] [parse error] ${err}`);
        console.log(`  [${site.id}] ${r.bulletins.length} bulletins${r.live ? `, live ${r.live}` : ", live unchanged"}`);
      } finally {
        await browser?.close();
      }
    }
    const usd = [...usage, ...visionUsage].reduce((n, u) => n + u.usd, 0);
    if (usd) console.log(`  api $${usd.toFixed(3)}`);
  };
  if (every === undefined) {
    await round();
  } else {
    const loop = async () => {
      await round().catch((e) => console.error(`[round failed] ${(e as Error).stack ?? e}`));
      setTimeout(loop, every * 1000);
    };
    await loop();
  }
}
