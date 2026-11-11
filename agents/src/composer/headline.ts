import fs from "node:fs";
import { dictionarySource, headlineFromTables, type DictionarySource, type HeadlineTables, type HeadlineText, type WarningOnScreen } from "../../../app/layout/headlineTable";
import type { Alert } from "../jma/parse.js";
import { tsunamiRegionsFor } from "../jma/regions.js";
import { WARNING_NAMES_FILE, WARNING_NAMES_JA_EASY_FILE } from "../paths.js";
import { ComposerStop, DRILL_PREFIX_JA, tsunamiClearedFrom } from "./rules.js";

export { CANCEL_FORM, DRILL_WORD, TABLE_LANGS, warningKey, type HeadlineText, type TableLang, type WarningOnScreen } from "../../../app/layout/headlineTable";

// Read on every call, not cached: the gate must see a table changed on disk, and the files are small.
export function headlineTables(): HeadlineTables {
  return { names: JSON.parse(fs.readFileSync(WARNING_NAMES_FILE, "utf8")), easy: JSON.parse(fs.readFileSync(WARNING_NAMES_JA_EASY_FILE, "utf8")) };
}

export function headlineTablesIfPresent(): HeadlineTables | undefined {
  return fs.existsSync(WARNING_NAMES_FILE) && fs.existsSync(WARNING_NAMES_JA_EASY_FILE) ? headlineTables() : undefined;
}

// Tsunami code 50 is named 警報解除 for a warning and a major warning alike; LastKind says which one ended.
const TSUNAMI_WARNING_CLEARED = "警報解除";

export function warningOnScreen(alert: Alert, municipalityId: string): WarningOnScreen {
  const regions = new Set(tsunamiRegionsFor(municipalityId));
  const mine = alert.areas.filter((a) => (a.code_type === "city" ? a.code.slice(0, 5) === municipalityId : regions.has(a.code)));
  const live = mine.filter((a) => a.status !== "cleared" && a.status !== "none").sort((a, b) => (b.level ?? 0) - (a.level ?? 0));
  const drill = alert.status === "drill";
  const ended = tsunamiClearedFrom(alert, municipalityId);
  if (ended) return { ja: `${ended}解除`, name: ended, cleared: true, drill };
  if (live.length) {
    const name = live[0].kind_name.replace(/：発表$/, "");
    return { ja: name, name, cleared: false, drill };
  }
  const cleared = mine.find((a) => a.status === "cleared");
  if (cleared) {
    const ja = cleared.kind_name.endsWith("解除") ? cleared.kind_name : `${cleared.kind_name}解除`;
    const name = cleared.kind_name === TSUNAMI_WARNING_CLEARED ? (cleared.last_kind_name ?? "").replace(/：発表$/, "") : ja.slice(0, -"解除".length);
    return { ja, name, cleared: true, drill };
  }
  return { ja: alert.raw_title, name: alert.raw_title, cleared: false, drill };
}

// The headline is the JMA warning name verbatim (Meteorological Service Act art. 23). A VPWW clearance keeps the
// warning's name and sets Status 解除, so the cleared state is shown by appending 解除 to that name.
export function headlineFor(alert: Alert, municipalityId: string): string {
  const w = warningOnScreen(alert, municipalityId);
  return `${w.drill ? DRILL_PREFIX_JA : ""}${w.ja}`;
}

// A name the tables do not hold stops the screen rather than leaving a language out or asking a model for it.
export function headlineText(alert: Alert, municipalityId: string, tables = headlineTables()): HeadlineText {
  const w = warningOnScreen(alert, municipalityId);
  if (!w.name) throw new ComposerStop(`${w.ja}: the bulletin does not say which warning ended (no LastKind); no headline translation for it`);
  const found = headlineFromTables(w, tables);
  if ("missing" in found) throw new ComposerStop(found.missing);
  return found.text;
}

export function headlineSource(tables = headlineTables()): DictionarySource {
  return dictionarySource(tables);
}
