import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FEED_BASE, bodyPath, readIndex, recordFeeds, type FetchImpl } from "../src/jma/record.js";
import { LONG_FEED_EVERY_MS, readsLongFeeds, recordRound, recordedSince } from "../src/jma/receive.js";

const DATA = "https://www.data.jma.go.jp/developer/xml/data/";
const entry = (name: string, updated: string) => `
  <entry>
    <title>気象警報・注意報（Ｒ０６）</title>
    <id>${DATA}${name}</id>
    <updated>${updated}</updated>
    <author><name>秋田地方気象台</name></author>
    <link type="application/xml" href="${DATA}${name}"/>
    <content type="text">【気象警報・注意報】</content>
  </entry>`;
const atom = (...entries: string[]) => `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" lang="ja">
  <title>高頻度（随時）</title>
  <updated>2026-11-07T16:13:11+09:00</updated>
  <id>${FEED_BASE}extra.xml</id>
  <link rel="self" href="${FEED_BASE}extra.xml"/>${entries.join("")}
</feed>`;

const RAIN = "20261107071258_0_VPWW55_050000.xml";
const TRANSITION = "20261107071258_0_VPWW53_050000.xml";
const EXTRA = atom(entry(RAIN, "2026-11-07T07:12:56Z"), entry(TRANSITION, "2026-11-07T07:12:56Z"));

interface Call { url: string; headers: Record<string, string> }

function fakeJma(feeds: Record<string, string>, opts: { headers?: (feed: string) => Record<string, string>; failing?: string[] } = {}) {
  const calls: Call[] = [];
  const fetchImpl: FetchImpl = async (url, init) => {
    calls.push({ url, headers: { ...(init.headers as Record<string, string>) } });
    if (url.startsWith(FEED_BASE)) {
      const feed = path.basename(url, ".xml");
      if (opts.failing?.includes(feed)) return new Response("", { status: 503 });
      return new Response(feeds[feed] ?? atom(), { headers: opts.headers?.(feed) ?? {} });
    }
    return new Response(`<Report>${path.basename(url)}</Report>`);
  };
  const feedCalls = () => calls.filter((c) => c.url.startsWith(FEED_BASE)).map((c) => path.basename(c.url));
  const bodyCalls = () => calls.filter((c) => !c.url.startsWith(FEED_BASE)).map((c) => path.basename(c.url));
  return { calls, fetchImpl, feedCalls, bodyCalls };
}

const tmpFeed = () => fs.mkdtempSync(path.join(os.tmpdir(), "evac-frequent-"));
const noWait = async () => {};

test("the frequent set reads extra, eqvol, other and regular, and files their index and replayable bodies", async () => {
  const feedDir = tmpFeed();
  const jma = fakeJma({ extra: EXTRA });
  const r = await recordFeeds({ feedDir, fetchImpl: jma.fetchImpl, feeds: "frequent", sleep: noWait });
  assert.deepEqual(jma.feedCalls(), ["extra.xml", "eqvol.xml", "other.xml", "regular.xml"]);
  assert.deepEqual(r.feeds.map((f) => [f.feed, f.new, f.bodies]), [["extra", 2, 1], ["eqvol", 0, 0], ["other", 0, 0], ["regular", 0, 0]]);
  assert.deepEqual(readIndex(feedDir, "extra").map((e) => path.basename(e.url)), [RAIN, TRANSITION]);
  assert.equal(fs.readFileSync(bodyPath(feedDir, `${DATA}${RAIN}`), "utf8"), `<Report>${RAIN}</Report>`);
  assert.equal(fs.existsSync(bodyPath(feedDir, `${DATA}${TRANSITION}`)), false);
  assert.equal(fs.existsSync(path.join(feedDir, "index", "extra_l.jsonl")), false);
});

test("the default set is still the long feeds only", async () => {
  const jma = fakeJma({});
  await recordFeeds({ feedDir: tmpFeed(), fetchImpl: jma.fetchImpl, sleep: noWait });
  assert.deepEqual(jma.feedCalls(), ["extra_l.xml", "eqvol_l.xml", "other_l.xml", "regular_l.xml"]);
});

test("a bulletin listed in both a long and a frequent feed is fetched once and received once", async () => {
  const feedDir = tmpFeed();
  const jma = fakeJma({ extra: EXTRA, extra_l: EXTRA });
  const r = await recordFeeds({ feedDir, fetchImpl: jma.fetchImpl, feeds: "both", sleep: noWait });
  assert.deepEqual(jma.bodyCalls(), [RAIN]);
  assert.equal(r.saved.length, 1);
  assert.equal(readIndex(feedDir, "extra").length, 2);
  assert.equal(readIndex(feedDir, "extra_l").length, 2);
  assert.deepEqual(recordedSince("2026-11-07T07:00:00Z", feedDir).map((b) => path.basename(b.file)), [RAIN]);
});

