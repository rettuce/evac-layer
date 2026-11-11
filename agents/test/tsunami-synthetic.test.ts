import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoData = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "evac-tsunami-synthetic-"));
for (const dir of ["jma", "municipalities"]) fs.cpSync(path.join(repoData, dir), path.join(dataDir, dir), { recursive: true });
const easyTable = path.join(dataDir, "jma", "warning-names-ja-easy.json");
fs.writeFileSync(easyTable, JSON.stringify({ ...JSON.parse(fs.readFileSync(easyTable, "utf8")), reviewed: true }), "utf8");
// 由利本荘市 (05210) is taken out of this copy of the region table to stand for a municipality on no tsunami forecast region.
const regionCopy = path.join(dataDir, "jma", "tsunami-regions.json");
const copied = JSON.parse(fs.readFileSync(regionCopy, "utf8"));
for (const r of Object.values(copied.regions) as { municipalities: string[] }[]) r.municipalities = r.municipalities.filter((m) => m !== "05210");
fs.writeFileSync(regionCopy, JSON.stringify(copied));
process.env.EVAC_DATA_DIR = dataDir;

const { APPROVALS_FILE, LAYOUTS_DIR, REPORTS_DIR, SAMPLES_DIR } = await import("../src/paths.js");
const { classListing } = await import("../src/jma/synthetic-classes.js");
const { synthesizeXml, TEMPLATES_DIR } = await import("../src/jma/synthetic.js");
const { parseJmaXml } = await import("../src/jma/parse.js");
const { tsunamiRegionsFor } = await import("../src/jma/regions.js");
const { situationFor } = await import("../src/composer/rules.js");
const { headlineFor } = await import("../src/composer/headline.js");
const { screenClassFor } = await import("../src/writer/live.js");
const { generateSite, generationFile } = await import("../src/loop/generation.js");
const { receiveSite } = await import("../src/jma/receive.js");
const { staticVerifier } = await import("../src/loop/static-verifier.js");
const { layoutClassOf, layoutDigestOf } = await import("../src/delivery/gate.js");
const { approvalWith, classDigest, layoutDigest, screenClass } = await import("../../app/layout/gate");
const { needsRaw } = await import("./raw.js");
import type Anthropic from "@anthropic-ai/sdk";
import type { WriterOutput } from "../src/composer/compose.js";
import type { SyntheticPlan } from "../src/jma/synthetic-classes.js";
import type { Verifier } from "../src/loop/types.js";
import type { SiteFile } from "../src/sites.js";

const TSUNAMI = ["tsunami/evac-now/2", "tsunami/evac-now/3", "tsunami/evac-now/4", "tsunami/all-clear/1"];
const EXPECTED: Record<string, { kind: [string, string]; last: string; title: string; headline: string; template: string; level: number }> = {
  "tsunami/evac-now/2": { kind: ["62", "津波注意報"], last: "津波なし", title: "津波注意報", headline: "津波注意報", template: "evac-now", level: 2 },
  "tsunami/evac-now/3": { kind: ["51", "津波警報"], last: "津波なし", title: "津波警報", headline: "津波警報", template: "evac-now", level: 3 },
  "tsunami/evac-now/4": { kind: ["53", "大津波警報：発表"], last: "津波なし", title: "大津波警報", headline: "大津波警報", template: "evac-now", level: 4 },
  "tsunami/all-clear/1": { kind: ["60", "津波注意報解除"], last: "津波注意報", title: "津波予報", headline: "津波注意報解除", template: "all-clear", level: 1 },
};
const KASHIWAZAKI = { municipalityId: "15205", municipalityName: "柏崎市", prefecture: "新潟県" };
const WAJIMA = { municipalityId: "17204", municipalityName: "輪島市", prefecture: "石川県" };

const plansAt = (m: string) => classListing(m).filter((c) => c.supported && c.cls.startsWith("tsunami/")) as SyntheticPlan[];

