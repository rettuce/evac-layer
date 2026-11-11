import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoData = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "evac-status-migration-"));
for (const dir of ["jma", "municipalities", "sites"]) fs.cpSync(path.join(repoData, dir), path.join(dataDir, dir), { recursive: true });
process.env.EVAC_DATA_DIR = dataDir;

const { FEED_DIR, SAMPLES_DIR } = await import("../src/paths.js");
const { bulletinRow } = await import("../src/loop/one.js");
const { migrateBulletinStatus } = await import("../src/loop/status-migration.js");
const { replayEntry } = await import("../src/jma/replay.js");
const { receiveSite } = await import("../src/jma/receive.js");
const { staticVerifier } = await import("../src/loop/static-verifier.js");
const { layoutClassOf } = await import("../src/delivery/gate.js");
const { approvalWith, classDigest, layoutDigest, screenClass } = await import("../../app/layout/gate");
const { needsRaw } = await import("./raw.js");
import type { SiteFile } from "../src/sites.js";

const DRILL_FILE = "32-39_12_02_250206_VTSE41.xml";
const NORMAL_FILE = "bodies/20261031/20261031075327_0_VPWW56_150000.xml";
const NORMAL_ID = "VPWW56-202610311653-b3fa1b3a2ced";
const skip = needsRaw({ samples: [DRILL_FILE], feed: [NORMAL_FILE] });

function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else out.set(path.relative(dir, p), fs.readFileSync(p, "utf8"));
    }
  };
  walk(dir);
  return out;
}

function copySite(site: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evac-status-layouts-"));
  fs.cpSync(path.join(repoData, "layouts", site), path.join(root, site), { recursive: true });
  return root;
}

test("an index row names the status of a drill or test bulletin, and nothing for a normal one", { skip }, () => {
  const drill = replayEntry(fs.readFileSync(path.join(SAMPLES_DIR, DRILL_FILE)), `jma-samples/${DRILL_FILE}`, "VTSE41", "22424");
  assert.equal(bulletinRow(drill).status, "drill");
  assert.equal(bulletinRow({ ...drill, alert: { ...drill.alert, status: "test" } }).status, "test");
  const normal = replayEntry(fs.readFileSync(path.join(FEED_DIR, NORMAL_FILE)), NORMAL_FILE, "VPWW56", "15205");
  assert.equal("status" in bulletinRow(normal), false);
});

test("the migration writes the status of drill rows and their layouts, and leaves a site of normal bulletins byte for byte", { skip }, () => {
  const drillRoot = copySite("22424-demo");
  const before = snapshot(path.join(drillRoot, "22424-demo"));
  const migrated = migrateBulletinStatus("22424-demo", { layoutsDir: drillRoot });
  assert.ok(migrated.includes("VTSE41-201609010713-ff3dd5d5c94f"));
  const index = JSON.parse(fs.readFileSync(path.join(drillRoot, "22424-demo", "index.json"), "utf8"));
  const row = index.entries.find((e: { bulletin_id: string }) => e.bulletin_id === "VTSE41-201609010713-ff3dd5d5c94f");
  assert.equal(row.status, "drill");
  const layout = JSON.parse(fs.readFileSync(path.join(drillRoot, "22424-demo", "VTSE41-201609010713-ff3dd5d5c94f", "16x9.json"), "utf8"));
  assert.equal(layout.alert.status, "drill");
  for (const [file, body] of before) {
    const now = fs.readFileSync(path.join(drillRoot, "22424-demo", file), "utf8");
    const changed = migrated.some((id) => file.startsWith(`${id}/`)) || file === "index.json";
    if (!changed) assert.equal(now, body, file);
  }
  for (const e of index.entries.filter((x: { status?: string }) => !x.status)) {
    assert.equal(fs.readFileSync(path.join(drillRoot, "22424-demo", "index.json"), "utf8").includes(e.bulletin_id), true);
  }
  assert.deepEqual(migrateBulletinStatus("22424-demo", { layoutsDir: drillRoot }), [], "a second run has nothing to do");

  const normalRoot = copySite("15205-demo");
  const normalBefore = snapshot(path.join(normalRoot, "15205-demo"));
  assert.deepEqual(migrateBulletinStatus("15205-demo", { layoutsDir: normalRoot }), []);
  assert.deepEqual(snapshot(path.join(normalRoot, "15205-demo")), normalBefore);
});

