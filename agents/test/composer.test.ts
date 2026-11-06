import { SAMPLES_DIR, FEED_DIR } from "../src/paths.js";
import { test } from "node:test";
import { needsRaw } from "./raw.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { compose, pickShelter, type Municipality, type Site, type WriterOutput } from "../src/composer/compose.js";
import { CELLS_OF, ComposerStop } from "../src/composer/rules.js";
import { shapeContract } from "../src/composer/template.js";
import { parseJmaXml } from "../src/jma/parse.js";
import { formatErrors, validateDoc } from "../src/schemas.js";
import { AGENTS_DIR, REPO_ROOT } from "../src/paths.js";
import { loadMunicipality } from "../src/loop/municipality.js";
import type { Alert } from "../src/jma/parse.js";

const fx = <T>(name: string): T => JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, "test/fixtures", name), "utf8"));
const municipality = fx<Municipality>("municipality-17204-min.json");
const site = fx<Site>("site-wajima-test.json");
const writer = fx<WriterOutput>("writer-tsunami-advisory.json");
const ADVISORY = "32-39_12_02_250206_VTSE41.xml";
const NEEDS_ADVISORY = needsRaw({ samples: [ADVISORY] });
const advisory = () => parseJmaXml(fs.readFileSync(path.join(SAMPLES_DIR, ADVISORY)));

test("tsunami advisory for 石川県能登 composes five valid layouts at display level 2", { skip: NEEDS_ADVISORY }, () => {
  const screens = compose({ alert: advisory(), municipality, site, writer });
  assert.deepEqual(screens.map((s) => s.shape), ["16x9", "9x16", "32x9", "1x1", "pillar"]);
  for (const s of screens) {
    const r = validateDoc(s, "layout");
    assert.ok(r.ok, `${s.shape}\n${formatErrors(r.errors)}`);
    assert.equal(s.alert.level, 2);
    assert.equal(s.template, "evac-now");
  }
});

test("level 5 (secure-now) keeps the nearest site and the direction beside the go-higher action", () => {
  const koyoshi = fx<{ entries: { alert: Alert; municipality_level: number | null; bulletin_id: string }[] }>("replay-05210-koyoshi-20261021.json");
  const lv5 = koyoshi.entries.find((e) => e.municipality_level === 5)!;
  const { municipality: yurihonjo } = loadMunicipality("05210");
  const honjo = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/sites/05210-demo-honjo-station.json"), "utf8")) as Site;
  const cached = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/writer/05210", `${lv5.bulletin_id}.json`), "utf8")).output as WriterOutput;
  const screens = compose({ alert: lv5.alert, municipality: yurihonjo, site: honjo, writer: cached });
  for (const s of screens) {
    assert.equal(s.template, "secure-now");
    assert.ok(s.sources.some((x) => x.type === "gsi"), `${s.shape}: the guide was not computed`);
    assert.equal(s.cells.find((c) => c.role === "action")!.pictogram, "go_higher");
    const { slots } = shapeContract("secure-now", CELLS_OF[s.shape]);
    if (slots.has("shelter")) assert.ok(s.cells.some((c) => c.role === "shelter") && s.cells.some((c) => c.role === "direction"), `${s.shape}: shelter and direction expected`);
  }
});

test("shelter is the nearest undisputed tsunami site; distance appears once, on the shelter cell", { skip: NEEDS_ADVISORY }, () => {
  const [landscape] = compose({ alert: advisory(), municipality, site, writer });
  const shelter = landscape.cells.find((c) => c.role === "shelter")!;
  const direction = landscape.cells.find((c) => c.role === "direction")!;
  assert.equal(shelter.text.ja, "ホテル　ルートイン輪島");
  assert.equal((shelter as { kind?: string }).kind, "emergency_evacuation_site");
  assert.equal(shelter.distance_m, 800);
  assert.ok(shelter.distance_m! > 0 && shelter.distance_m! % 10 === 0);
  assert.ok(!/\d+\s*m/.test(direction.text.ja));
  assert.equal(direction.rotation, 180);
});