test("柏崎市 is on the tsunami forecast region 新潟県上中下越 (340), and the other rows of the table are as they were", () => {
  const table = JSON.parse(fs.readFileSync(path.join(repoData, "jma", "tsunami-regions.json"), "utf8"));
  assert.deepEqual(table.regions["340"], { name: "新潟県上中下越", municipalities: ["15205"] });
  assert.deepEqual(Object.fromEntries(Object.entries(table.regions).filter(([code]) => code !== "340")), {
    "360": { name: "石川県能登", municipalities: ["17204"] },
    "380": { name: "静岡県", municipalities: ["22424"] },
    "312": { name: "東京湾内湾", municipalities: ["14100"] },
    "230": { name: "秋田県", municipalities: ["05210"] },
  });
  assert.match(table.source, /新潟県上中下越/);
  assert.match(table.source, /tsunami_shichouson\.pdf/);
  assert.deepEqual(tsunamiRegionsFor("15205"), ["340"]);
});

test("the four tsunami classes are composable where the municipality is on a forecast region, and not listed where it is on none", () => {
  for (const m of ["15205", "17204", "22424"]) {
    const tsunami = classListing(m).filter((c) => c.cls.startsWith("tsunami/"));
    assert.deepEqual(tsunami.map((c) => [c.cls, c.supported]), TSUNAMI.map((c) => [c, true]), m);
  }
  assert.deepEqual(classListing("05210").filter((c) => c.cls.startsWith("tsunami/")), [], "a municipality on no region of the table");
});

function templatePlaces(): Set<string> {
  const places = new Set<string>();
  for (const f of fs.readdirSync(TEMPLATES_DIR).filter((n) => n.endsWith("VTSE41.xml"))) {
    const xml = fs.readFileSync(path.join(TEMPLATES_DIR, f), "utf8");
    for (const m of xml.matchAll(/<Area>\s*<Name>([^<]+)<\/Name>/g)) places.add(m[1]!);
    for (const m of xml.matchAll(/<EditorialOffice>([^<]+)</g)) places.add(m[1]!);
    for (const m of xml.matchAll(/<(?:Text|NameFromMark)[^>]*>([^<]+)</g)) places.add(m[1]!.trim());
  }
  return places;
}

test("a synthetic tsunami bulletin reads as the class it stands for, on the municipality's region only", () => {
  for (const target of [KASHIWAZAKI, WAJIMA]) {
    const region = tsunamiRegionsFor(target.municipalityId)[0]!;
    const plans = plansAt(target.municipalityId);
    assert.deepEqual(plans.map((p) => p.cls), TSUNAMI);
    for (const plan of plans) {
      const want = EXPECTED[plan.cls]!;
      const xml = synthesizeXml(plan, target);
      const alert = parseJmaXml(xml);
      assert.match(alert.bulletin_id, /^SYN-VTSE41-\d{12}-[0-9a-f]{12}$/);
      assert.deepEqual([alert.code, alert.hazard, alert.status, alert.info_type, alert.raw_title, alert.headline_text, alert.publishing_office], ["VTSE41", "tsunami", "normal", "issued", want.title, "", "気象庁"]);
      assert.deepEqual(alert.areas.map((a) => [a.code, a.name, a.kind_code, a.kind_name, a.last_kind_name]), [[region, (JSON.parse(fs.readFileSync(path.join(repoData, "jma", "tsunami-regions.json"), "utf8")).regions[region]).name, ...want.kind, want.last]]);
      const situation = situationFor(alert, target.municipalityId);
      assert.deepEqual([situation.template, situation.level, situation.caution], [want.template, want.level, undefined], plan.cls);
      assert.equal(screenClassFor(alert.hazard, situation), plan.cls);
      assert.equal(headlineFor(alert, target.municipalityId), want.headline);
    }
  }
});

