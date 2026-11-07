import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Site } from "../src/composer/compose.js";
import type { ReplayEntry } from "../src/jma/replay.js";
import { loadMunicipality } from "../src/loop/municipality.js";
import { composeBulletin, upsertIndexRow } from "../src/loop/one.js";
import { staticVerifier } from "../src/loop/static-verifier.js";
import { receiveSite } from "../src/jma/receive.js";
import { AGENTS_DIR, FEED_DIR } from "../src/paths.js";
import { needsRaw } from "./raw.js";

const fx = <T>(n: string): T => JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, "test/fixtures", n), "utf8"));
const { entries } = fx<{ entries: ReplayEntry[] }>("replay-05210-koyoshi-20261021.json");
const site = fx<Site>("site-05210-test-500m-north.json");
const byId = (id: string) => entries.find((e) => e.bulletin_id === id)!;
const L2 = byId("VXKOii-202610211145-e9c5d2903007");
const L3 = byId("VXKOii-202610211555-d5ccc7c6b547");
const L4 = byId("VXKOii-202610211815-e713da0e3c05");

test("composeBulletin writes one bulletin's layouts, report and index row, keeping the other rows in issue order", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evac-one-"));
  const roots = { layouts: path.join(root, "layouts"), reports: path.join(root, "reports") };
  const { municipality, readerRan } = loadMunicipality("05210");
  const base = { municipality, readerRan, site, verifier: staticVerifier, writer: { kind: "placeholder" } as const, roots };
  const indexFile = path.join(roots.layouts, site.id, "index.json");
  const index = () => JSON.parse(fs.readFileSync(indexFile, "utf8")) as { municipality: string; site: string; entries: { bulletin_id: string; screen: boolean; outcome?: string; layouts?: string[] }[] };

  await composeBulletin({ ...base, entry: L2 });
  await composeBulletin({ ...base, entry: L4 });
  const r = await composeBulletin({ ...base, entry: L3 });

  assert.notEqual(r.outcome, "no-screen");
  assert.deepEqual(fs.readdirSync(path.join(roots.layouts, site.id, L3.bulletin_id)).sort(), ["16x9.json", "1x1.json", "32x9.json", "9x16.json", "pillar.json"]);
  assert.ok(fs.existsSync(path.join(roots.reports, site.id, L3.bulletin_id, "report.json")));
  assert.equal(index().site, site.id);
  assert.deepEqual(index().entries.map((e) => e.bulletin_id), [L2.bulletin_id, L3.bulletin_id, L4.bulletin_id]);
  const row = index().entries[1];
  assert.equal(row.screen, false);
  assert.equal(row.layouts?.length, 5);

  await composeBulletin({ ...base, entry: L3 });
  assert.deepEqual(index().entries.map((e) => e.bulletin_id), [L2.bulletin_id, L3.bulletin_id, L4.bulletin_id]);
});

test("a skipped bulletin gets a no-screen row and no layouts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evac-one-"));
  const roots = { layouts: path.join(root, "layouts"), reports: path.join(root, "reports") };
  const { municipality, readerRan } = loadMunicipality("05210");
  const r = await composeBulletin({ entry: L3, municipality, readerRan, site, verifier: staticVerifier, writer: { kind: "placeholder" }, roots, skipIf: () => "nothing to clear" });
  assert.equal(r.outcome, "no-screen");
  assert.equal(fs.existsSync(path.join(roots.layouts, site.id, L3.bulletin_id)), false);
  const { entries: rows } = JSON.parse(fs.readFileSync(path.join(roots.layouts, site.id, "index.json"), "utf8"));
  assert.deepEqual(rows.map((e: { screen: boolean; reason: string }) => [e.screen, e.reason]), [[false, "nothing to clear"]]);
});

test("index rows are ordered by the instant they were issued, whatever the offset", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evac-one-"));
  const { municipality } = loadMunicipality("05210");
  const row = (bulletin_id: string, issued_at: string, file: string) => ({ bulletin_id, issued_at, file });
  for (const r of [row("c", "2026-10-21T07:00:00Z", "c.xml"), row("a", "2026-10-21T15:55:00+09:00", "a.xml"), row("b2", "2026-10-21T16:00:00+09:00", "b2.xml"), row("b1", "2026-10-21T07:00:00Z", "b1.xml")]) {
    upsertIndexRow({ layoutsRoot: root, site, municipality, row: r });
  }
  const { entries: rows } = JSON.parse(fs.readFileSync(path.join(root, site.id, "index.json"), "utf8"));
  assert.deepEqual(rows.map((r: { bulletin_id: string }) => r.bulletin_id), ["a", "b1", "b2", "c"]);
});

