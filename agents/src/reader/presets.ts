import fs from "node:fs";
import path from "node:path";
import { MUNICIPALITIES_DIR } from "../paths.js";

// One file per municipality, data/municipalities/<id>.preset.json. pdfs and gsi are relative to EVAC_RAW_DIR.
export interface Preset { id: string; name: string; name_en: string; prefecture: string; pdfs: string[]; gsi: string[]; gsi_retrieved: string }

const SUFFIX = ".preset.json";

export function presetIds(dir = MUNICIPALITIES_DIR): string[] {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith(SUFFIX)).map((n) => n.slice(0, -SUFFIX.length)).sort() : [];
}

export function readPreset(id: string, dir = MUNICIPALITIES_DIR): Preset | undefined {
  const file = path.join(dir, `${id}${SUFFIX}`);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Preset) : undefined;
}