test("every emitted cell has a slot in the render template", { skip: NEEDS_ADVISORY }, () => {
  for (const screen of compose({ alert: advisory(), municipality, site, writer })) {
    const { slots } = shapeContract("evac-now", CELLS_OF[screen.shape]);
    for (const c of screen.cells) assert.ok(slots.has(c.role), `${screen.shape} ${c.role}`);
  }
});

test("same inputs produce identical output", { skip: NEEDS_ADVISORY }, () => {
  assert.deepEqual(compose({ alert: advisory(), municipality, site, writer }), compose({ alert: advisory(), municipality, site, writer }));
});

test("a shelter named in a conflict is never chosen", () => {
  const m = { ...municipality, conflicts: [{ gsi_candidates: ["ホテル　ルートイン輪島"] }] };
  assert.equal(pickShelter(m, site, "tsunami").shelter.name, "輪島市健康ふれあい広場");
});

test("text over the shape budget stops composition instead of truncating", { skip: NEEDS_ADVISORY }, () => {
  const long = structuredClone(writer);
  long.cells[1].text.ja = "ただちに海岸から離れて高台へ";
  assert.throws(() => compose({ alert: advisory(), municipality, site, writer: long }), ComposerStop);
});

test("a bulletin that does not cover the municipality stops", { skip: needsRaw({ samples: ["32-39_11_02_250206_VTSE41.xml"] }) }, () => {
  const other = parseJmaXml(fs.readFileSync(path.join(SAMPLES_DIR, "32-39_11_02_250206_VTSE41.xml")));
  assert.throws(() => compose({ alert: other, municipality, site, writer }), /does not cover/);
});

test("a city the bulletin lists without a level stops instead of falling below the threshold", { skip: needsRaw({ samples: ["16_11_03_260312_VXKOii.xml"] }) }, () => {
  const alert = parseJmaXml(fs.readFileSync(path.join(SAMPLES_DIR, "16_11_03_260312_VXKOii.xml")));
  assert.equal(alert.areas.find((a) => a.name === "村山市")?.level, null);
  assert.throws(() => compose({ alert, municipality: { ...municipality, id: "06208" }, site: { ...site, municipality_id: "06208" }, writer }), /gives no level for 村山市/);
});

test("action pictogram follows the template", async () => {
  const { actionPictogram } = await import("../src/composer/rules.js");
  assert.equal(actionPictogram("flood", "all-clear"), "safe_here");
  assert.equal(actionPictogram("flood", "evac-now"), "directions_run");
  assert.equal(actionPictogram("heavy_rain", "evac-prepare"), "directions_run");
  assert.equal(actionPictogram("landslide", "evac-prepare"), "directions_run");
  assert.equal(actionPictogram("flood", "secure-now"), "go_higher");
  assert.equal(actionPictogram("tsunami", "evac-now"), "go_higher");
});

const CLEARED_VPWW56 = "bodies/20261021/20261021150027_0_VPWW56_170000.xml";
test("a cleared VPWW headline says 解除", { skip: needsRaw({ feed: [CLEARED_VPWW56] }) }, async () => {
  const { headlineFor } = await import("../src/composer/compose.js");
    const file = path.join(FEED_DIR, CLEARED_VPWW56);
  assert.equal(headlineFor(parseJmaXml(fs.readFileSync(file)), "17204"), "レベル２土砂災害注意報解除");
});

test("pillar carries the 9:16 cells and is validated as a layout", { skip: NEEDS_ADVISORY }, async () => {
  const { validateDoc } = await import("../src/schemas.js");
  const screens = compose({ alert: advisory(), municipality, site, writer });
  const pillar = screens.find((x) => x.shape === "pillar")!;
  const portrait = screens.find((x) => x.shape === "9x16")!;
  assert.deepEqual({ ...pillar, shape: "9x16" }, portrait);
  assert.ok(pillar.cells.some((c) => c.role === "languages"));
  assert.ok(validateDoc(pillar, "layout").ok);
  assert.equal(validateDoc({ ...pillar, cells: pillar.cells.filter((c) => c.role !== "languages") }, "layout").ok, false);
});

