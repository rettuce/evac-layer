import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LAYOUTS_DIR } from "../src/paths.js";
import { formatErrors, validateDoc } from "../src/schemas.js";
import { mergeEntries } from "../src/delivery/export.js";
import { exportGate, migrateApprovalKeys, readApprovals, type Approvals } from "../src/delivery/gate.js";
import { holdsFacilities } from "../src/tokens.js";

const layout = (shape: string) => JSON.parse(fs.readFileSync(path.join(LAYOUTS_DIR, `05210-demo-honjo-station/VXKOii-202610211815-e713da0e3c05/${shape}.json`), "utf8"));
const site = { id: "05210-demo-honjo-station", municipality_id: "05210" };
const ambient = { feed_version: "0.1", site, state: "ambient", alert: null, bulletin_id: null, issued_at: null, layouts: {}, assets: {}, sources: [], approved_at: null };
const alertFeed = () => {
  const l = layout("16x9");
  return {
    feed_version: "0.1", site, state: "alert",
    alert: { ...l.alert, template: l.template },
    bulletin_id: l.alert.bulletin_id, issued_at: l.alert.issued_at,
    layouts: { "16x9": l, "1x1": layout("1x1") },
    assets: { "16x9": { png: "/assets/x/16x9.png", html: "/assets/x/16x9.html" } },
    sources: l.sources, approved_at: "2026-11-02T07:00:00Z",
  };
};

test("ambient feed validates and carries no layouts", () => {
  const r = validateDoc(ambient);
  assert.equal(r.schema, "feed");
  assert.ok(r.ok, formatErrors(r.errors));
  assert.equal(validateDoc({ ...ambient, layouts: { "16x9": layout("16x9") } }).ok, false);
});

test("alert feed validates with layouts that are valid screens", () => {
  const r = validateDoc(alertFeed());
  assert.ok(r.ok, formatErrors(r.errors));
  const broken = alertFeed();
  delete (broken.layouts["16x9"] as Record<string, unknown>).palette;
  assert.equal(validateDoc(broken).ok, false);
  assert.equal(validateDoc({ ...alertFeed(), approved_at: null }).ok, false);
});

test("export follows the live gate: auto publish on and the bulletin approved", () => {
  const a: Approvals = { version: "0.1", layouts: { "S/B1": { approved: true, updated_at: "t" }, "S/B2": { approved: false, updated_at: "t" }, "T/B1": { approved: true, updated_at: "t" } }, sites: { S: { auto_publish: true, updated_at: "t" }, T: { auto_publish: false, updated_at: "t" }, V: { auto_publish: true, updated_at: "t" } } };
  assert.equal(exportGate(a, "S", "B1").gate, "ok");
  assert.equal(exportGate(a, "S", "B2").gate, "unapproved");
  assert.equal(exportGate(a, "T", "B1").gate, "auto-publish-off");
  assert.equal(exportGate(a, "U", "B1").gate, "auto-publish-off");
  assert.equal(exportGate(a, "V", "B1").gate, "unapproved", "an approval belongs to one site, not to its municipality");
  const bound: Approvals = { ...a, layouts: { ...a.layouts, "S/B3": { approved: true, updated_at: "2026-11-05T00:00:00Z", digest: "sha256:aa" } } };
  assert.equal(exportGate(bound, "S", "B3", "sha256:aa").gate, "ok");
  assert.equal(exportGate(bound, "S", "B3", "sha256:bb").gate, "stale");
  assert.equal(exportGate(a, "S", "B1", "sha256:aa").gate, "stale");
});

test("old <municipality>/<bulletin> approvals map to the municipality's only site and are dropped when it has two", () => {
  const site = (id: string, municipality_id: string, replay?: { municipality: string }) => ({ id, municipality_id, lat: 0, lng: 0, facing_deg: 0, ...(replay ? { replay: { ...replay, from: "a", to: "b", speed: 1 } } : {}) });
  const a: Approvals = { version: "0.1", sites: {}, layouts: {
    "05210/B1": { approved: true, updated_at: "old" },
    "17204/B2": { approved: true, updated_at: "t" },
    "99999/B3": { approved: true, updated_at: "t" },
    "one-site/B1": { approved: false, updated_at: "new" },
  } };
  const warnings: string[] = [];
  const m = migrateApprovalKeys(a, [site("one-site", "05210"), site("w-a", "17204"), site("w-b", "17204"), site("borrow", "01100", { municipality: "99999" })], (w) => warnings.push(w));
  assert.deepEqual(Object.keys(m.layouts).sort(), ["borrow/B3", "one-site/B1"]);
  assert.equal(m.layouts["one-site/B1"].updated_at, "new", "a key already written per site wins over the old one");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /17204\/B2.*2 sites/);
});

test("exporting some bulletins replaces their manifest entries, keeps the other approved ones and drops what is no longer approved", () => {
  const entry = (bulletin_id: string, approved_at: string) => ({ bulletin_id, approved_at });
  const kept = [entry("B1", "old"), entry("B2", "old"), entry("B3", "old")];
  assert.deepEqual(mergeEntries(kept, [entry("B2", "new"), entry("B4", "new")], ["B1", "B2", "B4"]), [entry("B1", "old"), entry("B2", "new"), entry("B4", "new")]);
  assert.deepEqual(mergeEntries([], [entry("B2", "new")], ["B1", "B2"]), [entry("B2", "new")]);
});

test("old <municipality>/<bulletin> approvals are not read as a site's once the token ledger holds facility tokens or is broken", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evac-legacy-gate-"));
  try {
    const approvalsFile = path.join(dir, "approvals.json");
    const tokensFile = path.join(dir, "tokens.json");
    const digest = "sha256:aa";
    fs.writeFileSync(approvalsFile, JSON.stringify({ version: "0.1", sites: { "one-site": { auto_publish: true, updated_at: "t" } }, layouts: { "05210/B1": { approved: true, updated_at: "t", digest } } }));
    const sites = [{ id: "one-site", municipality_id: "05210", lat: 0, lng: 0, facing_deg: 0 }];
    const gateWith = () => exportGate(readApprovals(approvalsFile, sites, holdsFacilities(tokensFile)), "one-site", "B1", digest).gate;

    assert.equal(gateWith(), "ok", "no ledger");
    fs.writeFileSync(tokensFile, JSON.stringify({ version: "0.1", tokens: [] }));
    assert.equal(gateWith(), "ok", "an empty ledger");
    const token = { id: "t1", label: "alpha signage", facility_id: "alpha-fac", sha256: "a".repeat(64), created_at: "2026-11-01T00:00:00Z" };
    fs.writeFileSync(tokensFile, JSON.stringify({ version: "0.1", tokens: [token] }));
    assert.equal(gateWith(), "unapproved", "a facility token");
    fs.writeFileSync(tokensFile, "not json");
    assert.equal(gateWith(), "unapproved", "a broken ledger");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
