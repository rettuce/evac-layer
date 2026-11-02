import type { Shape } from "../../../app/layout/types";
import type { CellBudget } from "../writer/request.js";

// Provisional; the rationale lives in schema/README.md ("Character budgets").
const HEADLINE = { role: "headline" as const, max_chars: { ja: 12, ja_easy: 18, en: 24 } };
export const CHAR_BUDGETS: Record<Shape, CellBudget[]> = {
  "16x9": [
    HEADLINE,
    { role: "action", max_chars: { ja: 12, ja_easy: 18, en: 28 } },
    { role: "direction", max_chars: { ja: 10 } },
    { role: "languages", max_chars: { ja_easy: 24, en: 40, zh_hans: 16, ko: 24 } },
  ],
  "9x16": [
    HEADLINE,
    { role: "action", max_chars: { ja: 10, ja_easy: 14, en: 22 } },
    { role: "direction", max_chars: { ja: 10 } },
    { role: "languages", max_chars: { ja_easy: 16, en: 26, zh_hans: 10, ko: 16 } },
  ],
  "32x9": [
    HEADLINE,
    { role: "action", max_chars: { ja: 10, ja_easy: 14, en: 22 } },
    { role: "direction", max_chars: { ja: 8 } },
    { role: "languages", max_chars: { ja_easy: 40, en: 64, zh_hans: 24, ko: 40 } },
  ],
  "1x1": [
    HEADLINE,
    { role: "action", max_chars: { ja: 8, ja_easy: 12, en: 18 } },
    { role: "direction", max_chars: { ja: 8 } },
    { role: "languages", max_chars: { ja_easy: 14, en: 22, zh_hans: 8, ko: 14 } },
  ],
};

export function strictestBudgets(shapes: readonly Shape[]): CellBudget[] {
  const roles = [...new Set(shapes.flatMap((s) => CHAR_BUDGETS[s].map((b) => b.role)))];
  return roles.map((role) => {
    const max: CellBudget["max_chars"] = {};
    for (const s of shapes) {
      for (const [lang, n] of Object.entries(CHAR_BUDGETS[s].find((b) => b.role === role)?.max_chars ?? {})) {
        const k = lang as keyof CellBudget["max_chars"];
        max[k] = Math.min(max[k] ?? Infinity, n!);
      }
    }
    return { role, max_chars: max };
  });
}
