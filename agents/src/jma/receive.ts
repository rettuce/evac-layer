import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { requireApiKey } from "../apikey.js";
import { liveGateWarning, REPLAY_SITE_MESSAGE, writeLive } from "../delivery/live.js";
import { browserVerifier } from "../loop/browser-verifier.js";
import { loadMunicipality } from "../loop/municipality.js";
import { byIssue, clearanceSkipReason, composeBulletin, indexedBulletins, type WriterChoice } from "../loop/one.js";
import { staticVerifier } from "../loop/static-verifier.js";
import type { Verifier } from "../loop/types.js";
import { EVAC_URL, FEED_DIR, LIVE_DIR } from "../paths.js";
import type { CallUsage } from "../reader/pricing.js";
import { findSite, siteMunicipality, SiteNotFound, type SiteFile } from "../sites.js";
import type { WriterModel } from "../writer/live.js";
import { BODY_NAME, mentionsMunicipality } from "./feed.js";
import { bodyPath, FEEDS_WITH_BODIES, readIndex, recordFeeds, roundLine, type IndexedEntry } from "./record.js";
import { REPLAYABLE, replayEntry, type ReplayEntry } from "./replay.js";

export interface ReceiverState { since: string; showing: Record<string, string>; received_at?: string }

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

export const LOOKBACK_MS = 24 * 60 * 60 * 1000;

export interface RecordedBody { entry: IndexedEntry; file: string; code: string }

export function recordedSince(since: string, feedDir = FEED_DIR): RecordedBody[] {
  const from = Date.parse(since) - LOOKBACK_MS;
  const ids = new Set<string>();
  return FEEDS_WITH_BODIES.flatMap((feed) => readIndex(feedDir, feed))
    .filter((e) => e.url && Date.parse(e.updated) >= from)
    .flatMap((entry) => {
      if (ids.has(entry.id)) return [];
      ids.add(entry.id);
      let file: string;
      try {
        file = bodyPath(feedDir, entry.url);
      } catch {
        return [];
      }
      const code = path.basename(file).match(BODY_NAME)?.[2];
      return code && REPLAYABLE.test(code) && fs.existsSync(file) ? [{ entry, file, code }] : [];
    })
    .sort((a, b) => Date.parse(a.entry.updated) - Date.parse(b.entry.updated) || a.file.localeCompare(b.file));
}

const FEED_TIMEOUT_MS = 5_000;

