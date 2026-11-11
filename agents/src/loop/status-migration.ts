import fs from "node:fs";
import path from "node:path";
import { parseJmaXml } from "../jma/parse.js";
import { LAYOUTS_DIR } from "../paths.js";
import { bulletinXmlPath, type IndexRow } from "../writer/restore.js";

const warned = new Set<string>();

function addStatus(dir: string, status: string): void {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const file = path.join(dir, name);
    const layout = JSON.parse(fs.readFileSync(file, "utf8")) as { alert?: Record<string, unknown> };
    if (!layout.alert || layout.alert.status) continue;
    layout.alert = { ...layout.alert, status };
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(layout, null, 2) + "\n");
    fs.renameSync(`${file}.tmp`, file);
  }
}

// Rows and layouts written before they carried the status of a drill or test bulletin get it from the bulletin's XML.
// Its layouts change, so an approval given to them goes stale, as it should. Normal bulletins are never rewritten.
export function migrateBulletinStatus(siteId: string, opts: { layoutsDir?: string; xmlPath?: (file: string) => string; log?: (m: string) => void } = {}): string[] {
  const layoutsDir = opts.layoutsDir ?? LAYOUTS_DIR;
  const xmlPath = opts.xmlPath ?? bulletinXmlPath;
  const log = opts.log ?? ((m: string) => console.warn(m));
  const indexFile = path.join(layoutsDir, siteId, "index.json");
  if (!fs.existsSync(indexFile)) return [];
  const doc = JSON.parse(fs.readFileSync(indexFile, "utf8")) as { entries: IndexRow[] };
  const migrated: string[] = [];
  const entries = doc.entries.map((row) => {
    if (row.status || row.synthetic || !row.file) return row;
    const xml = xmlPath(row.file);
    if (!fs.existsSync(xml)) {
      const key = `${siteId}/${row.bulletin_id} ${xml}`;
      if (!warned.has(key)) log(`[warn] ${siteId}/${row.bulletin_id}: ${xml} not found; its drill or test status cannot be checked`);
      warned.add(key);
      return row;
    }
    const status = parseJmaXml(fs.readFileSync(xml)).status;
    if (status === "normal") return row;
    addStatus(path.join(layoutsDir, siteId, row.bulletin_id), status);
    migrated.push(row.bulletin_id);
    return { ...row, status };
  });
  if (!migrated.length) return migrated;
  fs.writeFileSync(`${indexFile}.${process.pid}.tmp`, JSON.stringify({ ...doc, entries }, null, 2) + "\n");
  fs.renameSync(`${indexFile}.${process.pid}.tmp`, indexFile);
  return migrated;
}
