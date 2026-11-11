import type { LayoutCell } from "../../../app/layout/types";
import { formatErrors, validateDoc } from "../schemas.js";
import { judgeContent, judgeDrill, judgeDrillWordOutsideDrill, judgeNorthUp, type CellText, type Finding } from "../verifier/checks.js";
import type { ScreenVerdict, Verifier } from "./types.js";

function cellText(c: LayoutCell): CellText {
  const text = [c.text.ja, c.distance_m !== undefined ? `${c.distance_m} m` : ""].filter(Boolean).join(" ");
  return { id: c.id, role: c.role, text };
}

export const staticVerifier: Verifier = {
  name: "static",
  rendersScreens: false,
  async verify(screens, ctx) {
    return screens.map((s): ScreenVerdict => {
      const findings: Finding[] = [];
      const v = validateDoc(s, "layout");
      if (!v.ok) findings.push({ check: "missing-required", detail: `layout fails layout.schema.json:\n${formatErrors(v.errors)}` });
      findings.push(...judgeContent((s.cells as LayoutCell[]).map(cellText)));
      findings.push(...judgeNorthUp((s.cells as LayoutCell[]).filter((c) => c.role === "direction" && c.orientation === "north-up").map((c) => ({ id: c.id, word: c.text.ja, rotation: c.rotation }))));
      if (ctx) findings.push(...judgeDrill(s.cells as LayoutCell[], ctx.alert.status), ...judgeDrillWordOutsideDrill(s.cells as LayoutCell[], ctx.alert.status));
      return { shape: s.shape, ok: findings.length === 0, findings };
    });
  },
};
