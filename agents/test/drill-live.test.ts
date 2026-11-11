import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LAYOUTS_DIR, REPO_ROOT, SAMPLES_DIR } from "../src/paths.js";
import { approvalWith, classDigest, layoutDigest, layoutStatus, screenClass } from "../../app/layout/gate";
import { compose, type Municipality, type WriterOutput } from "../src/composer/compose.js";
import { replayEntry } from "../src/jma/replay.js";
import { receiveSite } from "../src/jma/receive.js";
import { DrillNotLive, refuseDrillOnLive } from "../src/delivery/live.js";
import { staticVerifier } from "../src/loop/static-verifier.js";
import { validateDoc } from "../src/schemas.js";
import { needsRaw } from "./raw.js";
import type { SiteFile } from "../src/sites.js";

const SITE_ID = "22424-demo";
const DRILL_FILE = "32-39_12_02_250206_VTSE41.xml";
const DRILL_ID = "VTSE41-201609010713-ff3dd5d5c94f";
const LATER_DRILL_ID = "VTSE41-201609010726-05a7380a3e46";
const site = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/sites", `${SITE_ID}.json`), "utf8")) as SiteFile;
const municipality = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/municipalities/22424.json"), "utf8")) as Municipality;
const skip = needsRaw({ samples: [DRILL_FILE] });

function stored(bulletinId: string) {
  const dir = path.join(LAYOUTS_DIR, SITE_ID, bulletinId);
  const files = fs.readdirSync(dir).map((f) => ({ shape: f.slice(0, -5), body: fs.readFileSync(path.join(dir, f), "utf8") }));
  const digest = layoutDigest(files);
  return { files, digest, cls: { key: screenClass(JSON.parse(files[0].body)), digest: classDigest(files), checked: true } };
}

test("a stored drill screen, written before layouts carried a status, is read as a drill and has a class of its own", () => {
  const drill = stored(DRILL_ID);
  assert.equal(layoutStatus(JSON.parse(drill.files[0].body)), "drill");
  assert.equal(drill.cls.key, "tsunami/evac-now/4/drill");
  const normal = JSON.parse(fs.readFileSync(path.join(LAYOUTS_DIR, "15205-demo/VPWW56-202610311653-b3fa1b3a2ced/16x9.json"), "utf8"));
  assert.equal(layoutStatus(normal), "normal");
  assert.equal(screenClass(normal), "landslide/evac-now/4");
});

test("a drill bulletin is shown on its own approval and never on a class approval, even one recorded before this rule", () => {
  const first = stored(DRILL_ID);
  const laterFiles = first.files.map((f) => {
    const layout = JSON.parse(f.body);
    return { shape: f.shape, body: JSON.stringify({ ...layout, alert: { ...layout.alert, bulletin_id: LATER_DRILL_ID }, sources: layout.sources.map((s: { type: string }) => (s.type === "jma" ? { ...s, bulletin_id: LATER_DRILL_ID } : s)) }) };
  });
  const later = { digest: layoutDigest(laterFiles), cls: { key: first.cls.key, digest: classDigest(laterFiles), checked: true } };
  assert.equal(first.cls.digest, later.cls.digest, "the copy differs only in its bulletin id");
  const at = "2026-11-11T00:00:00Z";
  const approvals = {
    version: "0.1" as const,
    layouts: { [`${SITE_ID}/${DRILL_ID}`]: { approved: true, updated_at: at, digest: first.digest } },
    sites: { [SITE_ID]: { auto_publish: true, updated_at: at } },
    classes: {
      [`${SITE_ID}/${first.cls.key}`]: { approved: true, updated_at: at, digest: first.cls.digest, approved_from: DRILL_ID },
      [`${SITE_ID}/tsunami/evac-now/4`]: { approved: true, updated_at: at, digest: first.cls.digest, approved_from: DRILL_ID },
    },
  };
  assert.deepEqual(approvalWith(approvals, SITE_ID, DRILL_ID, first.digest, first.cls), { approved: true, stale: false, by: "bulletin" });
  assert.equal(approvalWith(approvals, SITE_ID, LATER_DRILL_ID, later.digest, later.cls).approved, false);
});

test("the Composer writes the status of a drill or test bulletin into the layout, and nothing for a normal one", { skip }, () => {
  const entry = replayEntry(fs.readFileSync(path.join(SAMPLES_DIR, DRILL_FILE)), `jma-samples/${DRILL_FILE}`, "VTSE41", "22424");
  const writer = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/writer/22424", `${DRILL_ID}.json`), "utf8")).output as WriterOutput;
  for (const status of ["drill", "test", "normal"] as const) {
    const [layout] = compose({ alert: { ...entry.alert, status }, municipality, site, writer });
    assert.equal((layout.alert as { status?: string }).status, status === "normal" ? undefined : status);
    assert.ok(!("status" in layout.alert) || status !== "normal");
    assert.equal(validateDoc(layout, "layout").ok, true, status);
    assert.equal(screenClass(layout).endsWith(`/${status}`), status !== "normal");
  }
});

