import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LAYOUT_STORE_PREFIXES, isTrustedLayoutSrc } from "../../app/layout/trust";
import { REPO_ROOT } from "../src/paths.js";
import { ExportStop } from "../src/delivery/capture.js";
import { PREVIEW_LAYOUT_PATH, previewPlan, previewRequestAction, previewSrc } from "../src/delivery/preview.js";

const SYN = "SYN-VPWW56-202411020800-314b561ca69f";
const REAL = "VPWW56-202610311653-b3fa1b3a2ced";
const SITE = "preview-site";

function roots() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evac-preview-"));
  const layouts = path.join(root, "layouts");
  const previews = path.join(root, "previews");
  for (const bulletin of [SYN, REAL]) {
    const dir = path.join(layouts, SITE, bulletin);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "16x9.json"), "{}");
    fs.writeFileSync(path.join(dir, "1x1.json"), "{}");
  }
  return { root, layouts, previews };
}

test("a preview of a synthetic bulletin is planned for every shape that has a layout", () => {
  const r = roots();
  const out = path.join(r.previews, SITE, `.${SYN}.staging`);
  const plan = previewPlan({ site: SITE, bulletin: SYN, out }, r);
  assert.equal(plan.bulletin, SYN);
  assert.equal(plan.out, out);
  assert.deepEqual(plan.shapes.map((s) => s.shape).sort(), ["16x9", "1x1"]);
  assert.equal(plan.shapes[0]!.layoutFile, path.join(r.layouts, SITE, SYN, `${plan.shapes[0]!.shape}.json`));
  assert.equal(previewPlan({ site: SITE, bulletin: REAL, out }, r).bulletin, REAL, "an unapproved real bulletin can be previewed too");
  fs.rmSync(r.root, { recursive: true, force: true });
});

test("a preview is written only under the previews directory, never into the delivery files", () => {
  const r = roots();
  const refused = [
    path.join(REPO_ROOT, "dist", SITE, SYN),
    path.join(r.root, "dist", SITE, SYN),
    r.previews,
    path.join(r.previews, "..", "elsewhere"),
  ];
  for (const out of refused) assert.throws(() => previewPlan({ site: SITE, bulletin: SYN, out }, r), ExportStop, out);
  fs.rmSync(r.root, { recursive: true, force: true });
});

test("a preview needs a valid site, bulletin and layouts", () => {
  const r = roots();
  const out = path.join(r.previews, SITE, "x");
  assert.throws(() => previewPlan({ site: "../x", bulletin: SYN, out }, r), ExportStop);
  assert.throws(() => previewPlan({ site: SITE, bulletin: "a/b", out }, r), ExportStop);
  assert.throws(() => previewPlan({ site: SITE, bulletin: SYN }, r), ExportStop);
  assert.throws(() => previewPlan({ site: SITE, bulletin: "NO-LAYOUTS", out }, r), /no layouts/);
  fs.rmSync(r.root, { recursive: true, force: true });
});

test("a preview follows no symbolic link out of the previews or layouts directories", () => {
  const r = roots();
  const outside = path.join(r.root, "outside");
  fs.mkdirSync(outside, { recursive: true });
  fs.mkdirSync(r.previews, { recursive: true });
  fs.symlinkSync(outside, path.join(r.previews, SITE));
  assert.throws(() => previewPlan({ site: SITE, bulletin: SYN, out: path.join(r.previews, SITE, "x") }, r), ExportStop, "an out directory behind a link");
  fs.rmSync(path.join(r.previews, SITE));
  const layout = path.join(r.layouts, SITE, SYN, "16x9.json");
  fs.rmSync(layout);
  fs.writeFileSync(path.join(outside, "16x9.json"), "{}");
  fs.symlinkSync(path.join(outside, "16x9.json"), layout);
  assert.throws(() => previewPlan({ site: SITE, bulletin: SYN, out: path.join(r.previews, SITE, "x") }, r), ExportStop, "a layout file that is a link");
  fs.rmSync(r.root, { recursive: true, force: true });
});

test("the screen is pointed at the preview layout path, which the renderer accepts in production", () => {
  const src = previewSrc(SITE, SYN, "16x9");
  assert.ok(src.startsWith(`${PREVIEW_LAYOUT_PATH}?`));
  assert.ok(LAYOUT_STORE_PREFIXES.some((prefix) => src.startsWith(prefix)));
  assert.equal(isTrustedLayoutSrc(src, false), true);
});

test("inside the browser the preview layout is answered from the file and no other admin path reaches the server", () => {
  const base = "http://127.0.0.1:3150";
  const src = previewSrc(SITE, SYN, "16x9");
  assert.equal(previewRequestAction(`${base}${src}`, { baseUrl: base, src }), "respond");
  assert.equal(previewRequestAction(`${base}${previewSrc(SITE, REAL, "16x9")}`, { baseUrl: base, src }), "abort");
  assert.equal(previewRequestAction(`${base}/api/admin/catalog`, { baseUrl: base, src }), "abort");
  assert.equal(previewRequestAction(`${base}/api/admin/sites/${SITE}`, { baseUrl: base, src }), "abort");
  assert.equal(previewRequestAction(`${base}/screen?shape=16x9`, { baseUrl: base, src }), "continue");
  assert.equal(previewRequestAction(`${base}/_nuxt/entry.js`, { baseUrl: base, src }), "continue");
  assert.equal(previewRequestAction(`https://example.org${src}`, { baseUrl: base, src }), "abort", "another origin is never served the layout");
  assert.equal(previewRequestAction("https://example.org/font.woff2", { baseUrl: base, src }), "abort", "nothing leaves this server");
});
