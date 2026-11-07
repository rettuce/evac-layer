import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { XMLParser } from "fast-xml-parser";
import { FEED_DIR } from "../paths.js";
import { BODY_NAME } from "./feed.js";
import { REPLAYABLE } from "./replay.js";

export const FEED_BASE = "https://www.data.jma.go.jp/developer/xml/feed/";
export const FEEDS_WITH_BODIES = ["extra_l", "eqvol_l", "other_l"] as const;
export const FEEDS_INDEX_ONLY = ["regular_l"] as const;
const USER_AGENT = "evac-layer/0.1 (+https://github.com/rettuce/evac-layer)";
const BODY_INTERVAL_MS = 1000;
const TIMEOUT_MS = 60_000;
const RETRY_WAITS_MS = [5000, 15_000, 45_000];
const MAX_CONSECUTIVE_FAILURES = 5;

export interface Entry { id: string; title: string; updated: string; author: string; url: string; content: string }
export interface IndexedEntry extends Entry { recorded_at: string }
export type Codes = "replayable" | "all";
export type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", removeNSPrefix: true, parseTagValue: false, trimValues: true, isArray: (name) => name === "entry" || name === "link" });

const text = (v: unknown): string => (v && typeof v === "object" ? String((v as Record<string, unknown>)["#text"] ?? "") : v === undefined ? "" : String(v));

export function parseFeed(xml: string | Buffer): Entry[] {
  const feed = parser.parse(xml).feed as { entry?: Record<string, unknown>[] } | undefined;
  if (!feed || typeof feed !== "object") throw new Error("not an Atom feed: no <feed> root");
  const entries = (feed.entry ?? []).map((e) => ({
    id: text(e.id),
    title: text(e.title),
    updated: text(e.updated),
    author: text((e.author as { name?: unknown } | undefined)?.name),
    url: ((e.link as { "@href"?: string }[] | undefined) ?? [])[0]?.["@href"] ?? "",
    content: text(e.content),
  }));
  const broken = entries.findIndex((e) => !e.id || !e.updated);
  if (broken >= 0) throw new Error(`Atom entry ${broken + 1} has no id or updated`);
  return entries;
}

const BODY_FILE = /^[A-Za-z0-9_.-]+\.xml$/;

export function bodyPath(feedDir: string, url: string): string {
  const name = new URL(url).pathname.split("/").pop() ?? "";
  if (!BODY_FILE.test(name) || name.startsWith(".")) throw new Error(`bad body name: ${name || url}`);
  return path.join(feedDir, "bodies", name.slice(0, 8), name);
}

