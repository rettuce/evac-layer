import fs from "node:fs";
import path from "node:path";

export type HazardType = "flood" | "landslide" | "storm_surge" | "earthquake" | "tsunami" | "large_fire" | "inland_flood" | "volcano";

export interface Shelter {
  name: string;
  kind: "emergency_evacuation_site" | "evacuation_shelter";
  address: string;
  lat: number;
  lng: number;
  hazards_ok: HazardType[];
  source: { type: "gsi"; file: string; id: string };
}

const HAZARD_COLUMNS: Record<string, HazardType> = {
  洪水: "flood",
  "崖崩れ、土石流及び地滑り": "landslide",
  高潮: "storm_surge",
  地震: "earthquake",
  津波: "tsunami",
  大規模な火事: "large_fire",
  内水氾濫: "inland_flood",
  火山現象: "volcano",
};

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); if (row.some((f) => f !== "")) rows.push(row); }
  return rows;
}

// GSI publishes <code>_1.csv (designated evacuation shelters) and <code>_2.csv (designated emergency evacuation sites).
export function readGsiCsv(csvPath: string, label = path.basename(csvPath)): Shelter[] {
  const kind = /_2\.csv$/.test(csvPath) ? "emergency_evacuation_site" : /_1\.csv$/.test(csvPath) ? "evacuation_shelter" : null;
  if (!kind) throw new Error(`${csvPath}: expected a GSI file named <code>_1.csv or <code>_2.csv`);
  const [header, ...rows] = parseCsv(fs.readFileSync(csvPath, "utf8"));
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`${csvPath}: column "${name}" not found in header ${header.join(",")}`);
    return i;
  };
  const [iId, iName, iAddr, iLat, iLng] = ["共通ID", "施設・場所名", "住所", "緯度", "経度"].map(col);
  const hazardCols = Object.entries(HAZARD_COLUMNS).filter(([h]) => header.includes(h)).map(([h, t]) => [header.indexOf(h), t] as const);
  return rows.map((r) => {
    const lat = Number(r[iLat]);
    const lng = Number(r[iLng]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error(`${csvPath}: row ${r[0]} has no coordinates`);
    return {
      name: r[iName].trim(),
      kind,
      address: r[iAddr].trim(),
      lat,
      lng,
      hazards_ok: hazardCols.filter(([i]) => r[i].trim() === "1").map(([, t]) => t),
      source: { type: "gsi", file: label, id: r[iId].trim() },
    };
  });
}