function receiveSetup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evac-receive-"));
  const feedDir = path.join(root, "feed");
  const roots = { layouts: path.join(root, "layouts"), reports: path.join(root, "reports") };
  const liveDir = path.join(root, "live");
  const lines: string[] = [];
  const add = (name: string, updated: string, body: string | Buffer) => {
    const day = path.join(feedDir, "bodies", name.slice(0, 8));
    fs.mkdirSync(day, { recursive: true });
    fs.writeFileSync(path.join(day, name), body);
    const url = `https://www.data.jma.go.jp/developer/xml/data/${name}`;
    lines.push(JSON.stringify({ id: url, title: "t", updated, author: "a", url, content: "", recorded_at: updated }));
    fs.mkdirSync(path.join(feedDir, "index"), { recursive: true });
    fs.writeFileSync(path.join(feedDir, "index", "extra_l.jsonl"), lines.join("\n") + "\n");
  };
  const run = (initialSince: string) => receiveSite({ site, verifier: staticVerifier, writer: { kind: "placeholder" }, usage: [], initialSince, feedDir, roots, liveDir });
  const state = () => JSON.parse(fs.readFileSync(path.join(liveDir, `${site.id}.receiver.json`), "utf8"));
  return { add, run, state, roots, liveDir };
}

test("receive looks back 24 hours and does not move its cursor past a bulletin that failed", async () => {
  const r = receiveSetup();
  const broken = "<Report><Code>0521000</Code></Report>";
  r.add("20261105000000_0_VPWW55_050000.xml", "2026-11-05T00:00:00Z", broken);
  r.add("20261106230000_0_VPWW55_050000.xml", "2026-11-06T23:00:00Z", "<Report/>");
  r.add("20261107010000_0_VPWW55_050000.xml", "2026-11-07T01:00:00Z", broken);
  r.add("20261107020000_0_VPWW55_050000.xml", "2026-11-07T02:00:00Z", "<Report/>");
  const first = await r.run("2026-11-07T00:00:00Z");
  assert.deepEqual(first.errors.map((e) => e.split(":")[0]), ["bodies/20261107/20261107010000_0_VPWW55_050000.xml"]);
  assert.equal(r.state().since, "2026-11-07T00:00:00Z");
  const second = await r.run("2026-11-07T00:00:00Z");
  assert.equal(second.errors.length, 1);
  assert.equal(r.state().since, "2026-11-07T00:00:00Z");
});

const RAW_L3 = path.join(FEED_DIR, L3.file);
const skipRaw = needsRaw({ feed: [L3.file] });

test("receive skips a bulletin that already has a row in index.json and moves its cursor past it", { skip: skipRaw }, async () => {
  const r = receiveSetup();
  r.add(path.basename(L3.file), "2026-10-21T06:55:19Z", fs.readFileSync(RAW_L3));
  const { municipality } = loadMunicipality("05210");
  upsertIndexRow({ layoutsRoot: r.roots.layouts, site, municipality, row: { bulletin_id: L3.bulletin_id, issued_at: L3.issued_at, screen: false, reason: "earlier round" } });
  const round = await r.run("2026-10-21T06:00:00Z");
  assert.deepEqual([round.bulletins.length, round.errors.length], [0, 0]);
  assert.equal(r.state().since, "2026-10-21T06:55:19Z");
});

test("a pass that only the static checks saw changes neither what is showing nor the live state", { skip: skipRaw }, async () => {
  const r = receiveSetup();
  r.add(path.basename(L3.file), "2026-10-21T06:55:19Z", fs.readFileSync(RAW_L3));
  const round = await r.run("2026-10-21T06:00:00Z");
  assert.deepEqual(round.bulletins.map((b) => b.outcome), ["pass"]);
  assert.equal(round.live, undefined);
  assert.deepEqual(r.state().showing, {});
  assert.equal(fs.existsSync(path.join(r.liveDir, `${site.id}.json`)), false);
  assert.equal(r.state().since, "2026-10-21T06:55:19Z");
});