export function readIndex(feedDir: string, feed: string): IndexedEntry[] {
  const file = path.join(feedDir, "index", `${feed}.jsonl`);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as IndexedEntry);
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function fetchBytes(fetchImpl: FetchImpl, url: string): Promise<Buffer> {
  const res = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchWithRetry(fetchImpl: FetchImpl, url: string, sleep: (ms: number) => Promise<void>): Promise<Buffer> {
  for (const ms of RETRY_WAITS_MS) {
    try {
      return await fetchBytes(fetchImpl, url);
    } catch {
      await sleep(ms);
    }
  }
  return fetchBytes(fetchImpl, url);
}

export interface FeedResult { feed: string; new: number; bodies: number; failed?: string }
export interface SavedBody { feed: string; file: string; entry: Entry }

export async function recordFeeds(opts: { feedDir?: string; fetchImpl?: FetchImpl; codes?: Codes; since?: string; now?: () => Date; sleep?: (ms: number) => Promise<void>; log?: (m: string) => void }): Promise<{ feeds: FeedResult[]; saved: SavedBody[] }> {
  const feedDir = opts.feedDir ?? FEED_DIR;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const codes = opts.codes ?? "replayable";
  const since = opts.since === undefined ? undefined : Date.parse(opts.since);
  if (since !== undefined && Number.isNaN(since)) throw new Error(`--since ${opts.since} is not a date (use ISO 8601, e.g. 2026-11-07T00:00+09:00)`);
  const now = opts.now ?? (() => new Date());
  const sleep = opts.sleep ?? wait;
  const log = opts.log ?? ((m: string) => console.error(m));
  const wanted = (e: Entry) => {
    const code = path.basename(e.url).match(BODY_NAME)?.[2];
    if (codes === "replayable" && !(code && REPLAYABLE.test(code))) return false;
    return since === undefined || Date.parse(e.updated) >= since;
  };
  const feeds: FeedResult[] = [];
  const saved: SavedBody[] = [];
  const plan = [...FEEDS_WITH_BODIES.map((f) => [f, true] as const), ...FEEDS_INDEX_ONLY.map((f) => [f, false] as const)];
  for (const [feed, withBodies] of plan) {
    const result: FeedResult = { feed, new: 0, bodies: 0 };
    feeds.push(result);
    const indexFile = path.join(feedDir, "index", `${feed}.jsonl`);
    fs.mkdirSync(path.dirname(indexFile), { recursive: true });
    const seen = new Set(readIndex(feedDir, feed).map((e) => e.id));
    let entries: Entry[];
    try {
      entries = parseFeed(await fetchWithRetry(fetchImpl, `${FEED_BASE}${feed}.xml`, sleep));
    } catch (e) {
      result.failed = (e as Error).message;
      continue;
    }
    let inARow = 0;
    let failed = 0;
    let aborted = false;
    for (const entry of entries) {
      if (withBodies && entry.url) {
        let target: string;
        try {
          target = bodyPath(feedDir, entry.url);
        } catch (e) {
          log(`  skip ${entry.url}: ${(e as Error).message}`);
          continue;
        }
        if (wanted(entry) && !fs.existsSync(target)) {
          try {
            const bytes = await fetchWithRetry(fetchImpl, entry.url, sleep);
            const part = `${target}.${process.pid}.part`;
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(part, bytes);
            fs.renameSync(part, target);
            result.bodies++;
            saved.push({ feed, file: target, entry });
            inARow = 0;
            await sleep(BODY_INTERVAL_MS);
          } catch (e) {
            inARow++;
            failed++;
            log(`  skip ${entry.url}: ${(e as Error).message}`);
            if (inARow >= MAX_CONSECUTIVE_FAILURES) {
              aborted = true;
              break;
            }
            continue;
          }
        }
      }
      if (seen.has(entry.id)) continue;
      fs.appendFileSync(indexFile, JSON.stringify({ ...entry, recorded_at: now().toISOString().replace(/\.\d{3}Z$/, "+00:00") }) + "\n");
      seen.add(entry.id);
      result.new++;
    }
    if (failed) result.failed = `${failed} bodies failed after retries${aborted ? `, ${MAX_CONSECUTIVE_FAILURES} in a row; the rest is left for the next round` : ""}`;
  }
  return { feeds, saved };
}

export function roundLine(t0: number, feeds: FeedResult[]): string {
  const parts = feeds.map((f) => `${f.feed} new=${f.new} bodies=${f.bodies}${f.failed ? ` FAILED ${f.failed}` : ""}`);
  return `${new Date().toISOString()}  ${((Date.now() - t0) / 1000).toFixed(1)}s  ${parts.join("  ")}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { once: { type: "boolean", default: false }, every: { type: "string" }, codes: { type: "string", default: "replayable" }, since: { type: "string" } } });
  const every = values.every === undefined ? undefined : Number(values.every);
  if ((values.codes !== "replayable" && values.codes !== "all") || (every !== undefined && !(every > 0)) || (values.once && every !== undefined)) {
    console.error("usage: pnpm -F agents record [--once | --every <sec>] [--codes replayable|all] [--since <ISO>]");
    process.exit(2);
  }
  const round = async () => {
    const t0 = Date.now();
    const { feeds } = await recordFeeds({ codes: values.codes as Codes, since: values.since });
    console.log(roundLine(t0, feeds));
    return feeds.every((f) => !f.failed);
  };
  console.log(`recording into ${FEED_DIR}`);
  if (every === undefined) {
    process.exitCode = (await round()) ? 0 : 1;
  } else {
    const loop = async () => {
      await round();
      setTimeout(loop, every * 1000);
    };
    await loop();
  }
}
