import fs from "node:fs";
import path from "node:path";
import type { Site } from "./composer/compose.js";
import { SITES_DIR } from "./paths.js";

export interface SiteFile extends Site {
  name?: string;
  replay?: { municipality?: string; from: string; to: string; speed: number };
}

export class SiteNotFound extends Error {}

export const SITE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function isSiteId(id: unknown): id is string {
  return typeof id === "string" && SITE_ID.test(id);
}

export function readSites(dir = SITES_DIR): SiteFile[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => n.endsWith(".json")).sort().map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), "utf8")) as SiteFile);
}

export function findSite(siteId: string, dir = SITES_DIR): SiteFile {
  const file = path.join(dir, `${siteId}.json`);
  if (!fs.existsSync(file)) throw new SiteNotFound(`no site ${siteId} in ${dir} (expected ${siteId}.json)`);
  return JSON.parse(fs.readFileSync(file, "utf8")) as SiteFile;
}

// Same rule as the app's feed: a replaying demo site may borrow another municipality's recording.
export function siteMunicipality(site: SiteFile): string {
  return site.replay?.municipality ?? site.municipality_id;
}

export function sitesOfMunicipality(municipalityId: string, dir = SITES_DIR): SiteFile[] {
  return readSites(dir).filter((s) => siteMunicipality(s) === municipalityId);
}