test("receive gives a drill bulletin a row and no screen, and does not put it on a live site", { skip }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evac-drill-live-"));
  const feedDir = path.join(root, "feed");
  const name = "20160901071300_0_VTSE41_000000.xml";
  fs.mkdirSync(path.join(feedDir, "bodies", "20160901"), { recursive: true });
  fs.copyFileSync(path.join(SAMPLES_DIR, DRILL_FILE), path.join(feedDir, "bodies", "20160901", name));
  const url = `https://www.data.jma.go.jp/developer/xml/data/${name}`;
  fs.mkdirSync(path.join(feedDir, "index"), { recursive: true });
  fs.writeFileSync(path.join(feedDir, "index", "extra_l.jsonl"), JSON.stringify({ id: url, title: "t", updated: "2016-09-01T07:13:00+09:00", author: "a", url, content: "", recorded_at: "2016-09-01T07:13:00+09:00" }) + "\n");
  const roots = { layouts: path.join(root, "layouts"), reports: path.join(root, "reports") };
  const liveDir = path.join(root, "live");
  const round = await receiveSite({ site, verifier: staticVerifier, writer: { kind: "placeholder" }, usage: [], initialSince: "2016-09-01T07:00:00+09:00", feedDir, roots, liveDir });
  assert.deepEqual(round.bulletins.map((b) => [b.entry.bulletin_id, b.outcome]), [[DRILL_ID, "no-screen"]]);
  assert.match(round.bulletins[0]!.reason!, /drill bulletin .*not shown on a live site/);
  assert.equal(round.live, undefined);
  assert.equal(fs.existsSync(path.join(liveDir, `${SITE_ID}.json`)), false);
  assert.equal(fs.existsSync(path.join(roots.layouts, SITE_ID, DRILL_ID)), false);
  const { entries } = JSON.parse(fs.readFileSync(path.join(roots.layouts, SITE_ID, "index.json"), "utf8"));
  assert.deepEqual(entries.map((e: { screen: boolean }) => e.screen), [false]);
});

test("a drill or test bulletin is refused on a live site by hand, read from the index row or else the stored layout", () => {
  assert.throws(() => refuseDrillOnLive(SITE_ID, DRILL_ID), (e: unknown) => e instanceof DrillNotLive && /drill bulletin .*site with "replay"/.test((e as Error).message), "a layout written before layouts carried a status: its 【訓練】 headline");
  assert.doesNotThrow(() => refuseDrillOnLive("15205-demo", "VPWW56-202610311653-b3fa1b3a2ced"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evac-drill-refuse-"));
  fs.cpSync(path.join(LAYOUTS_DIR, "15205-demo", "VPWW56-202610311653-b3fa1b3a2ced"), path.join(root, "x", "VPWW56-202610311653-b3fa1b3a2ced"), { recursive: true });
  fs.writeFileSync(path.join(root, "x", "index.json"), JSON.stringify({ entries: [{ bulletin_id: "VPWW56-202610311653-b3fa1b3a2ced", status: "test" }] }));
  assert.throws(() => refuseDrillOnLive("x", "VPWW56-202610311653-b3fa1b3a2ced", root), /test bulletin \(Control\/Status 試験\)/);
});

test("the bundled drill demos replay their recording: a site with drill screens is a replay site", () => {
  for (const id of ["22424-demo", "17204-demo"]) {
    const demo = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/sites", `${id}.json`), "utf8")) as SiteFile;
    assert.ok(demo.replay, id);
    const { entries } = JSON.parse(fs.readFileSync(path.join(LAYOUTS_DIR, id, "index.json"), "utf8")) as { entries: { bulletin_id: string; issued_at: string; screen: boolean }[] };
    const drills = entries.filter((e) => e.screen && layoutStatus(JSON.parse(fs.readFileSync(path.join(LAYOUTS_DIR, id, e.bulletin_id, "16x9.json"), "utf8"))) === "drill");
    assert.ok(drills.length >= 3, id);
    for (const e of drills) assert.ok(Date.parse(e.issued_at) >= Date.parse(demo.replay!.from) && Date.parse(e.issued_at) <= Date.parse(demo.replay!.to), `${id} ${e.bulletin_id} is inside the replay window`);
  }
});
