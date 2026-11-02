import type { Role, Shape, TemplateId } from "../../../app/layout/types";
import { TEMPLATES, areaRoles } from "../../../app/layout/templates";
import { ComposerStop } from "./rules.js";

export interface ShapeContract { slots: Set<string>; required: Set<Role> }

// The renderer chooses among a shape's layout variants at render time, so the Composer must satisfy all of them:
// a cell may go wherever any variant has a slot, and every role some variant requires must be present.
export function shapeContract(templateId: TemplateId, shape: Shape): ShapeContract {
  const variants = TEMPLATES[templateId]?.[shape];
  if (!variants?.length) throw new ComposerStop(`template ${templateId} has no ${shape} layout in app/layout/templates.ts`);
  return {
    slots: new Set(variants.flatMap((v) => [...areaRoles(v)])),
    required: new Set(variants.flatMap((v) => v.required)),
  };
}
