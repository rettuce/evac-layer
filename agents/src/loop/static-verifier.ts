import type { LayoutCell } from "../../../app/layout/types";
import { formatErrors, validateDoc } from "../schemas.js";
import { judgeContent, type CellText, type Finding } from "../verifier/checks.js";
import type { ScreenVerdict, Verifier } from "./types.js";

function cellText(c: LayoutCell): CellText {
  const text = [c.text.ja, c.distance_m !== undefined ? `${c.distance_m} m` : ""].filter(Boolean).join(" ");
  return { id: c.id, role: c.role, text };
}

export const staticVerifier: Verifier = {
  name: "static",
  async verify(screens) {
    return screens.map((s): ScreenVerdict => {
      const findings: Finding[] = [];
      const v = validateDoc(s, "layout");
      if (!v.ok) findings.push({ check: "missing-required", detail: `layout fails layout.schema.json:\n${formatErrors(v.errors)}` });
      findings.push(...judgeContent((s.cells as LayoutCell[]).map(cellText)));
      return { shape: s.shape, ok: findings.length === 0, findings };
    });
  },
};
