import crypto from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { SYNTHETIC_PREFIX } from "../../../app/layout/gate";
import {
  CODE_TO_HAZARD,
  CONTROL_TITLE_TO_CODE,
  INFO_TYPE,
  KIND_CODE_LEVEL,
  TSUNAMI_KIND,
  TSUNAMI_RANK,
  VPWW_STATUS,
  levelFromName,
  type AreaStatus,
  type BulletinCode,
  type Hazard,
  type TsunamiCategory,
} from "./codes.js";

export interface AlertArea {
  code: string;
  name: string;
  code_type: "city" | "tsunami_forecast_region";
  level: number | null;
  kind_code: string;
  kind_name: string;
  status: AreaStatus;
  // VTSE41 LastKind: the category this region held before this bulletin, so a downgrade can name what ended.
  last_kind_name?: string;
}

export interface Alert {
  bulletin_id: string;
  code: BulletinCode;
  hazard: Hazard;
  level: number | null;
  info_type: "issued" | "corrected" | "cancelled";
  areas: AlertArea[];
  issued_at: string;
  raw_title: string;
  headline_text: string;
  publishing_office: string;
  // Control/Status: 通常 (normal), 試験 (test), 訓練 (drill). A drill screen must say so in every language.
  status: "normal" | "test" | "drill";
  tsunami?: { highest_category: TsunamiCategory };
  synthetic?: true;
}

const CONTROL_STATUS: Record<string, Alert["status"]> = { "通常": "normal", "試験": "test", "訓練": "drill" };

type Node = Record<string, any>;

const ARRAY_TAGS = new Set(["Item", "Area", "Information", "Warning", "Station", "Property"]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ARRAY_TAGS.has(name),
});

export class JmaParseError extends Error {}

// A bulletin composed here from a JMA sample carries <?evac-layer synthetic="1"?> before its root. JMA bulletins carry
// no processing instruction but the XML declaration, so the mark cannot appear on one, and every path that reads a
// bulletin gives the synthetic one its SYN- id.
export const SYNTHETIC_MARK = '<?evac-layer synthetic="1"?>';

function isSynthetic(doc: Node): boolean {
  return doc["?evac-layer"]?.["@synthetic"] === "1";
}

function fail(msg: string): never {
  throw new JmaParseError(msg);
}

function text(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "object") return String((v as Node)["#text"] ?? "");
  return String(v);
}

function detectCode(controlTitle: string): BulletinCode {
  for (const [re, code] of CONTROL_TITLE_TO_CODE) if (re.test(controlTitle)) return code;
  fail(`unsupported bulletin: Control/Title "${controlTitle}" (supported: VPWW55, VPWW56, VXKOii, VTSE41)`);
}

function kindLevel(code: BulletinCode, kindCode: string, kindName: string): number | null {
  if (kindName.endsWith("解除")) return null;
  const fromName = levelFromName(kindName);
  const table = KIND_CODE_LEVEL[code];
  const fromTable = kindCode in table ? table[kindCode] : undefined;
  if (fromName !== null && fromTable !== undefined && fromName !== fromTable) {
    fail(`${code} kind "${kindName}" (code ${kindCode}) names level ${fromName} but the code table says ${fromTable}`);
  }
  if (fromName !== null) return fromName;
  if (fromTable !== undefined) return fromTable;
  fail(`${code} kind "${kindName}" (code ${kindCode}) has no level in its name and is not in the code table`);
}

function compareStatus(level: number | null, lastLevel: number | null | undefined): AreaStatus {
  if (lastLevel === undefined || lastLevel === null) return "issued";
  if (level === null) return "cleared";
  if (level > lastLevel) return "upgraded";
  if (level < lastLevel) return "downgraded";
  return "continued";
}

function parseVpww(code: BulletinCode, body: Node): AlertArea[] {
  const warning = (body.Warning ?? []).find((w: Node) => w["@type"] === "気象警報・注意報（市町村等）");
  if (!warning) fail(`${code}: Body has no Warning type="気象警報・注意報（市町村等）"`);
  return (warning.Item ?? []).map((item: Node): AlertArea => {
    const area = item.Area?.[0];
    if (!area) fail(`${code}: Item without Area`);
    const kind = item.Kind ?? {};
    const kindCode = text(kind.Code);
    const kindName = text(kind.Name);
    const rawStatus = text(kind.Status);
    const status = VPWW_STATUS[rawStatus] ?? fail(`${code}: unknown Status "${rawStatus}" for ${text(area.Name)}`);
    const base = { code: text(area.Code), name: text(area.Name), code_type: "city" as const, kind_code: kindCode, kind_name: kindName };
    if (status === "none") return { ...base, level: null, status: "none" };
    if (status === "cleared") return { ...base, level: null, status: "cleared" };
    const level = kindLevel(code, kindCode, kindName);
    const last = kind.LastKind;
    const lastLevel = last ? kindLevel(code, text(last.Code), text(last.Name)) : undefined;
    return { ...base, level, status: compareStatus(level, lastLevel) };
  });
}

const STATION_LEVEL = /【警戒レベル([0-9０-９])/;

