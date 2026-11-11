import fs from "node:fs";
import type { Alert } from "../jma/parse.js";
import { tsunamiRegionsFor } from "../jma/regions.js";
import { WARNING_NAMES_FILE, WARNING_NAMES_JA_EASY_FILE } from "../paths.js";
import type { Lang } from "../writer/request.js";
import { ComposerStop, DRILL_PREFIX_JA, tsunamiClearedFrom } from "./rules.js";

export type TableLang = "en" | "zh_hans" | "zh_hant" | "ko" | "th" | "vi" | "fil" | "id";
export const TABLE_LANGS: readonly TableLang[] = ["en", "zh_hans", "zh_hant", "ko", "th", "vi", "fil", "id"];
export type HeadlineText = Record<Lang, string>;

interface DictionaryRow { no: number; ja: string; text: Record<TableLang, string> }
interface WarningNames { cancel: DictionaryRow; names: DictionaryRow[] }
interface JaEasyNames { reviewed: boolean; cancel: string; names: { ja: string; ja_easy: string }[] }

// The drill word every language but ja opens with; ja carries 【訓練】 in front of the warning name.
export const DRILL_WORD: Record<Exclude<Lang, "ja">, string> = {
  ja_easy: "くんれん ", en: "DRILL: ", zh_hans: "演习：", zh_hant: "演習：", ko: "훈련: ", th: "ฝึกซ้อม: ", vi: "Diễn tập: ", fil: "Pagsasanay: ", id: "Latihan: ",
};

// The dictionary has no word for "<warning> cleared", so each language joins the warning's entry and the entry for
// 解除 (No.20) in one fixed order, adding no words of its own.
export const CANCEL_FORM: Record<TableLang, (name: string, cancel: string) => string> = {
  en: (name, cancel) => `${name}: ${cancel}`,
  zh_hans: (name, cancel) => `${name}${cancel}`,
  zh_hant: (name, cancel) => `${name}${cancel}`,
  ko: (name, cancel) => `${name} ${cancel}`,
  th: (name, cancel) => `${cancel}${name}`,
  vi: (name, cancel) => `${name}: ${cancel}`,
  fil: (name, cancel) => `${name}: ${cancel}`,
  id: (name, cancel) => `${name}: ${cancel}`,
};

// The one place where a bulletin's spelling of a name meets the dictionary's: full- or half-width digits and spaces
// differ between them (レベル３大雨警報, レベル 3 大雨警報).
export function warningKey(name: string): string {
  return name.normalize("NFKC").replace(/\s+/g, "");
}

let names: WarningNames | undefined;
let easy: JaEasyNames | undefined;

export function warningNames(): WarningNames {
  names ??= JSON.parse(fs.readFileSync(WARNING_NAMES_FILE, "utf8")) as WarningNames;
  return names;
}

export function jaEasyNames(): JaEasyNames {
  easy ??= JSON.parse(fs.readFileSync(WARNING_NAMES_JA_EASY_FILE, "utf8")) as JaEasyNames;
  return easy;
}

export interface WarningOnScreen { name: string; cleared: boolean; drill: boolean }

// The warning the headline names: the highest one in force for the municipality, or, on an all-clear, the one that ended.
export function warningOnScreen(alert: Alert, municipalityId: string): WarningOnScreen {
  const regions = new Set(tsunamiRegionsFor(municipalityId));
  const mine = alert.areas.filter((a) => (a.code_type === "city" ? a.code.slice(0, 5) === municipalityId : regions.has(a.code)));
  const live = mine.filter((a) => a.status !== "cleared" && a.status !== "none").sort((a, b) => (b.level ?? 0) - (a.level ?? 0));
  const drill = alert.status === "drill";
  const ended = tsunamiClearedFrom(alert, municipalityId);
  if (ended) return { name: ended, cleared: true, drill };
  if (live.length) return { name: live[0].kind_name.replace(/：発表$/, ""), cleared: false, drill };
  const cleared = mine.find((a) => a.status === "cleared");
  if (cleared) return { name: cleared.kind_name.replace(/解除$/, ""), cleared: true, drill };
  return { name: alert.raw_title, cleared: false, drill };
}

// The headline is the JMA warning name verbatim (Meteorological Service Act art. 23). A VPWW clearance keeps the
// warning's name and sets Status 解除, so the cleared state is shown by appending 解除 to that name.
export function headlineFor(alert: Alert, municipalityId: string): string {
  const w = warningOnScreen(alert, municipalityId);
  return `${w.drill ? DRILL_PREFIX_JA : ""}${w.name}${w.cleared ? "解除" : ""}`;
}

const stop = (msg: string): never => { throw new ComposerStop(msg); };

// Every language of the headline comes from JMA's own dictionary (ja_easy from the reviewed paraphrase table), so a name
// the tables do not hold stops the screen rather than leaving a language out or asking a model for it.
export function headlineText(alert: Alert, municipalityId: string): HeadlineText {
  const w = warningOnScreen(alert, municipalityId);
  const key = warningKey(w.name);
  const table = warningNames();
  const row = table.names.find((n) => warningKey(n.ja) === key)
    ?? stop(`warning name "${w.name}" is not in the JMA multilingual dictionary table (data/jma/warning-names.json); no headline translation for it`);
  const paraphrase = jaEasyNames();
  const easyName = paraphrase.names.find((n) => warningKey(n.ja) === key)?.ja_easy
    ?? stop(`warning name "${w.name}" has no ja_easy headline in data/jma/warning-names-ja-easy.json`);
  const marked = (lang: Exclude<Lang, "ja">, text: string) => (w.drill ? `${DRILL_WORD[lang]}${text}` : text);
  const text = { ja: headlineFor(alert, municipalityId), ja_easy: marked("ja_easy", w.cleared ? `${easyName} ${paraphrase.cancel}` : easyName) } as HeadlineText;
  for (const lang of TABLE_LANGS) text[lang] = marked(lang, w.cleared ? CANCEL_FORM[lang](row.text[lang], table.cancel.text[lang]) : row.text[lang]);
  return text;
}
