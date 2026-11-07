import fs from "node:fs";
import path from "node:path";
import { ComposerStop, situationFor, type Situation } from "../composer/rules.js";
import { parseJmaXml, type Alert } from "../jma/parse.js";
import { FEED_DIR, LAYOUTS_DIR, SAMPLES_DIR, WRITER_DIR } from "../paths.js";
import { cachedWriter, saveWriterForClass, screenClassFor } from "./live.js";

export function bulletinXmlPath(file: string): string {
  return file.startsWith("jma-samples/") ? path.join(SAMPLES_DIR, file.slice("jma-samples/".length)) : path.join(FEED_DIR, file);
}

interface IndexEntry { bulletin_id: string; file: string; screen?: boolean }

export function buildClassCache(opts: { layoutsDir?: string; xmlPath?: (file: string) => string; log?: (m: string) => void } = {}): string[] {
  const layoutsDir = opts.layoutsDir ?? LAYOUTS_DIR;
  const xmlPath = opts.xmlPath ?? bulletinXmlPath;
  const log = opts.log ?? (() => {});
  const latest = new Map<string, { municipality: string; cls: string; alert: Alert; situation: Situation }>();
  const seen = new Set<string>();
  for (const site of fs.existsSync(layoutsDir) ? fs.readdirSync(layoutsDir) : []) {
    const indexFile = path.join(layoutsDir, site, "index.json");
    if (!fs.existsSync(indexFile)) continue;
    const index = JSON.parse(fs.readFileSync(indexFile, "utf8")) as { municipality: string; entries: IndexEntry[] };
    for (const entry of index.entries.filter((e) => e.screen)) {
      const id = `${index.municipality}/${entry.bulletin_id}`;
      if (seen.has(id) || !cachedWriter(index.municipality, entry.bulletin_id)) continue;
      seen.add(id);
      const xml = xmlPath(entry.file);
      if (!fs.existsSync(xml)) {
        log(`[skip] ${id}: ${xml} not found`);
        continue;
      }
      const alert = parseJmaXml(fs.readFileSync(xml));
      let situation: Situation;
      try {
        situation = situationFor(alert, index.municipality);
      } catch (e) {
        if (!(e instanceof ComposerStop)) throw e;
        log(`[skip] ${id}: ${e.message}`);
        continue;
      }
      const cls = screenClassFor(alert.hazard, situation);
      const key = `${index.municipality}/${cls}`;
      const best = latest.get(key);
      if (!best || Date.parse(alert.issued_at) > Date.parse(best.alert.issued_at)) latest.set(key, { municipality: index.municipality, cls, alert, situation });
    }
  }
  return [...latest.values()].map(({ municipality, cls, alert, situation }) => {
    const { model } = JSON.parse(fs.readFileSync(path.join(WRITER_DIR, municipality, `${alert.bulletin_id}.json`), "utf8")) as { model: string };
    saveWriterForClass(municipality, cls, {
      model, output: cachedWriter(municipality, alert.bulletin_id)!, bulletin_id: alert.bulletin_id, issued_at: alert.issued_at, raw_title: alert.raw_title,
      ...(situation.caution ? { caution: situation.caution } : {}),
    });
    return `${municipality}/${cls} ← ${alert.bulletin_id}`;
  });
}