test("a synthetic tsunami bulletin carries nothing of its sample: no other region, headline text, arrival time, height, observation, earthquake or comment", () => {
  const places = templatePlaces();
  assert.ok(places.has("北海道太平洋沿岸東部") && places.has("和歌山県南方沖") && places.has("気象庁本庁"), "the sample's places are read");
  for (const target of [KASHIWAZAKI, WAJIMA]) {
    for (const plan of plansAt(target.municipalityId)) {
      const xml = synthesizeXml(plan, target);
      const own = new Set(tsunamiRegionsFor(target.municipalityId).map((r) => JSON.parse(fs.readFileSync(path.join(repoData, "jma", "tsunami-regions.json"), "utf8")).regions[r].name as string));
      assert.deepEqual([...places].filter((p) => !own.has(p) && xml.includes(p)), [], plan.cls);
      for (const tag of ["FirstHeight", "ArrivalTime", "MaxHeight", "TsunamiHeight", "Observation", "Estimation", "Earthquake", "Hypocenter", "Comments", "WarningComment", "Information", "Magnitude"]) {
        assert.doesNotMatch(xml, new RegExp(`<(?:[a-z_]+:)?${tag}[ >]`), `${plan.cls} keeps <${tag}>`);
      }
      assert.match(xml, /<Headline>\s*<Text\/?>\s*(?:<\/Text>\s*)?<\/Headline>|<Headline><Text><\/Text><\/Headline>/, `${plan.cls}: the headline text is emptied`);
      assert.equal((xml.match(/<Item>/g) ?? []).length, 1, `${plan.cls}: one region`);
    }
  }
});

test("the same class and municipality give the same synthetic XML", () => {
  for (const plan of plansAt("15205")) {
    assert.equal(synthesizeXml(plan, KASHIWAZAKI), synthesizeXml(plan, KASHIWAZAKI), plan.cls);
  }
  const ids = plansAt("15205").map((p) => parseJmaXml(synthesizeXml(p, KASHIWAZAKI)).bulletin_id);
  assert.equal(new Set(ids).size, 4, "each class its own bulletin");
});

const site = (id: string) => JSON.parse(fs.readFileSync(path.join(repoData, "sites", `${id}.json`), "utf8")) as SiteFile;
const WAJIMA_SITE = site("17204-demo");
const checkedVerifier: Verifier = { name: "static+browser(test)", rendersScreens: true, verify: staticVerifier.verify };
const recorded = (m: string, cls: string) => (JSON.parse(fs.readFileSync(path.join(repoData, "writer", m, "class", `${cls}.json`), "utf8")) as { output: WriterOutput }).output;
const WORDING: Record<string, WriterOutput> = { "evac-now": recorded("15205", "landslide-evac-now-4"), "all-clear": recorded("17204", "heavy_rain-all-clear-1") };
const alertBlocks: string[] = [];
const writerClient = {
  messages: {
    stream: (params: { messages: { content: { text: string }[] }[] }) => {
      const text = params.messages.flatMap((m) => m.content.map((c) => c.text)).join("\n");
      alertBlocks.push(params.messages[0]!.content.at(-1)!.text);
      const template = text.match(/テンプレート: ([a-z-]+)/)![1]!;
      return { finalMessage: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ cells: WORDING[template]!.cells }) }], usage: { input_tokens: 1, output_tokens: 1 } }) };
    },
  },
} as unknown as Anthropic;
const liveWriter = { kind: "live" as const, live: { client: writerClient, model: "opus" as const } };

function storedFiles(siteId: string, bulletinId: string) {
  const dir = path.join(LAYOUTS_DIR, siteId, bulletinId);
  return fs.readdirSync(dir).map((f) => ({ shape: f.slice(0, -5), body: fs.readFileSync(path.join(dir, f), "utf8") }));
}