test("a test bulletin's layout without a status is out of class approval: by its index row before the migration, by its layout after", { skip }, () => {
  const root = copySite("15205-demo");
  const xmlDir = fs.mkdtempSync(path.join(os.tmpdir(), "evac-status-xml-"));
  fs.writeFileSync(path.join(xmlDir, "test.xml"), fs.readFileSync(path.join(FEED_DIR, NORMAL_FILE), "utf8").replace("<Status>通常</Status>", "<Status>試験</Status>"));
  const indexFile = path.join(root, "15205-demo", "index.json");
  const index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
  const row = index.entries.find((e: { bulletin_id: string }) => e.bulletin_id === NORMAL_ID);
  row.file = "test-bulletin.xml";
  fs.writeFileSync(indexFile, JSON.stringify(index));
  const dir = path.join(root, "15205-demo", NORMAL_ID);
  const files = () => fs.readdirSync(dir).map((f) => ({ shape: f.slice(0, -5), body: fs.readFileSync(path.join(dir, f), "utf8") }));
  const at = "2026-11-11T00:00:00Z";
  const approvalsFor = (key: string) => ({ version: "0.1" as const, layouts: {}, sites: { "15205-demo": { auto_publish: true, updated_at: at } }, classes: { [`15205-demo/${key}`]: { approved: true, updated_at: at, digest: classDigest(files()), approved_from: "B0" } } });
  const plain = screenClass(JSON.parse(files()[0]!.body));
  assert.equal(plain, "landslide/evac-now/4", "the layout alone reads as normal");
  const rowStatus = screenClass(JSON.parse(files()[0]!.body), "test");
  assert.equal(rowStatus, "landslide/evac-now/4/test");
  assert.equal(approvalWith(approvalsFor(plain), "15205-demo", NORMAL_ID, layoutDigest(files()), { key: rowStatus, digest: classDigest(files()), checked: true }).approved, false);

  const migrated = migrateBulletinStatus("15205-demo", { layoutsDir: root, xmlPath: (f) => path.join(xmlDir, f === "test-bulletin.xml" ? "test.xml" : f) });
  assert.deepEqual(migrated, [NORMAL_ID]);
  const cls = layoutClassOf(dir, path.join(root, "none.json"))!;
  assert.equal(cls.key, "landslide/evac-now/4/test");
  assert.equal(JSON.parse(fs.readFileSync(indexFile, "utf8")).entries.find((e: { bulletin_id: string }) => e.bulletin_id === NORMAL_ID).status, "test");
});

test("a row whose XML cannot be read is left as it is, with one warning", { skip }, () => {
  const root = copySite("15205-demo");
  const indexFile = path.join(root, "15205-demo", "index.json");
  const index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
  index.entries[0].file = "bodies/missing/none.xml";
  fs.writeFileSync(indexFile, JSON.stringify(index));
  const before = fs.readFileSync(indexFile, "utf8");
  const warnings: string[] = [];
  migrateBulletinStatus("15205-demo", { layoutsDir: root, log: (m) => warnings.push(m) });
  const first = warnings.length;
  migrateBulletinStatus("15205-demo", { layoutsDir: root, log: (m) => warnings.push(m) });
  assert.equal(warnings.length, first, "no warning is repeated");
  assert.equal(warnings.filter((w) => /none\.xml/.test(w)).length, 1);
  assert.equal(fs.readFileSync(indexFile, "utf8"), before);
});

test("receive migrates the site's index before it reads it", { skip }, async () => {
  const root = copySite("22424-demo");
  const site = JSON.parse(fs.readFileSync(path.join(repoData, "sites", "22424-demo.json"), "utf8")) as SiteFile;
  const feedDir = fs.mkdtempSync(path.join(os.tmpdir(), "evac-status-feed-"));
  fs.mkdirSync(path.join(feedDir, "index"), { recursive: true });
  fs.writeFileSync(path.join(feedDir, "index", "extra_l.jsonl"), "");
  await receiveSite({ site, verifier: staticVerifier, writer: { kind: "placeholder" }, usage: [], initialSince: "2026-11-01T00:00:00Z", feedDir, roots: { layouts: root, reports: path.join(root, "reports") }, liveDir: path.join(root, "live") });
  const index = JSON.parse(fs.readFileSync(path.join(root, "22424-demo", "index.json"), "utf8"));
  assert.equal(index.entries.find((e: { bulletin_id: string }) => e.bulletin_id === "VTSE41-201609010713-ff3dd5d5c94f").status, "drill");
});