function parseVxko(headline: Node, body: Node): { areas: AlertArea[]; level: number | null } {
  const forecast = (headline.Information ?? []).find((i: Node) => i["@type"] === "指定河川洪水予報（予報区域）");
  const headKind = forecast?.Item?.[0]?.Kind;
  if (!headKind) fail("VXKOii: Headline has no 指定河川洪水予報（予報区域） item");
  const headCode = text(headKind.Code);
  const headName = text(headKind.Name);
  const headLevel = kindLevel("VXKOii", headCode, headName);

  const stationLevel = new Map<string, number>();
  const warning = (body.Warning ?? []).find((w: Node) => w["@type"] === "指定河川洪水予報");
  for (const item of warning?.Item ?? []) {
    const main = (item.Kind?.Property ?? []).find((p: Node) => text(p.Type) === "主文");
    const m = main ? text(main.Text).match(STATION_LEVEL) : null;
    if (!m) continue;
    const level = levelFromName(`レベル${m[1]}`)!;
    for (const st of item.Stations?.Station ?? []) stationLevel.set(text(st.Code), level);
  }

  const cities = new Map<string, AlertArea>();
  for (const item of warning?.Item ?? []) {
    const kindName = text(item.Kind?.Name);
    if (!kindName.startsWith("浸水想定地区")) continue;
    // Areas listed under 氾濫発生情報 are keyed by the breach point, not a water-level station; flooding has
    // already occurred there, so the forecast area's level applies.
    const breach = kindName.includes("氾濫発生情報");
    for (const a of item.Areas?.Area ?? []) {
      const cityCode = text(a.CityCode);
      if (!cityCode) continue;
      const level = stationLevel.get(text(a.Code)) ?? (breach ? headLevel : null);
      const prev = cities.get(cityCode);
      if (prev && (prev.level ?? 0) >= (level ?? 0)) continue;
      cities.set(cityCode, {
        code: cityCode,
        name: text(a.City),
        code_type: "city",
        level,
        kind_code: headCode,
        kind_name: headName,
        status: headLevel === null ? "cleared" : "issued",
      });
    }
  }
  return { areas: [...cities.values()].sort((a, b) => a.code.localeCompare(b.code)), level: headLevel };
}

function parseVtse(body: Node): { areas: AlertArea[]; highest: TsunamiCategory } {
  const items: Node[] = body.Tsunami?.Forecast?.Item ?? fail("VTSE41: Body/Tsunami/Forecast/Item missing");
  let highest: TsunamiCategory = "none";
  const areas = items.map((item): AlertArea => {
    const area = item.Area?.[0] ?? fail("VTSE41: Item without Area");
    const kind = item.Category?.Kind ?? {};
    const kindCode = text(kind.Code);
    const cat = TSUNAMI_KIND[kindCode] ?? fail(`VTSE41: unknown tsunami kind code ${kindCode} (${text(kind.Name)})`);
    const lastCode = text(item.Category?.LastKind?.Code);
    const lastCat = lastCode ? (TSUNAMI_KIND[lastCode] ?? fail(`VTSE41: unknown LastKind code ${lastCode}`)) : "none";
    if (TSUNAMI_RANK[cat] > TSUNAMI_RANK[highest]) highest = cat;
    let status: AreaStatus;
    if (cat === "cleared") status = "cleared";
    else if (TSUNAMI_RANK[lastCat] === 0) status = "issued";
    else if (TSUNAMI_RANK[cat] > TSUNAMI_RANK[lastCat]) status = "upgraded";
    else if (TSUNAMI_RANK[cat] < TSUNAMI_RANK[lastCat]) status = "downgraded";
    else status = "continued";
    return {
      code: text(area.Code),
      name: text(area.Name),
      code_type: "tsunami_forecast_region",
      level: null,
      kind_code: kindCode,
      kind_name: text(kind.Name),
      status,
      ...(lastCode ? { last_kind_name: text(item.Category?.LastKind?.Name) } : {}),
    };
  });
  if (highest === "none" && areas.some((a) => a.status === "cleared")) highest = "cleared";
  return { areas, highest };
}

export function parseJmaXml(xml: string | Buffer): Alert {
  const raw = typeof xml === "string" ? Buffer.from(xml, "utf8") : xml;
  const doc = parser.parse(raw.toString("utf8"));
  const report: Node = doc.Report ?? fail("not a JMA XML Report");
  const control: Node = report.Control ?? fail("Report/Control missing");
  const head: Node = report.Head ?? fail("Report/Head missing");
  const body: Node = report.Body ?? fail("Report/Body missing");

  const code = detectCode(text(control.Title));
  const rawInfoType = text(head.InfoType);
  const info_type = INFO_TYPE[rawInfoType] ?? fail(`unknown InfoType "${rawInfoType}"`);
  const issued_at = text(head.ReportDateTime) || fail("Head/ReportDateTime missing");
  const headline: Node = head.Headline ?? {};
  const sha = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12);

  let areas: AlertArea[];
  let level: number | null;
  let tsunami: Alert["tsunami"];
  if (info_type === "cancelled") {
    areas = [];
    level = null;
    if (code === "VTSE41") tsunami = { highest_category: "none" };
  } else if (code === "VTSE41") {
    const r = parseVtse(body);
    areas = r.areas;
    level = null;
    tsunami = { highest_category: r.highest };
  } else if (code === "VXKOii") {
    const r = parseVxko(headline, body);
    areas = r.areas;
    level = r.level;
  } else {
    areas = parseVpww(code, body);
    const inForce = areas.map((a) => a.level).filter((l): l is number => l !== null);
    level = inForce.length ? Math.max(...inForce) : null;
  }

  const synthetic = isSynthetic(doc);
  return {
    bulletin_id: `${synthetic ? SYNTHETIC_PREFIX : ""}${code}-${issued_at.replace(/[^0-9]/g, "").slice(0, 12)}-${sha}`,
    code,
    hazard: CODE_TO_HAZARD[code],
    level,
    info_type,
    areas,
    issued_at,
    raw_title: text(head.Title),
    headline_text: text(headline.Text),
    publishing_office: text(control.PublishingOffice),
    status: CONTROL_STATUS[text(control.Status)] ?? fail(`unknown Control/Status "${text(control.Status)}"`),
    ...(tsunami ? { tsunami } : {}),
    ...(synthetic ? { synthetic: true as const } : {}),
  };
}