test("generate composes the four tsunami classes where the municipality is on a forecast region, and lists them as composable", async () => {
  const g = await generateSite({ site: WAJIMA_SITE, classes: TSUNAMI, verifier: checkedVerifier, writer: liveWriter });
  assert.deepEqual(g.classes.map((c) => [c.class, c.outcome, c.approvable]), TSUNAMI.map((c) => [c, "pass", true]));
  const written = JSON.parse(fs.readFileSync(generationFile(WAJIMA_SITE.id), "utf8"));
  for (const cls of TSUNAMI) assert.ok(written.composable.includes(cls), cls);
  for (const row of g.classes) assert.equal(screenClass(JSON.parse(storedFiles(WAJIMA_SITE.id, row.bulletin_id!)[0]!.body)), row.class);
  for (const block of alertBlocks) assert.doesNotMatch(block, /石川県能登|輪島市/, "the Writer is told the class, not the region");

  const honjo = site("05210-demo-honjo-station");
  const none = await generateSite({ site: honjo, classes: ["heavy_rain/evac-now/4"], verifier: staticVerifier, writer: { kind: "placeholder" } });
  assert.ok(!none.composable.some((c) => c.startsWith("tsunami/")), "a municipality on no region has no tsunami class to compose");
  assert.ok(!none.classes.some((c) => c.class.startsWith("tsunami/")));
});

// Official samples: the 2016-09-01 drill series, where 石川県能登 (360) is under 津波注意報 and then cleared. Read as
// bulletins of normal status, with the 石川県能登 item set to each kind the class approvals are tried on.
const ISSUE = "32-39_12_02_250206_VTSE41.xml";
const CLEAR = "32-39_12_13_250206_VTSE41.xml";

function asNormalBulletin(file: string, kind: { name: string; code: string }, last: { name: string; code: string }, at: string): string {
  const xml = fs.readFileSync(path.join(SAMPLES_DIR, file), "utf8");
  const item = /(<Area><Name>石川県能登<\/Name><Code>360<\/Code><\/Area>\s*<Category>)[\s\S]*?(<\/Category>)/;
  assert.match(xml, item);
  return xml
    .replace(item, `$1<Kind><Name>${kind.name}</Name><Code>${kind.code}</Code></Kind><LastKind><Name>${last.name}</Name><Code>${last.code}</Code></LastKind>$2`)
    .replace("<Status>訓練</Status>", "<Status>通常</Status>")
    .replace(/<ReportDateTime>[^<]*</, `<ReportDateTime>${at}<`)
    .replace(/<TargetDateTime>[^<]*</, `<TargetDateTime>${at}<`);
}

function feedOf(bodies: { xml: string; at: string }[]): string {
  const feedDir = fs.mkdtempSync(path.join(os.tmpdir(), "evac-tsunami-feed-"));
  fs.mkdirSync(path.join(feedDir, "index"), { recursive: true });
  const lines = bodies.map(({ xml, at }) => {
    const utc = new Date(at).toISOString();
    const name = `${utc.replace(/[^0-9]/g, "").slice(0, 14)}_0_VTSE41_010000.xml`;
    fs.mkdirSync(path.join(feedDir, "bodies", name.slice(0, 8)), { recursive: true });
    fs.writeFileSync(path.join(feedDir, "bodies", name.slice(0, 8), name), xml);
    const url = `https://www.data.jma.go.jp/developer/xml/data/${name}`;
    return JSON.stringify({ id: url, title: "t", updated: utc, author: "a", url, content: "", recorded_at: utc });
  });
  fs.writeFileSync(path.join(feedDir, "index", "extra_l.jsonl"), lines.join("\n") + "\n");
  return feedDir;
}

const NONE = { name: "津波なし", code: "00" };

