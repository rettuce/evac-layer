import type { LayoutCell } from "../../../app/layout/types";
import { headlineText } from "../composer/headline.js";
import { ComposerStop } from "../composer/rules.js";
import { formatErrors, validateDoc } from "../schemas.js";
import { judgeContent, judgeDrill, judgeDrillWordOutsideDrill, judgeHeadline, judgeNorthUp, type CellText, type Finding } from "../verifier/checks.js";
import type { ScreenVerdict, Verifier, VerifyContext } from "./types.js";

function cellText(c: LayoutCell): CellText {
  const text = [c.text.ja, c.distance_m !== undefined ? `${c.distance_m} m` : ""].filter(Boolean).join(" ");
  return { id: c.id, role: c.role, text };
}

// Only the loop passes the bulletin, right after the Composer wrote the screens; a stored screen checked again has no
// context, so a screen composed before the table was used is not held to it.
export function headlineTableFindings(cells: LayoutCell[], ctx: VerifyContext): Finding[] {
  let expected: Record<string, string>;
  try {
    expected = headlineText(ctx.alert, ctx.municipalityId);
  } catch (e) {
    if (!(e instanceof ComposerStop)) throw e;
    return [{ check: "headline-table", cell_id: "headline", detail: e.message }];
  }
  return judgeHeadline(cells, expected);
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
      if (!ctx) return { shape: s.shape, ok: findings.length === 0, findings };
      const headline = headlineTableFindings(s.cells as LayoutCell[], ctx);
      findings.push(...judgeDrill(s.cells as LayoutCell[], ctx.alert.status), ...judgeDrillWordOutsideDrill(s.cells as LayoutCell[], ctx.alert.status), ...headline);
      return { shape: s.shape, ok: findings.length === 0, findings, headline_table: headline.length ? "fail" : "pass" };
    });
  },
};