test("the source cell names the issuer, its time and the municipality; the details stay in sources[]", { skip: NEEDS_ADVISORY }, () => {
  const [landscape] = compose({ alert: advisory(), municipality, site, writer });
  const source = landscape.cells.find((c) => c.id === "source")!;
  assert.match(source.text.ja, /^気象庁 \d{1,2}\/\d{1,2} \d{2}:\d{2} 発表・輪島市$/);
  assert.match(source.text.en!, /^JMA \d{2}:\d{2}, [A-Z][a-z]{2} \d{1,2} · Wajima$/);
  assert.ok(landscape.sources.some((s) => s.type === "jma" && s.bulletin_id === landscape.alert.bulletin_id));
});

test("a designated-river flood forecast (VXKO) names both issuers, JMA and MLIT, in the source cell", { skip: NEEDS_ADVISORY }, () => {
  const [landscape] = compose({ alert: { ...advisory(), code: "VXKOii" }, municipality, site, writer });
  const source = landscape.cells.find((c) => c.id === "source")!;
  assert.match(source.text.ja, /^気象庁・国土交通省 \d{1,2}\/\d{1,2} \d{2}:\d{2} 発表・輪島市$/);
  assert.match(source.text.en!, /^JMA · MLIT \d{2}:\d{2}, [A-Z][a-z]{2} \d{1,2} · Wajima$/);
});

test("a drill bulletin gets 【訓練】 in front of the headline", { skip: NEEDS_ADVISORY }, () => {
  const alert = advisory();
  assert.equal(alert.status, "drill");
  const [landscape] = compose({ alert, municipality, site, writer });
  assert.equal(landscape.cells.find((c) => c.id === "headline")!.text.ja, "【訓練】津波注意報");
  const real = compose({ alert: { ...alert, status: "normal" as const }, municipality, site, writer });
  assert.equal(real[0].cells.find((c) => c.id === "headline")!.text.ja, "津波注意報");
});

test("a newly issued tsunami warning's headline drops the ：発表 suffix of the JMA kind name", { skip: NEEDS_ADVISORY }, () => {
  const alert = advisory();
  assert.equal(alert.areas.find((a) => a.code === "380")!.kind_name, "大津波警報：発表");
  const shizuoka = { ...municipality, id: "22424", name: "吉田町" };
  const [landscape] = compose({ alert, municipality: shizuoka, site: { ...site, municipality_id: "22424" }, writer });
  assert.equal(landscape.cells.find((cell) => cell.id === "headline")!.text.ja, "【訓練】大津波警報");
});

test("a region downgraded to a tsunami forecast gets an all-clear naming the warning that ended", { skip: needsRaw({ samples: ["32-39_12_13_250206_VTSE41.xml"] }) }, () => {
  const downgraded = parseJmaXml(fs.readFileSync(path.join(SAMPLES_DIR, "32-39_12_13_250206_VTSE41.xml")));
  const shizuoka = { ...municipality, id: "22424", name: "吉田町" };
  const [landscape] = compose({ alert: downgraded, municipality: shizuoka, site: { ...site, municipality_id: "22424" }, writer });
  assert.equal(landscape.template, "all-clear");
  assert.equal(landscape.cells.find((cell) => cell.id === "headline")!.text.ja, "【訓練】大津波警報解除");
  assert.equal(landscape.cells.find((cell) => cell.id === "action")!.pictogram, "safe_here");
});

test("a tsunami forecast that arrives on its own still composes nothing", { skip: needsRaw({ samples: ["32-39_11_11_250206_VTSE41.xml"] }) }, () => {
  const standalone = parseJmaXml(fs.readFileSync(path.join(SAMPLES_DIR, "32-39_11_11_250206_VTSE41.xml")));
  assert.equal(standalone.areas.find((a) => a.code === "360")!.status, "issued");
  assert.throws(() => compose({ alert: standalone, municipality, site, writer }), ComposerStop);
});
