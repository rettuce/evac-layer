import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../src/paths.js";
import { formatErrors, validateDoc } from "../src/schemas.js";
import { exportable, type Approvals } from "../src/delivery/gate.js";

const layout = (shape: string) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, `data/layouts/05210/VXKOii-202610211815-e713da0e3c05/${shape}.json`), "utf8"));
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
  const a: Approvals = { version: "0.1", layouts: { "05210/B1": { approved: true, updated_at: "t" }, "05210/B2": { approved: false, updated_at: "t" } }, sites: { S: { auto_publish: true, updated_at: "t" }, T: { auto_publish: false, updated_at: "t" } } };
  assert.equal(exportable(a, "S", "05210", "B1"), "ok");
  assert.equal(exportable(a, "S", "05210", "B2"), "unapproved");
  assert.equal(exportable(a, "T", "05210", "B1"), "auto-publish-off");
  assert.equal(exportable(a, "U", "05210", "B1"), "auto-publish-off");
  const bound: Approvals = { ...a, layouts: { ...a.layouts, "05210/B3": { approved: true, updated_at: "2026-11-05T00:00:00Z", digest: "sha256:aa" } } };
  assert.equal(exportable(bound, "S", "05210", "B3", "sha256:aa"), "ok");
  assert.equal(exportable(bound, "S", "05210", "B3", "sha256:bb"), "stale");
  assert.equal(exportable(a, "S", "05210", "B1", "sha256:aa"), "ok");
});
