import fs from "node:fs";
import { TSUNAMI_REGIONS_FILE } from "../paths.js";

interface RegionTable { source: string; regions: Record<string, { name: string; municipalities: string[] }> }

let table: RegionTable | undefined;
const warned = new Set<string>();

export function tsunamiRegionTable(): RegionTable["regions"] {
  table ??= JSON.parse(fs.readFileSync(TSUNAMI_REGIONS_FILE, "utf8")) as RegionTable;
  return table.regions;
}

export function tsunamiRegionsFor(municipalityId: string): string[] {
  return Object.entries(tsunamiRegionTable())
    .filter(([, r]) => r.municipalities.includes(municipalityId))
    .map(([code]) => code);
}

// A municipality missing from the table would silently never match a tsunami bulletin.
export function warnIfNoTsunamiRegion(municipalityId: string): void {
  if (warned.has(municipalityId) || tsunamiRegionsFor(municipalityId).length) return;
  warned.add(municipalityId);
  console.warn(`[warn] ${municipalityId} is in no tsunami forecast region of ${TSUNAMI_REGIONS_FILE}; tsunami bulletins will not reach it. Add its region there.`)
}