export async function feedStateLine(baseUrl: string, siteId: string, bulletinId: string): Promise<string> {
  let feed: { state?: string; bulletin_id?: string | null };
  try {
    const res = await fetch(`${baseUrl}/api/feed/${encodeURIComponent(siteId)}`, { signal: AbortSignal.timeout(FEED_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    feed = (await res.json()) as typeof feed;
  } catch (e) {
    return `  [${siteId}] feed unknown — ${(e as Error).message}`;
  }
  const shown = feed.state === "alert" && feed.bulletin_id === bulletinId;
  return `  [${siteId}] feed ${feed.state} ${feed.bulletin_id ?? "-"} — ${bulletinId} ${shown ? "is on screen (approved for the bulletin or its class)" : "is not on screen yet (no approval for the bulletin or its class)"}`;
}

export interface SiteRound { site: string; bulletins: { entry: ReplayEntry; outcome: string; reason?: string }[]; live?: string; errors: string[] }

export async function receiveSite(args: {
  site: SiteFile; verifier: Verifier; writer: WriterChoice; usage: CallUsage[]; initialSince: string;
  feedDir?: string; roots?: { reports: string; layouts: string }; liveDir?: string; log?: (m: string) => void; baseUrl?: string; receivedAt?: string;
}): Promise<SiteRound> {
  const { site } = args;
  const log = args.log ?? (() => {});
  const feedDir = args.feedDir ?? FEED_DIR;
  const liveDir = args.liveDir ?? LIVE_DIR;
  const municipalityId = siteMunicipality(site);
  const state = readReceiverState(site.id, args.initialSince, liveDir);
  const round: SiteRound = { site: site.id, bulletins: [], errors: [] };
  const bodies = recordedSince(state.since, feedDir);
  const done = indexedBulletins(site.id, args.roots?.layouts);
  const failed = new Set<RecordedBody>();
  const fail = (b: RecordedBody, e: unknown) => {
    failed.add(b);
    round.errors.push(`${path.relative(feedDir, b.file)}: ${(e as Error).message}`);
  };
  const todo: { entry: ReplayEntry; body: RecordedBody }[] = [];
  for (const b of bodies) {
    try {
      const xml = fs.readFileSync(b.file);
      if (!mentionsMunicipality(xml.toString("utf8"), b.code, municipalityId)) continue;
      const entry = replayEntry(xml, path.relative(feedDir, b.file), b.code, municipalityId);
      if (done.has(entry.bulletin_id)) continue;
      done.add(entry.bulletin_id);
      todo.push({ entry, body: b });
    } catch (e) {
      fail(b, e);
    }
  }
  todo.sort((a, b) => byIssue(a.entry, b.entry));
  const { municipality, readerRan } = todo.length ? loadMunicipality(municipalityId) : { municipality: undefined, readerRan: false };
  let lastShown: string | undefined;
  for (const { entry, body } of todo) {
    const hazard = entry.alert.hazard;
    let composed;
    try {
      composed = await composeBulletin({
        entry, municipality: municipality!, readerRan, site, verifier: args.verifier, writer: args.writer, usage: args.usage, roots: args.roots,
        skipIf: (s) => clearanceSkipReason(s, hazard, new Set(Object.keys(state.showing))),
      });
    } catch (e) {
      fail(body, e);
      log(`  [${site.id}] ${entry.issued_at} ${entry.bulletin_id} error — ${(e as Error).message}`);
      continue;
    }
    round.bulletins.push({ entry, outcome: composed.outcome, reason: composed.reason });
    const what = composed.outcome === "no-screen" ? "no-screen" : `${composed.situation?.template} L${composed.situation?.level} ${composed.outcome}`;
    log(`  [${site.id}] ${entry.issued_at} ${entry.bulletin_id} ${what}${composed.reason ? ` — ${composed.reason}` : ""}`);
    if (composed.row.screen !== true) continue;
    if (composed.situation!.cleared) delete state.showing[hazard];
    else state.showing[hazard] = entry.bulletin_id;
    lastShown = entry.bulletin_id;
  }
  if (lastShown) {
    writeLive(site.id, lastShown, liveDir);
    round.live = lastShown;
    log(`  [${site.id}] live → ${lastShown}`);
    const warning = liveGateWarning(site.id, lastShown, args.roots);
    if (warning) log(warning);
    if (args.baseUrl) log(await feedStateLine(args.baseUrl, site.id, lastShown));
  }
  const firstFailure = bodies.findIndex((b) => failed.has(b));
  const cleared = firstFailure < 0 ? bodies : bodies.slice(0, firstFailure);
  const reached = cleared.at(-1)?.entry.updated;
  if (reached && Date.parse(reached) > Date.parse(state.since)) state.since = reached;
  if (args.receivedAt) state.received_at = args.receivedAt;
  writeReceiverState(site.id, state, liveDir);
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
    for (const f of feeds) if (f.failed) console.error(`[record] ${f.feed}: ${f.failed}`);
    const receivedAt = feeds.some((f) => f.failed) ? undefined : new Date(t0).toISOString();
    const usage: CallUsage[] = [];
    const visionUsage: CallUsage[] = [];
    for (const site of sites) {
      const browser = values.verifier === "static" ? undefined : browserVerifier({ baseUrl: values["base-url"]!, ...(values.verifier === "vision" ? { vision: { client: new Anthropic(), model: "sonnet" as const, usage: visionUsage } } : {}) });
      try {
        const r = await receiveSite({ site, verifier: browser ?? staticVerifier, writer, usage, initialSince, log: (m) => console.log(m), baseUrl: values["base-url"], receivedAt });
        for (const err of r.errors) console.error(`  [${site.id}] [error] ${err}`);
        console.log(`  [${site.id}] ${r.bulletins.length} bulletins${r.errors.length ? `, ${r.errors.length} errors (retried next round)` : ""}${r.live ? `, live ${r.live}` : ", live unchanged"}`);
      } catch (e) {
        console.error(`  [${site.id}] [round failed] ${(e as Error).message}`);
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
