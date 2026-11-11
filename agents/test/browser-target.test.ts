import { test } from "node:test";
import assert from "node:assert/strict";
import { isTrustedLayoutSrc } from "../../app/layout/trust";
import { PREVIEW_LAYOUT_PATH, previewRequestAction, previewSrc } from "../src/delivery/preview.js";
import { screenUrl, verifierSrc } from "../src/verifier/browser.js";

const BASE = "http://127.0.0.1:3188";
const LAYOUT = JSON.stringify({ shape: "16x9", municipality: { id: "17204" }, alert: { bulletin_id: "VPWW56-202610311653-b3fa1b3a2ced" } });
const OTHER = JSON.stringify({ shape: "9x16", municipality: { id: "17204" }, alert: { bulletin_id: "VPWW56-202610311653-b3fa1b3a2ced" } });

test("the browser Verifier points the screen at a src production accepts, named by the layout and nothing else", () => {
  const src = verifierSrc(LAYOUT);
  assert.ok(src.startsWith(`${PREVIEW_LAYOUT_PATH}?`));
  assert.equal(isTrustedLayoutSrc(src, false), true);
  const query = new URL(src, BASE).searchParams;
  assert.equal(query.has("site"), false);
  assert.equal(query.has("bulletin"), false);
  assert.equal(query.has("municipality"), false);
  assert.equal(verifierSrc(LAYOUT), src, "the same layout gives the same src");
  assert.notEqual(verifierSrc(OTHER), src);
});

test("the screen URL carries the src for a layout body, the fixture name otherwise, and the virtual clock in both", () => {
  const body = new URL(screenUrl({ baseUrl: BASE, layoutJson: LAYOUT, variant: 0 }, "16x9", { clock: "virtual", t: "333" }));
  assert.equal(body.origin, BASE);
  assert.equal(body.pathname, "/screen");
  assert.equal(body.searchParams.get("src"), verifierSrc(LAYOUT));
  assert.equal(body.searchParams.has("layout"), false);
  assert.equal(body.searchParams.get("shape"), "16x9");
  assert.equal(body.searchParams.get("clock"), "virtual");
  assert.equal(body.searchParams.get("t"), "333");

  const fixture = new URL(screenUrl({ baseUrl: BASE, layout: "wajima-tsunami", variant: 1 }, "9x16"));
  assert.equal(fixture.searchParams.get("layout"), "wajima-tsunami");
  assert.equal(fixture.searchParams.get("variant"), "1");
  assert.equal(fixture.searchParams.has("src"), false);
});

test("inside the browser only the Verifier's own src is answered; other admin paths and other origins are cut off", () => {
  const src = verifierSrc(LAYOUT);
  const args = { baseUrl: BASE, src };
  assert.equal(previewRequestAction(`${BASE}${src}`, args), "respond");
  assert.equal(previewRequestAction(`${BASE}${verifierSrc(OTHER)}`, args), "abort", "another layout's src never reaches the server");
  assert.equal(previewRequestAction(`${BASE}${previewSrc("17204-demo", "VPWW56-202610311653-b3fa1b3a2ced", "16x9")}`, args), "abort");
  assert.equal(previewRequestAction(`${BASE}/api/admin/sites/17204-demo`, args), "abort");
  assert.equal(previewRequestAction(`https://example.org${src}`, args), "abort");
  assert.equal(previewRequestAction(`${BASE}/screen?shape=16x9&src=${encodeURIComponent(src)}`, args), "continue");
  assert.equal(previewRequestAction(`${BASE}/_nuxt/entry.js`, args), "continue");
});
