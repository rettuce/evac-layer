import fs from "node:fs";
import path from "node:path";
import type { Municipality } from "../composer/compose.js";
import { MUNICIPALITIES_DIR } from "../paths.js";
import { readPreset } from "../reader/presets.js";

// Until the Reader has run for a municipality, its screens are composed from the GSI shelters alone; the caller
// records that the PDF-derived facts are missing.
export function loadMunicipality(id: string): { municipality: Municipality; readerRan: boolean } {
  const full = path.join(MUNICIPALITIES_DIR, `${id}.json`);
  if (fs.existsSync(full)) return { municipality: JSON.parse(fs.readFileSync(full, "utf8")), readerRan: true };
  const sheltersFile = path.join(MUNICIPALITIES_DIR, `${id}.shelters.json`);
  if (!fs.existsSync(sheltersFile)) throw new Error(`neither ${full} nor ${sheltersFile} exists; run the Reader or the shelters CLI first`);
  const s = JSON.parse(fs.readFileSync(sheltersFile, "utf8"));
  const nameEn = readPreset(id)?.name_en;
  return {
    municipality: { id, name: s.name, ...(nameEn ? { name_en: nameEn } : {}), sources: [], hazards: [], shelters: s.shelters, conflicts: [] },
    readerRan: false,
  };
}
