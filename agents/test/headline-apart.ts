import type { Alert } from "../src/jma/parse.js";
import { headlineText } from "../src/composer/headline.js";

type Layout = { cells: { role: string; text?: Record<string, string> }[] };

// Screens stored before the headline came from the JMA dictionary table carry the Writer's translations there, so a
// screen composed again is compared with them apart from the headline's text, and its headline with the table.
export function apartFromHeadline(json: string): string {
  const layout = JSON.parse(json) as Layout;
  return JSON.stringify({ ...layout, cells: layout.cells.map((c) => (c.role === "headline" ? { ...c, text: { ja: c.text?.ja } } : c)) }, null, 2);
}

export function headlineIsTheTable(json: string, alert: Alert, municipalityId: string): boolean {
  const headline = (JSON.parse(json) as Layout).cells.find((c) => c.role === "headline");
  return JSON.stringify(headline?.text) === JSON.stringify(headlineText(alert, municipalityId));
}
