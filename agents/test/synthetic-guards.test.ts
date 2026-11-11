import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoData = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "evac-synthetic-guards-"));
fs.cpSync(path.join(repoData, "jma"), path.join(dataDir, "jma"), { recursive: true });
process.env.EVAC_DATA_DIR = dataDir;

const { APPROVALS_FILE, LAYOUTS_DIR, SITES_DIR } = await import("../src/paths.js");
const { SyntheticNotLive, writeLive } = await import("../src/delivery/live.js");
const { exportSite, ExportStop } = await import("../src/delivery/export.js");
const { bulletinRow } = await import("../src/loop/one.js");
const { liveLayoutGateWith } = await import("../../app/layout/gate");
const { isBulletinId, isSyntheticBulletinId, rowsInWindow } = await import("../../app/layout/replay");
import type { ReplayEntry } from "../src/jma/replay.js";

const SYN = "SYN-VPWW56-202411020800-314b561ca69f";
const REAL = "VPWW56-202610311653-b3fa1b3a2ced";
const SITE = "guard-site";

test("a synthetic id is a bulletin id the admin API accepts, told apart by its prefix", () => {
  assert.equal(isBulletinId(SYN), true);
  assert.equal(isSyntheticBulletinId(SYN), true);
  assert.equal(isSyntheticBulletinId(REAL), false);
  assert.deepEqual(bulletinRow({ issued_at: "2024-11-02T08:00:00+09:00", bulletin_id: SYN, wmo_code: "VPWW56", file: `synthetic/15205/${SYN}.xml`, municipality_level: 4, municipality_status: [], alert: { raw_title: "t" } } as unknown as ReplayEntry).synthetic, true);
  assert.equal("synthetic" in bulletinRow({ issued_at: "2026-10-31T16:53:00+09:00", bulletin_id: REAL, wmo_code: "VPWW56", file: "x", municipality_level: 4, municipality_status: [], alert: { raw_title: "t" } } as unknown as ReplayEntry), false);
});

test("a synthetic bulletin is never live, whatever its approvals", () => {
  const dir = path.join(dataDir, "live");
  assert.throws(() => writeLive(SITE, SYN, dir), SyntheticNotLive);
  assert.equal(fs.existsSync(path.join(dir, `${SITE}.json`)), false);
  const at = "2026-11-11T00:00:00Z";
  const approvals = { version: "0.1" as const, layouts: { [`${SITE}/${SYN}`]: { approved: true, updated_at: at, digest: "sha256:a" } }, sites: { [SITE]: { auto_publish: true, updated_at: at } }, classes: { [`${SITE}/landslide/evac-now/4`]: { approved: true, updated_at: at, digest: "sha256:c", approved_from: SYN } } };
  assert.deepEqual(liveLayoutGateWith(approvals, SITE, SYN, "sha256:a", { key: "landslide/evac-now/4", digest: "sha256:c", checked: true }), { gate: "synthetic", by: null });
  assert.equal(liveLayoutGateWith({ ...approvals, layouts: { [`${SITE}/${REAL}`]: approvals.layouts[`${SITE}/${SYN}`] } }, SITE, REAL, "sha256:a").gate, "ok");
});

test("a synthetic row never enters a replay", () => {
  const row = (bulletin_id: string, extra = {}) => ({ issued_at: "2026-10-31T16:53:00+09:00", bulletin_id, raw_title: "t", municipality_level: 4, screen: true, ...extra });
  assert.deepEqual(rowsInWindow([row(REAL), row(SYN), row("VPWW56-x", { synthetic: true })], {}).map((r) => r.bulletin_id), [REAL]);
});

test("export leaves synthetic screens out even when they are approved", async () => {
  fs.mkdirSync(SITES_DIR, { recursive: true });
  fs.writeFileSync(path.join(SITES_DIR, `${SITE}.json`), JSON.stringify({ id: SITE, municipality_id: "15205", lat: 37.36, lng: 138.55 }));
  fs.mkdirSync(path.join(LAYOUTS_DIR, SITE, SYN), { recursive: true });
  fs.writeFileSync(path.join(LAYOUTS_DIR, SITE, SYN, "16x9.json"), "{}");
  fs.writeFileSync(path.join(LAYOUTS_DIR, SITE, "index.json"), JSON.stringify({ municipality: "15205", entries: [{ issued_at: "2024-11-02T08:00:00+09:00", bulletin_id: SYN, screen: true, synthetic: true }] }));
  fs.writeFileSync(APPROVALS_FILE, JSON.stringify({ version: "0.1", layouts: { [`${SITE}/${SYN}`]: { approved: true, updated_at: "2026-11-11T00:00:00Z" } }, sites: { [SITE]: { auto_publish: true, updated_at: "2026-11-11T00:00:00Z" } } }));
  await assert.rejects(exportSite({ site: SITE, out: path.join(dataDir, "dist"), baseUrl: "http://127.0.0.1:9" }), (e: Error) => e instanceof ExportStop && /no browser-verified screens/.test(e.message));
  assert.equal(fs.existsSync(path.join(dataDir, "dist")), false);
});
