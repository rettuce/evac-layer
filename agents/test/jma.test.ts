import { SAMPLES_DIR, FEED_DIR } from "../src/paths.js";
import { test } from "node:test";
import { needsRaw } from "./raw.js";
import { replay } from "../src/jma/replay.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseJmaXml, type Alert } from "../src/jma/parse.js";
import { formatErrors, validateDoc } from "../src/schemas.js";
import { tsunamiRegionsFor } from "../src/jma/regions.js";

// The official JMA sample bulletins are not redistributed in this repository; point JMA_SAMPLES_DIR at the unzipped
// jmaxml_20260917_Samples.zip (https://xml.kishou.go.jp/).

function load(name: string): Alert {
  const file = path.join(SAMPLES_DIR, name);
  if (!fs.existsSync(file)) {
    throw new Error(`JMA sample ${file} not found. Set JMA_SAMPLES_DIR to the unzipped official samples.`);
  }
  const alert = parseJmaXml(fs.readFileSync(file));
  const r = validateDoc(alert, "alert");
  assert.ok(r.ok, formatErrors(r.errors));
  return alert;
}

const area = (a: Alert, name: string) => a.areas.find((x) => x.name === name) ?? assert.fail(`no area ${name}`);

test("VPWW55 heavy rain: per-city levels, highest level in force", { skip: needsRaw({ samples: ["15_17_01_251222_VPWW55.xml"] }) }, () => {
  const a = load("15_17_01_251222_VPWW55.xml");
  assert.equal(a.code, "VPWW55");
  assert.equal(a.hazard, "heavy_rain");
  assert.equal(a.level, 3);
  assert.equal(a.issued_at, "2024-11-02T11:19:00+09:00");
  assert.equal(a.raw_title, "島根県大雨警報・注意報");
  assert.deepEqual(
    [area(a, "松江市").level, area(a, "松江市").status, area(a, "松江市").code],
    [3, "continued", "3220100"],
  );
  assert.equal(area(a, "奥出雲町").level, 2);
  assert.ok(a.areas.every((x) => x.code_type === "city"));
});

test("VPWW56 landslide: an upgrade from level 2 to level 4 is reported", { skip: needsRaw({ samples: ["15_17_01_251222_VPWW56.xml"] }) }, () => {
  const a = load("15_17_01_251222_VPWW56.xml");
  assert.equal(a.hazard, "landslide");
  assert.equal(a.level, 4);
  assert.deepEqual([area(a, "雲南市").level, area(a, "雲南市").status], [4, "upgraded"]);
  assert.deepEqual([area(a, "海士町").level, area(a, "海士町").status], [null, "none"]);
});

test("VXKOii flood: city level comes from the station that covers it", { skip: needsRaw({ samples: ["16_11_01_260312_VXKOii.xml"] }) }, () => {
  const a = load("16_11_01_260312_VXKOii.xml");
  assert.equal(a.hazard, "flood");
  assert.equal(a.level, 5);
  assert.equal(a.raw_title, "最上川中流レベル５氾濫特別警報");
  assert.equal(area(a, "戸沢村").level, 5);
  assert.equal(area(a, "村山市").level, 2);
});

test("VXKOii clearance yields no level", { skip: needsRaw({ samples: ["16_14_01_251222_VXKOii.xml"] }) }, () => {
  const a = load("16_14_01_251222_VXKOii.xml");
  assert.equal(a.level, null);
  assert.ok(a.areas.every((x) => x.status === "cleared"));
});

test("VTSE41 tsunami: forecast regions, no five-level value, major warning summary", { skip: needsRaw({ samples: ["32-39_11_02_250206_VTSE41.xml"] }) }, () => {
  const a = load("32-39_11_02_250206_VTSE41.xml");
  assert.equal(a.hazard, "tsunami");
  assert.equal(a.level, null);
  assert.equal(a.tsunami?.highest_category, "major_warning");
  const miyagi = area(a, "宮城県");
  assert.deepEqual([miyagi.code, miyagi.code_type, miyagi.status, miyagi.kind_code], ["220", "tsunami_forecast_region", "issued", "53"]);
  assert.ok(a.headline_text.startsWith("東日本大震災クラスの津波が来襲します。"));
});

test("VTSE41 cancellation has no areas", { skip: needsRaw({ samples: ["38-39_03_01_210805_VTSE41.xml"] }) }, () => {
  const a = load("38-39_03_01_210805_VTSE41.xml");
  assert.equal(a.info_type, "cancelled");
  assert.deepEqual(a.areas, []);
  assert.equal(a.tsunami?.highest_category, "none");
});

test("same bulletin bytes give the same alert", { skip: needsRaw({ samples: ["15_17_01_251222_VPWW55.xml"] }) }, () => {
  assert.deepEqual(load("15_17_01_251222_VPWW55.xml"), load("15_17_01_251222_VPWW55.xml"));
});

test("demo municipalities map to tsunami forecast regions", () => {
  assert.deepEqual(tsunamiRegionsFor("17204"), ["360"]);
  assert.deepEqual(tsunamiRegionsFor("22424"), ["380"]);
  assert.deepEqual(tsunamiRegionsFor("14100"), ["312"]);
});


const WAJIMA_DOWNGRADE = "bodies/20261021/20261021061124_0_VPWW55_170000.xml";
test("recorded feed: a warning-to-advisory step for 輪島市 parses as a downgrade", { skip: needsRaw({ feed: [WAJIMA_DOWNGRADE] }) }, () => {
  const file = path.join(FEED_DIR, WAJIMA_DOWNGRADE);
  const a = parseJmaXml(fs.readFileSync(file));
  assert.ok(validateDoc(a, "alert").ok);
  const wajima = area(a, "輪島市");
  assert.deepEqual([wajima.level, wajima.status], [2, "downgraded"]);
});

test("輪島 replays the three official VTSE41 samples listed in data/samples/17204.json after its feed", { skip: needsRaw({ feedRoot: true, samplesOf: ["17204"] }) }, () => {
  const { entries, errors } = replay("17204");
  assert.deepEqual(errors, []);
  const samples = entries.filter((e) => e.file.startsWith("jma-samples/"));
  assert.deepEqual(samples.map((e) => e.bulletin_id), ["VTSE41-201609010713-ff3dd5d5c94f", "VTSE41-201609010726-05a7380a3e46", "VTSE41-201609010955-5a813306d772"]);
  assert.deepEqual(samples.map((e) => e.municipality_status), [["issued"], ["continued"], ["cleared"]]);
});

test("吉田町 replays the same three samples; 静岡県 is under 大津波警報, then downgraded", { skip: needsRaw({ feedRoot: true, samplesOf: ["22424"] }) }, () => {
  const { entries, errors } = replay("22424");
  assert.deepEqual(errors, []);
  const samples = entries.filter((e) => e.file.startsWith("jma-samples/"));
  assert.deepEqual(samples.map((e) => e.municipality_status), [["issued"], ["continued"], ["downgraded"]]);
});
