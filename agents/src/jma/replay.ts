import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { formatErrors, validateDoc } from "../schemas.js";
import { listBodies, mentionsMunicipality, FEED_DIR } from "./feed.js";
import { parseJmaXml, type Alert } from "./parse.js";
import { tsunamiRegionsFor } from "./regions.js";
import { SAMPLES_DIR, SAMPLES_LIST_DIR, requireRawDir } from "../paths.js";

// Official JMA sample bulletins (not redistributed) that a municipality replays besides its feed recording, listed in
// data/samples/<id>.json; a feed recorded in a quiet season has no tsunami bulletin, the samples do.
export { SAMPLES_DIR };

export const REPLAYABLE = /^(VPWW55|VPWW56|VXKO\d{2}|VTSE41)$/;

export interface ReplayEntry {
  issued_at: string;
  file: string;
  wmo_code: string;
  bulletin_id: string;
  municipality_level: number | null;
  municipality_status: string[];
  alert: Alert;
}

export function withinWindow<T extends { issued_at: string }>(entries: T[], window: { from?: string; to?: string }): T[] {
  const bound = (v: string | undefined, name: string) => {
    if (v === undefined) return undefined;
    const t = Date.parse(v);
    if (Number.isNaN(t)) throw new Error(`--${name} ${v} is not a date (use ISO 8601, e.g. 2026-10-11T00:00+09:00)`);
    return t;
  };
  const [from, to] = [bound(window.from, "from"), bound(window.to, "to")];
  return entries.filter((e) => {
    const t = Date.parse(e.issued_at);
    return (from === undefined || t >= from) && (to === undefined || t <= to);
  });
}

export function replayEntry(xml: Buffer, file: string, code: string, municipalityId: string, regions = new Set(tsunamiRegionsFor(municipalityId))): ReplayEntry {
  const alert = parseJmaXml(xml);
  const v = validateDoc(alert, "alert");
  if (!v.ok) throw new Error(`alert fails alert.schema.json: ${formatErrors(v.errors)}`);
  const mine = alert.areas.filter((a) => (a.code_type === "city" ? a.code.slice(0, 5) === municipalityId : regions.has(a.code)));
  const levels = mine.map((a) => a.level).filter((l): l is number => l !== null);
  return {
    issued_at: alert.issued_at,
    file,
    wmo_code: code,
    bulletin_id: alert.bulletin_id,
    municipality_level: levels.length ? Math.max(...levels) : null,
    municipality_status: [...new Set(mine.map((a) => a.status))].sort(),
    alert,
  };
}

export function replay(municipalityId: string, feedDir = FEED_DIR) {
  const entries: ReplayEntry[] = [];
  const errors: { file: string; error: string }[] = [];
  const regions = new Set(tsunamiRegionsFor(municipalityId));
  for (const b of listBodies(feedDir).filter((x) => REPLAYABLE.test(x.code))) {
    const xml = fs.readFileSync(b.file);
    if (!mentionsMunicipality(xml.toString("utf8"), b.code, municipalityId)) continue;
    const file = path.relative(feedDir, b.file);
    try {
      entries.push(replayEntry(xml, file, b.code, municipalityId, regions));
    } catch (e) {
      errors.push({ file, error: (e as Error).message });
    }
  }
  const samplesList = path.join(SAMPLES_LIST_DIR, `${municipalityId}.json`);
  if (fs.existsSync(samplesList)) {
    const { files } = JSON.parse(fs.readFileSync(samplesList, "utf8")) as { files: string[] };
    for (const name of files) {
      const file = `jma-samples/${name}`;
      const code = name.match(/_(V[A-Z]{3}\d{2})\.xml$/)?.[1];
      try {
        if (!code || !REPLAYABLE.test(code)) throw new Error(`not a replayable sample name: ${name}`);
        const xml = fs.readFileSync(path.join(SAMPLES_DIR, name));
        if (!mentionsMunicipality(xml.toString("utf8"), code, municipalityId)) throw new Error(`sample does not mention ${municipalityId}`);
        entries.push(replayEntry(xml, file, code, municipalityId, regions));
      } catch (e) {
        errors.push({ file, error: (e as Error).message });
      }
    }
  }
  entries.sort((a, b) => a.issued_at.localeCompare(b.issued_at) || a.file.localeCompare(b.file));
  return { entries, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { municipality: { type: "string" }, out: { type: "string" }, summary: { type: "boolean", default: false } } });
  if (!values.municipality) {
    console.error("usage: pnpm -F agents replay --municipality <id> [--summary] [--out file.json]");
    process.exit(2);
  }
  requireRawDir(path.join(FEED_DIR, "bodies"), "JMA feed recording (JMA_FEED_DIR)");
  const { entries, errors } = replay(values.municipality);
  for (const e of errors) console.error(`[parse error] ${e.file}: ${e.error}`);
  if (values.summary) {
    for (const e of entries) console.log(`${e.issued_at}  ${e.wmo_code}  L${e.municipality_level ?? "-"}  ${e.municipality_status.join(",")}  ${e.alert.raw_title}`);
  } else {
    const body = JSON.stringify({ municipality: values.municipality, count: entries.length, errors, entries }, null, 2) + "\n";
    if (values.out) fs.writeFileSync(path.resolve(process.env.INIT_CWD ?? process.cwd(), values.out), body);
    else process.stdout.write(body);
  }
  process.exitCode = errors.length ? 1 : 0;
}