test("class approvals from the synthetic tsunami bulletins open real ones: either all-clear without a caution, but not a downgrade to a forecast", { skip: needsRaw({ samples: [ISSUE, CLEAR] }) }, async () => {
  const approvals = { version: "0.1", layouts: {} as Record<string, unknown>, sites: {} as Record<string, unknown>, classes: {} as Record<string, unknown> };
  const generated = JSON.parse(fs.readFileSync(generationFile(WAJIMA_SITE.id), "utf8")).classes as { class: string; bulletin_id: string }[];
  const approved = new Map<string, string>();
  for (const row of generated.filter((r) => TSUNAMI.includes(r.class))) {
    const files = storedFiles(WAJIMA_SITE.id, row.bulletin_id);
    approvals.layouts[`${WAJIMA_SITE.id}/${row.bulletin_id}`] = { approved: true, updated_at: "2026-11-11T00:00:00Z", digest: layoutDigest(files) };
    approvals.classes[`${WAJIMA_SITE.id}/${row.class}`] = { approved: true, updated_at: "2026-11-11T00:00:00Z", digest: classDigest(files), approved_from: row.bulletin_id };
    approved.set(row.class, classDigest(files));
  }
  approvals.sites[WAJIMA_SITE.id] = { auto_publish: true, updated_at: "2026-11-11T00:00:00Z" };
  fs.writeFileSync(APPROVALS_FILE, JSON.stringify(approvals));

  const feedDir = feedOf([
    { xml: asNormalBulletin(ISSUE, { name: "津波注意報", code: "62" }, NONE, "2026-11-11T07:00:00+09:00"), at: "2026-11-11T07:00:00+09:00" },
    { xml: asNormalBulletin(CLEAR, { name: "津波注意報解除", code: "60" }, { name: "津波注意報", code: "62" }, "2026-11-11T08:00:00+09:00"), at: "2026-11-11T08:00:00+09:00" },
    { xml: asNormalBulletin(ISSUE, { name: "津波警報", code: "51" }, NONE, "2026-11-11T09:00:00+09:00"), at: "2026-11-11T09:00:00+09:00" },
    { xml: asNormalBulletin(CLEAR, { name: "警報解除", code: "50" }, { name: "津波警報", code: "51" }, "2026-11-11T10:00:00+09:00"), at: "2026-11-11T10:00:00+09:00" },
    { xml: asNormalBulletin(ISSUE, { name: "大津波警報", code: "52" }, { name: "大津波警報：発表", code: "53" }, "2026-11-11T11:00:00+09:00"), at: "2026-11-11T11:00:00+09:00" },
    { xml: asNormalBulletin(CLEAR, { name: "津波予報（若干の海面変動）", code: "73" }, { name: "大津波警報", code: "52" }, "2026-11-11T12:00:00+09:00"), at: "2026-11-11T12:00:00+09:00" },
  ]);
  const round = await receiveSite({ site: WAJIMA_SITE, verifier: checkedVerifier, writer: { kind: "placeholder" }, usage: [], initialSince: "2026-11-10T00:00:00Z", feedDir, liveDir: fs.mkdtempSync(path.join(os.tmpdir(), "evac-tsunami-live-")) });
  assert.deepEqual(round.errors, []);
  const now = JSON.parse(fs.readFileSync(APPROVALS_FILE, "utf8"));
  const rows = round.bulletins.map(({ entry, outcome }) => {
    const dir = path.join(LAYOUTS_DIR, WAJIMA_SITE.id, entry.bulletin_id);
    const cls = layoutClassOf(dir, path.join(REPORTS_DIR, WAJIMA_SITE.id, entry.bulletin_id, "report.json"))!;
    const headline = JSON.parse(fs.readFileSync(path.join(dir, "16x9.json"), "utf8")).cells.find((c: { role: string }) => c.role === "headline").text;
    return [headline.ja, headline.en, cls.key, outcome, approved.get(cls.key) === cls.digest, approvalWith(now, WAJIMA_SITE.id, entry.bulletin_id, layoutDigestOf(dir), cls).by];
  });
  assert.deepEqual(rows, [
    ["津波注意報", "Tsunami Advisory", "tsunami/evac-now/2", "pass", true, "class"],
    ["津波注意報解除", "Tsunami Advisory: Lifted", "tsunami/all-clear/1", "pass", true, "class"],
    ["津波警報", "Tsunami Warning", "tsunami/evac-now/3", "pass", true, "class"],
    ["警報解除", "Tsunami Warning: Lifted", "tsunami/all-clear/1", "pass", true, "class"],
    ["大津波警報", "Major Tsunami Warning", "tsunami/evac-now/4", "pass", true, "class"],
    ["大津波警報解除", "Major Tsunami Warning: Lifted", "tsunami/all-clear/1", "pass", false, null],
  ]);
});
