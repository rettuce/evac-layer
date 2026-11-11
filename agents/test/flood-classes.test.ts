import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoData = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "evac-flood-classes-"));
for (const dir of ["jma", "municipalities"]) fs.cpSync(path.join(repoData, dir), path.join(dataDir, dir), { recursive: true });
process.env.EVAC_DATA_DIR = dataDir;

const { AGENTS_DIR, NO_FLOOD_FORECAST_FILE } = await import("../src/paths.js");
const { classListing } = await import("../src/jma/synthetic-classes.js");
const { mentionsMunicipality } = await import("../src/jma/feed.js");
const { parseJmaXml } = await import("../src/jma/parse.js");
const { generateSite, generationFile } = await import("../src/loop/generation.js");
const { staticVerifier } = await import("../src/loop/static-verifier.js");
import type { SiteFile } from "../src/sites.js";

const FLOOD = ["flood/evac-prepare/3", "flood/evac-now/4", "flood/secure-now/5", "flood/all-clear/1"];
const SIX = ["heavy_rain/evac-prepare/3", "heavy_rain/evac-now/4", "heavy_rain/all-clear/1", "landslide/evac-prepare/3", "landslide/evac-now/4", "landslide/all-clear/1"];
const HELD = ["heavy_rain/secure-now/5", "landslide/secure-now/5"];
const TSUNAMI = ["tsunami/evac-now/2", "tsunami/evac-now/3", "tsunami/evac-now/4", "tsunami/all-clear/1"];

test("the table of municipalities checked to have no flood forecast area lists 柏崎市 alone, with its sources", () => {
  assert.equal(path.relative(dataDir, NO_FLOOD_FORECAST_FILE), path.join("jma", "no-flood-forecast-areas.json"));
  const table = JSON.parse(fs.readFileSync(path.join(repoData, "jma", "no-flood-forecast-areas.json"), "utf8"));
  assert.deepEqual(Object.keys(table.municipalities), ["15205"]);
  assert.equal(table.municipalities["15205"].name, "柏崎市");
  for (const url of [
    "https://www.jma.go.jp/jma/kishou/know/kijun/niigata/kijun_1520500.pdf",
    "https://www.jma.go.jp/jma/kishou/know/kijun/niigata/3_niigata.csv",
    "https://www.data.jma.go.jp/niigata/menu/bousai/flood_forecast.html",
  ]) assert.ok(table.source.includes(url), url);
  const notes = table.municipalities["15205"].notes.join("\n");
  assert.match(notes, /https:\/\/www\.mlit\.go\.jp\/river\/toukei_chousa\/kasen_db\/pdf\/2026\/12-1-4\.pdf/);
  assert.match(notes, /https:\/\/www\.jma\.go\.jp\/jma\/kishou\/know\/kijun\/niigata\/level_flood_niigata\.csv/);
});

test("柏崎市 lists no flood class: the six heavy-rain and landslide classes, the held level 5 and the four tsunami classes", () => {
  const listing = classListing("15205");
  assert.deepEqual(listing.map((c) => [c.cls, c.supported]), [...SIX.map((c) => [c, true]), ...HELD.map((c) => [c, false]), ...TSUNAMI.map((c) => [c, true])]);
});

test("a municipality not in the table keeps the four flood classes as unsupported, with the reason", () => {
  const flood = classListing("17204").filter((c) => c.cls.startsWith("flood/"));
  assert.deepEqual(flood.map((c) => [c.cls, c.supported]), FLOOD.map((c) => [c, false]));
  for (const c of flood) assert.ok(!c.supported && c.reason.length > 10, c.cls);
});

test("a flood forecast that names 柏崎市 still reaches it: the table is not read by receiving", () => {
  const sample = fs.readFileSync(path.join(AGENTS_DIR, "test", "fixtures", "jma", "jma-samples", "16_11_01_260312_VXKOii.xml"), "utf8");
  const xml = sample.replace("<City>大蔵村</City>\n            <CityCode>0636500</CityCode>", "<City>柏崎市</City>\n            <CityCode>1520500</CityCode>");
  assert.notEqual(xml, sample);
  assert.ok(mentionsMunicipality(xml, "VXKO55", "15205"));
  assert.ok(parseJmaXml(xml).areas.some((a) => a.code === "1520500"));
});

test("generate writes no flood row for the 柏崎市 site", async () => {
  const site = JSON.parse(fs.readFileSync(path.join(repoData, "sites", "15205-demo.json"), "utf8")) as SiteFile;
  const g = await generateSite({ site, verifier: staticVerifier, writer: { kind: "placeholder" } });
  const written = JSON.parse(fs.readFileSync(generationFile(site.id), "utf8")) as { composable: string[]; classes: { class: string }[] };
  assert.deepEqual(written.classes.map((c) => c.class), [...SIX, ...HELD, ...TSUNAMI]);
  assert.deepEqual(written.composable, [...SIX, ...TSUNAMI]);
  assert.ok(!g.classes.some((c) => c.class.startsWith("flood/")));
});
