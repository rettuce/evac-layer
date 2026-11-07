import type { SiteFile } from "./sites.js";

export const GSI_REVERSE_GEOCODER = "https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress";
const REVERSE_GEOCODER_TIMEOUT_MS = 10_000;

export class MunicipalityLookupFailed extends Error {}

export async function municipalityAt(lat: number, lng: number, fetchFn: typeof fetch = fetch): Promise<string> {
  const url = `${GSI_REVERSE_GEOCODER}?lat=${lat}&lon=${lng}`;
  let body: unknown;
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(REVERSE_GEOCODER_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = await res.json();
  } catch (e) {
    throw new MunicipalityLookupFailed(`GSI reverse geocoder failed for ${lat},${lng}: ${(e as Error).message}`);
  }
  const code = (body as { results?: { muniCd?: unknown } })?.results?.muniCd;
  if (typeof code !== "string" || !/^\d{5}$/.test(code)) {
    throw new MunicipalityLookupFailed(`GSI reverse geocoder returned no municipality code for ${lat},${lng} (outside Japan or at sea?)`);
  }
  return code;
}

export interface SiteInput {
  id: string;
  lat: number;
  lng: number;
  facing_deg: number;
  name?: string;
  municipality_id?: string;
}

export async function buildSite(input: SiteInput, fetchFn: typeof fetch = fetch): Promise<{ site: SiteFile; warnings: string[] }> {
  const warnings: string[] = [];
  let looked: string;
  try {
    looked = await municipalityAt(input.lat, input.lng, fetchFn);
  } catch (e) {
    if (!input.municipality_id) throw e;
    warnings.push(`${(e as Error).message}; keeping the given municipality_id ${input.municipality_id} unchecked`);
    looked = input.municipality_id;
  }
  const municipality_id = input.municipality_id ?? looked;
  if (input.municipality_id && input.municipality_id !== looked) {
    warnings.push(`municipality_id ${input.municipality_id} was given, but GSI places ${input.lat},${input.lng} in ${looked}; keeping ${input.municipality_id}`);
  }
  const site: SiteFile = { id: input.id, municipality_id, lat: input.lat, lng: input.lng, facing_deg: input.facing_deg };
  if (input.name) site.name = input.name;
  return { site, warnings };
}