test("recordedSince also reads a recording that has only the long feed indexes", () => {
  const feedDir = tmpFeed();
  const url = `${DATA}${RAIN}`;
  fs.mkdirSync(path.join(feedDir, "index"), { recursive: true });
  fs.writeFileSync(path.join(feedDir, "index", "extra_l.jsonl"), JSON.stringify({ id: url, title: "t", updated: "2026-11-07T07:12:56Z", author: "a", url, content: "", recorded_at: "2026-11-07T07:20:00+00:00" }) + "\n");
  fs.mkdirSync(path.dirname(bodyPath(feedDir, url)), { recursive: true });
  fs.writeFileSync(bodyPath(feedDir, url), "<Report/>");
  assert.deepEqual(recordedSince("2026-11-07T07:00:00Z", feedDir).map((b) => path.basename(b.file)), [RAIN]);
});

test("a feed answered with ETag and Last-Modified is asked again conditionally, and 304 counts as nothing new", async () => {
  const feedDir = tmpFeed();
  const validators = { ETag: '"abc"', "Last-Modified": "Sat, 07 Nov 2026 07:13:11 GMT" };
  const first = fakeJma({ extra: EXTRA }, { headers: (f) => (f === "extra" ? validators : {}) });
  await recordFeeds({ feedDir, fetchImpl: first.fetchImpl, feeds: "frequent", sleep: noWait });
  assert.equal(first.calls[0].headers["If-None-Match"], undefined);

  const calls: Call[] = [];
  const unchanged: FetchImpl = async (url, init) => {
    calls.push({ url, headers: { ...(init.headers as Record<string, string>) } });
    return url === `${FEED_BASE}extra.xml` ? new Response(null, { status: 304 }) : new Response(atom());
  };
  const second = await recordFeeds({ feedDir, fetchImpl: unchanged, feeds: "frequent", sleep: noWait });
  const extraCall = calls.find((c) => c.url === `${FEED_BASE}extra.xml`)!;
  assert.equal(extraCall.headers["If-None-Match"], '"abc"');
  assert.equal(extraCall.headers["If-Modified-Since"], "Sat, 07 Nov 2026 07:13:11 GMT");
  assert.equal(calls.find((c) => c.url === `${FEED_BASE}eqvol.xml`)!.headers["If-None-Match"], undefined);
  assert.deepEqual(second.feeds[0], { feed: "extra", new: 0, bodies: 0 });
  assert.ok(second.feeds.every((f) => !f.failed));
  assert.equal(readIndex(feedDir, "extra").length, 2);
});

test("bulletin bodies are never asked for conditionally", async () => {
  const feedDir = tmpFeed();
  const headers = () => ({ ETag: '"abc"', "Last-Modified": "Sat, 07 Nov 2026 07:13:11 GMT" });
  await recordFeeds({ feedDir, fetchImpl: fakeJma({ extra: EXTRA }, { headers }).fetchImpl, feeds: "frequent", sleep: noWait });
  fs.rmSync(path.join(feedDir, "index", "extra.state.json"));
  fs.rmSync(bodyPath(feedDir, `${DATA}${RAIN}`));
  const jma = fakeJma({ extra: EXTRA }, { headers });
  await recordFeeds({ feedDir, fetchImpl: jma.fetchImpl, feeds: "frequent", sleep: noWait });
  const body = jma.calls.find((c) => c.url === `${DATA}${RAIN}`)!;
  assert.deepEqual(Object.keys(body.headers), ["User-Agent"]);
});

test("a server that sends neither ETag nor Last-Modified is read in full every round", async () => {
  const feedDir = tmpFeed();
  for (let i = 0; i < 2; i++) {
    const jma = fakeJma({ extra: EXTRA });
    await recordFeeds({ feedDir, fetchImpl: jma.fetchImpl, feeds: "frequent", sleep: noWait });
    assert.ok(jma.calls.filter((c) => c.url.startsWith(FEED_BASE)).every((c) => !("If-None-Match" in c.headers) && !("If-Modified-Since" in c.headers)));
  }
  assert.equal(fs.existsSync(path.join(feedDir, "index", "extra.state.json")), false);
});

