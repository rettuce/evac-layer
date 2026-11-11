import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoData = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "evac-synthetic-mark-"));
for (const dir of ["jma", "municipalities", "sites"]) fs.cpSync(path.join(repoData, dir), path.join(dataDir, dir), { recursive: true });
process.env.EVAC_DATA_DIR = dataDir;

const { AGENTS_DIR, FEED_DIR, LAYOUTS_DIR, LIVE_DIR, SAMPLES_DIR, WRITER_DIR } = await import("../src/paths.js");
const { parseJmaXml } = await import("../src/jma/parse.js");
const { replayEntry } = await import("../src/jma/replay.js");
const { classListing } = await import("../src/jma/synthetic-classes.js");
const { synthesizeXml, saveSyntheticXml } = await import("../src/jma/synthetic.js");
const { receiveSite } = await import("../src/jma/receive.js");
const { staticVerifier } = await import("../src/loop/static-verifier.js");
const { cacheLatestWriterPerClass } = await import("../src/writer/class-cache.js");
const { validateDoc } = await import("../src/schemas.js");
import type { SyntheticPlan } from "../src/jma/synthetic-classes.js";
import type { SiteFile } from "../src/sites.js";

const fixtures = path.join(AGENTS_DIR, "test", "fixtures", "jma");
const allFixtureXml = [path.join(fixtures, "jma-samples"), ...fs.readdirSync(path.join(fixtures, "jma-feed", "bodies")).map((d) => path.join(fixtures, "jma-feed", "bodies", d))]
  .flatMap((dir) => fs.readdirSync(dir).filter((f) => f.endsWith(".xml")).map((f) => path.join(dir, f)));
const plan = classListing("15205").find((c) => c.cls === "landslide/evac-now/4") as SyntheticPlan;
const xml = synthesizeXml(plan, { municipalityId: "15205", municipalityName: "柏崎市", prefecture: "新潟県" });
const TSX = path.join(AGENTS_DIR, "node_modules", ".bin", "tsx");

function run(script: string, args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env, EVAC_DATA_DIR: dataDir, JMA_FEED_DIR: FEED_DIR, JMA_SAMPLES_DIR: SAMPLES_DIR, EVAC_URL: "http://127.0.0.1:9" };
  delete env.ANTHROPIC_API_KEY;
  return spawnSync(TSX, [path.join(AGENTS_DIR, "src", script), ...args], { cwd: AGENTS_DIR, env, encoding: "utf8" });
}

test("no bulletin JMA issued reads as synthetic", () => {
  assert.ok(allFixtureXml.length >= 25);
  for (const f of allFixtureXml) {
    const alert = parseJmaXml(fs.readFileSync(f));
    assert.equal(alert.synthetic, undefined, f);
    assert.doesNotMatch(alert.bulletin_id, /^SYN-/, f);
  }
});

test("a synthetic bulletin carries its mark in the XML, and the parser gives it a synthetic id on every path", () => {
  assert.match(xml, /^<\?xml [^>]*\?>\n<\?evac-layer synthetic="1"\?>\n<Report /);
  const alert = parseJmaXml(xml);
  assert.equal(alert.synthetic, true);
  assert.match(alert.bulletin_id, /^SYN-VPWW56-\d{12}-[0-9a-f]{12}$/);
  assert.equal(validateDoc(alert, "alert").ok, true);
  assert.equal(replayEntry(Buffer.from(xml), "x.xml", "VPWW56", "15205").bulletin_id, alert.bulletin_id);
  const { bulletin_id: unmarkedId, ...unmarked } = parseJmaXml(xml.replace('<?evac-layer synthetic="1"?>\n', ""));
  const { bulletin_id: _id, synthetic: _synthetic, ...marked } = alert;
  assert.doesNotMatch(unmarkedId, /^SYN-/);
  assert.deepEqual(unmarked, marked, "the mark changes the id and nothing else");
});

