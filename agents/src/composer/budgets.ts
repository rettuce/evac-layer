import type { PanelShape, TemplateId } from "../../../app/layout/types";
import type { CellBudget } from "../writer/request.js";

// Provisional; the rationale lives in schema/README.md ("Character budgets").
const HEADLINE = { role: "headline" as const, max_chars: { ja: 14, ja_easy: 18, en: 24 } };
export const CHAR_BUDGETS: Record<PanelShape, CellBudget[]> = {
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
    { role: "action", max_chars: { ja: 6, ja_easy: 24, en: 18 } },
    { role: "direction", max_chars: { ja: 8 } },
    { role: "languages", max_chars: { ja_easy: 14, en: 22, zh_hans: 8, ko: 14 } },
  ],
};

// Measured by the render seat (2026-11-02): on 1x1 the action line is 144 px in a 984 px body, so one line holds
// 6 full-width characters and two lines 12. evac-prepare keeps the shelter required, which leaves room for one
// line only; the other templates allow two.
const TEMPLATE_OVERRIDES: Partial<Record<TemplateId | "secure-now", Partial<Record<PanelShape, CellBudget[]>>>> = {
  "evac-now": { "1x1": [{ role: "action", max_chars: { ja: 12 } }] },
  "secure-now": { "1x1": [{ role: "action", max_chars: { ja: 12 } }] },
  "all-clear": { "1x1": [{ role: "action", max_chars: { ja: 12 } }] },
};

export function budgetsFor(template: string, shape: PanelShape): CellBudget[] {
  const over = TEMPLATE_OVERRIDES[template as TemplateId]?.[shape] ?? [];
  return CHAR_BUDGETS[shape].map((b) => {
    const o = over.find((x) => x.role === b.role);
    return o ? { role: b.role, max_chars: { ...b.max_chars, ...o.max_chars } } : b;
  });
}

export function strictestBudgets(template: string, shapes: readonly PanelShape[]): CellBudget[] {
  const roles = [...new Set(shapes.flatMap((s) => budgetsFor(template, s).map((b) => b.role)))];
  return roles.map((role) => {
    const max: CellBudget["max_chars"] = {};
    for (const s of shapes) {
      for (const [lang, n] of Object.entries(budgetsFor(template, s).find((b) => b.role === role)?.max_chars ?? {})) {
        const k = lang as keyof CellBudget["max_chars"];
        max[k] = Math.min(max[k] ?? Infinity, n!);
      }
    }
    return { role, max_chars: max };
  });
}