test("a feed whose bodies failed is read in full next round, so the failed bodies are tried again", async () => {
  const feedDir = tmpFeed();
  const headers = () => ({ ETag: '"abc"' });
  const failing: FetchImpl = async (url, init) => (url.startsWith(FEED_BASE) ? fakeJma({ extra: EXTRA }, { headers }).fetchImpl(url, init) : new Response("", { status: 503 }));
  const first = await recordFeeds({ feedDir, fetchImpl: failing, feeds: "frequent", sleep: noWait, log: () => {} });
  assert.match(first.feeds[0].failed ?? "", /bodies failed/);
  const jma = fakeJma({ extra: EXTRA }, { headers });
  const again = await recordFeeds({ feedDir, fetchImpl: jma.fetchImpl, feeds: "frequent", sleep: noWait });
  assert.equal(jma.calls[0].headers["If-None-Match"], undefined);
  assert.equal(again.feeds[0].bodies, 1);
});

test("the long feeds are read on the first round and then once an hour has passed since they were last read", () => {
  const t = new Date("2026-11-07T07:00:00Z");
  const after = (ms: number) => new Date(t.getTime() + ms);
  assert.equal(readsLongFeeds(undefined, t), true);
  assert.equal(readsLongFeeds(t, after(60_000)), false);
  assert.equal(readsLongFeeds(t, after(LONG_FEED_EVERY_MS - 1)), false);
  assert.equal(readsLongFeeds(t, after(LONG_FEED_EVERY_MS)), true);
  assert.equal(LONG_FEED_EVERY_MS, 60 * 60 * 1000);
});

test("a receive round reads the frequent feeds every time and the long feeds only when due", async () => {
  const feedDir = tmpFeed();
  const t0 = new Date("2026-11-07T07:00:00Z");
  const first = fakeJma({});
  const r1 = await recordRound({ feedDir, fetchImpl: first.fetchImpl, sleep: noWait, now: () => t0 });
  assert.deepEqual(first.feedCalls().sort(), ["eqvol.xml", "eqvol_l.xml", "extra.xml", "extra_l.xml", "other.xml", "other_l.xml", "regular.xml", "regular_l.xml"]);
  assert.deepEqual(r1.lastLongAt, t0);

  const second = fakeJma({});
  const r2 = await recordRound({ feedDir, fetchImpl: second.fetchImpl, sleep: noWait, now: () => new Date("2026-11-07T07:01:00Z"), lastLongAt: r1.lastLongAt });
  assert.deepEqual(second.feedCalls(), ["extra.xml", "eqvol.xml", "other.xml", "regular.xml"]);
  assert.deepEqual(r2.lastLongAt, t0);
});

test("a long feed that failed is tried again on the next round", async () => {
  const t0 = new Date("2026-11-07T07:00:00Z");
  const r = await recordRound({ feedDir: tmpFeed(), fetchImpl: fakeJma({}, { failing: ["eqvol_l"] }).fetchImpl, sleep: noWait, now: () => t0 });
  assert.equal(r.lastLongAt, undefined);
  assert.equal(readsLongFeeds(r.lastLongAt, new Date("2026-11-07T07:01:00Z")), true);
});

test("received_at moves on a round that read only the frequent feeds when all of them came in, and not when one failed", async () => {
  const t0 = new Date("2026-11-07T07:00:00Z");
  const at = new Date("2026-11-07T07:01:00Z");
  const ok = await recordRound({ feedDir: tmpFeed(), fetchImpl: fakeJma({}).fetchImpl, sleep: noWait, now: () => at, lastLongAt: t0 });
  assert.equal(ok.receivedAt, at.toISOString());
  const bad = await recordRound({ feedDir: tmpFeed(), fetchImpl: fakeJma({}, { failing: ["other"] }).fetchImpl, sleep: noWait, now: () => at, lastLongAt: t0 });
  assert.equal(bad.receivedAt, undefined);
});

test("fetchedAt is when every feed of the round came in, and is absent when one failed; receivedAt stays the start of the round", async () => {
  const t0 = new Date("2026-11-07T07:00:00Z");
  const clock = () => {
    const times = [new Date("2026-11-07T07:01:00Z"), new Date("2026-11-07T07:01:04Z")];
    return () => (times.length > 1 ? times.shift()! : times[0]);
  };
  const ok = await recordRound({ feedDir: tmpFeed(), fetchImpl: fakeJma({}).fetchImpl, sleep: noWait, now: clock(), lastLongAt: t0 });
  assert.deepEqual([ok.receivedAt, ok.fetchedAt], ["2026-11-07T07:01:00.000Z", "2026-11-07T07:01:04.000Z"]);
  const bad = await recordRound({ feedDir: tmpFeed(), fetchImpl: fakeJma({}, { failing: ["other"] }).fetchImpl, sleep: noWait, now: clock(), lastLongAt: t0 });
  assert.deepEqual([bad.receivedAt, bad.fetchedAt], [undefined, undefined]);
});
