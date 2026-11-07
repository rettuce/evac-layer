import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listBodies } from "../src/jma/feed.js";
import { FEED_BASE, bodyPath, parseFeed, readIndex, recordFeeds, type FetchImpl } from "../src/jma/record.js";

const DATA = "https://www.data.jma.go.jp/developer/xml/data/";
const entry = (name: string, updated: string, title: string) => `
  <entry>
    <title>${title}</title>
    <id>${DATA}${name}</id>
    <updated>${updated}</updated>
    <author><name>秋田地方気象台</name></author>
    <link type="application/xml" href="${DATA}${name}"/>
    <content type="text">【${title}】</content>
  </entry>`;
const atom = (...entries: string[]) => `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" lang="ja">
  <title>高頻度（随時）</title>
  <updated>2026-11-07T16:13:11+09:00</updated>
  <id>${FEED_BASE}extra.xml#long_1</id>
  <link rel="self" href="${FEED_BASE}extra.xml"/>${entries.join("")}
</feed>`;

const RAIN = "20261107071258_0_VPWW55_050000.xml";
const TRANSITION = "20261107071258_0_VPWW53_050000.xml";
const EXTRA = atom(entry(RAIN, "2026-11-07T07:12:56Z", "気象警報・注意報（Ｒ０６）"), entry(TRANSITION, "2026-11-07T07:12:56Z", "気象特別警報・警報・注意報"));

function fakeFeed() {
  const calls: string[] = [];
  const fetchImpl: FetchImpl = async (url) => {
    calls.push(url);
    if (url === `${FEED_BASE}extra_l.xml`) return new Response(EXTRA);
    if (url.startsWith(FEED_BASE)) return new Response(atom());
    return new Response(`<Report>${path.basename(url)}</Report>`);
  };
  return { calls, fetchImpl };
}

const tmpFeed = () => fs.mkdtempSync(path.join(os.tmpdir(), "evac-record-"));
const noWait = async () => {};

test("parseFeed reads id, title, updated, author, link and content from an Atom feed", () => {
  const entries = parseFeed(EXTRA);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], {
    id: `${DATA}${RAIN}`, title: "気象警報・注意報（Ｒ０６）", updated: "2026-11-07T07:12:56Z", author: "秋田地方気象台",
    url: `${DATA}${RAIN}`, content: "【気象警報・注意報（Ｒ０６）】",
  });
  assert.deepEqual(parseFeed(atom()), []);
});

test("bodyPath files a bulletin under its date, by the name in its URL", () => {
  assert.equal(bodyPath("/feed", `${DATA}${RAIN}`), `/feed/bodies/20261107/${RAIN}`);
});

test("recordFeeds writes the index and the replayable bodies, and a second round fetches no body again", async () => {
  const feedDir = tmpFeed();
  const { calls, fetchImpl } = fakeFeed();
  const first = await recordFeeds({ feedDir, fetchImpl, sleep: noWait, now: () => new Date("2026-11-07T07:20:00Z") });
  assert.deepEqual(first.feeds.map((f) => [f.feed, f.new, f.bodies]), [["extra_l", 2, 1], ["eqvol_l", 0, 0], ["other_l", 0, 0], ["regular_l", 0, 0]]);
  assert.deepEqual(readIndex(feedDir, "extra_l").map((e) => [path.basename(e.url), e.recorded_at]), [[RAIN, "2026-11-07T07:20:00+00:00"], [TRANSITION, "2026-11-07T07:20:00+00:00"]]);
  assert.equal(fs.readFileSync(bodyPath(feedDir, `${DATA}${RAIN}`), "utf8"), `<Report>${RAIN}</Report>`);
  assert.equal(fs.existsSync(bodyPath(feedDir, `${DATA}${TRANSITION}`)), false);
  assert.deepEqual(listBodies(feedDir).map((b) => b.code), ["VPWW55"]);

  calls.length = 0;
  const second = await recordFeeds({ feedDir, fetchImpl, sleep: noWait });
  assert.deepEqual(second.feeds.map((f) => f.new + f.bodies), [0, 0, 0, 0]);
  assert.ok(calls.every((u) => u.startsWith(FEED_BASE)), calls.join(", "));
  assert.equal(readIndex(feedDir, "extra_l").length, 2);
});

test("--codes all keeps every body; --since keeps older bodies out of the store but in the index", async () => {
  const all = tmpFeed();
  await recordFeeds({ feedDir: all, fetchImpl: fakeFeed().fetchImpl, codes: "all", sleep: noWait });
  assert.deepEqual(listBodies(all).map((b) => b.code).sort(), ["VPWW53", "VPWW55"]);

  const later = tmpFeed();
  const r = await recordFeeds({ feedDir: later, fetchImpl: fakeFeed().fetchImpl, since: "2026-11-07T08:00:00Z", sleep: noWait });
  assert.equal(r.feeds[0].new, 2);
  assert.equal(r.saved.length, 0);
  assert.equal(fs.existsSync(path.join(later, "bodies")), false);
});

test("a body that keeps failing is retried next round and is not written to the index", async () => {
  const feedDir = tmpFeed();
  const waits: number[] = [];
  const failing: FetchImpl = async (url) => (url.startsWith(FEED_BASE) ? fakeFeed().fetchImpl(url, {}) : new Response("", { status: 503 }));
  const r = await recordFeeds({ feedDir, fetchImpl: failing, sleep: async (ms) => { waits.push(ms); }, log: () => {} });
  assert.deepEqual(waits, [5000, 15000, 45000]);
  assert.equal(r.feeds[0].bodies, 0);
  assert.deepEqual(readIndex(feedDir, "extra_l").map((e) => path.basename(e.url)), [TRANSITION]);
  const again = await recordFeeds({ feedDir, fetchImpl: fakeFeed().fetchImpl, sleep: noWait });
  assert.deepEqual([again.feeds[0].new, again.feeds[0].bodies], [1, 1]);
});
