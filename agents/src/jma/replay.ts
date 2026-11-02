import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { formatErrors, validateDoc } from "../schemas.js";
import { listBodies, mentionsMunicipality, FEED_DIR } from "./feed.js";
import { parseJmaXml, type Alert } from "./parse.js";
import { tsunamiRegionsFor } from "./regions.js";

const REPLAYABLE = /^(VPWW55|VPWW56|VXKO\d{2}|VTSE41)$/;

export interface ReplayEntry {
  issued_at: string;
  file: string;
  wmo_code: string;
  bulletin_id: string;
  municipality_level: number | null;
  municipality_status: string[];
  alert: Alert;
}

export function replay(municipalityId: string, feedDir = FEED_DIR) {
  const entries: ReplayEntry[] = [];
  const errors: { file: string; error: string }[] = [];
  const regions = new Set(tsunamiRegionsFor(municipalityId));
  for (const b of listBodies(feedDir).filter((x) => REPLAYABLE.test(x.code))) {
    const xml = fs.readFileSync(b.file);
    if (!mentionsMunicipality(xml.toString("utf8"), b.code, municipalityId)) continue;
    try {
      const alert = parseJmaXml(xml);
      const v = validateDoc(alert, "alert");
      if (!v.ok) throw new Error(`alert fails alert.schema.json: ${formatErrors(v.errors)}`);
      const mine = alert.areas.filter((a) => (a.code_type === "city" ? a.code.slice(0, 5) === municipalityId : regions.has(a.code)));
      const levels = mine.map((a) => a.level).filter((l): l is number => l !== null);
      entries.push({
        issued_at: alert.issued_at,
        file: path.relative(feedDir, b.file),
        wmo_code: b.code,
        bulletin_id: alert.bulletin_id,
        municipality_level: levels.length ? Math.max(...levels) : null,
        municipality_status: [...new Set(mine.map((a) => a.status))].sort(),
        alert,
      });
    } catch (e) {
      errors.push({ file: path.relative(feedDir, b.file), error: (e as Error).message });
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