test("pipeline --go-live refuses a synthetic bulletin passed as XML", () => {
  const file = path.join(dataDir, "synthetic-alert.xml");
  fs.writeFileSync(file, xml);
  const r = run("loop/cli.ts", ["--alert", file, "--site", "15205-demo", "--publish", "--go-live", "--verifier", "static"]);
  assert.notEqual(r.status, 0, r.stdout);
  assert.match(r.stderr, /synthetic/);
  assert.equal(fs.existsSync(path.join(LIVE_DIR, "15205-demo.json")), false);
  const { entries } = JSON.parse(fs.readFileSync(path.join(LAYOUTS_DIR, "15205-demo", "index.json"), "utf8"));
  assert.deepEqual(entries.map((e: { bulletin_id: string; synthetic?: boolean }) => [e.bulletin_id, e.synthetic]), [[parseJmaXml(xml).bulletin_id, true]]);
});

test("the live command refuses a synthetic id", () => {
  const r = run("delivery/live-cli.ts", ["--site", "15205-demo", "--bulletin", parseJmaXml(xml).bulletin_id]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /synthetic/);
  assert.equal(fs.existsSync(path.join(LIVE_DIR, "15205-demo.json")), false);
});

test("receive gives a synthetic bulletin found in the feed a row and no screen", async () => {
  const feedDir = fs.mkdtempSync(path.join(os.tmpdir(), "evac-synthetic-feed-"));
  const name = "20241102080000_0_VPWW56_150000.xml";
  fs.mkdirSync(path.join(feedDir, "bodies", "20241102"), { recursive: true });
  fs.writeFileSync(path.join(feedDir, "bodies", "20241102", name), xml);
  const url = `https://www.data.jma.go.jp/developer/xml/data/${name}`;
  fs.mkdirSync(path.join(feedDir, "index"));
  fs.writeFileSync(path.join(feedDir, "index", "extra_l.jsonl"), JSON.stringify({ id: url, title: "t", updated: "2024-11-01T23:00:00Z", author: "a", url, content: "", recorded_at: "2024-11-01T23:00:00Z" }) + "\n");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evac-synthetic-recv-"));
  const site = JSON.parse(fs.readFileSync(path.join(repoData, "sites", "15205-demo.json"), "utf8")) as SiteFile;
  const round = await receiveSite({ site, verifier: staticVerifier, writer: { kind: "placeholder" }, usage: [], initialSince: "2024-11-01T22:00:00Z", feedDir, roots: { layouts: path.join(root, "l"), reports: path.join(root, "r") }, liveDir: path.join(root, "live") });
  assert.deepEqual(round.bulletins.map((b) => b.outcome), ["no-screen"]);
  assert.match(round.bulletins[0]!.reason!, /synthetic/);
  assert.equal(round.live, undefined);
});

test("the class cache is built over an index that holds a synthetic row, and goes on to the other classes", () => {
  const layoutsDir = fs.mkdtempSync(path.join(os.tmpdir(), "evac-synthetic-cache-"));
  const id = parseJmaXml(xml).bulletin_id.replace(/^(?!SYN-)/, "SYN-");
  const file = saveSyntheticXml("15205", id, xml);
  const realFile = "bodies/20261031/20261031190159_0_VPWW56_150000.xml";
  const realId = parseJmaXml(fs.readFileSync(path.join(FEED_DIR, realFile))).bulletin_id;
  const output = { cells: [{ role: "headline", text: { ja: "x" }, basis: "t" }, { role: "action", text: { ja: "y" }, basis: "t" }, { role: "languages", text: { ja: "y" }, basis: "t" }] };
  fs.mkdirSync(path.join(WRITER_DIR, "15205"), { recursive: true });
  for (const b of [id, realId]) fs.writeFileSync(path.join(WRITER_DIR, "15205", `${b}.json`), JSON.stringify({ model: "opus", output, usage: [], lint: [], status: "normal" }));
  fs.mkdirSync(path.join(layoutsDir, "15205-demo"), { recursive: true });
  fs.writeFileSync(path.join(layoutsDir, "15205-demo", "index.json"), JSON.stringify({ municipality: "15205", entries: [
    { issued_at: "2024-11-02T08:00:00+09:00", bulletin_id: id, file, synthetic: true, screen: true },
    { issued_at: "2026-11-01T04:01:00+09:00", bulletin_id: realId, file: realFile, screen: true },
  ] }));
  const lines = cacheLatestWriterPerClass({ layoutsDir });
  assert.deepEqual(lines.sort(), [`15205/landslide/all-clear/1 ← ${realId}`, `15205/landslide/evac-now/4 ← ${id}`]);
});
