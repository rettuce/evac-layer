import { resolveNorthUpTemplate } from "../../../app/layout/northUp";
import type { Orientation, Role, Shape, TemplateId } from "../../../app/layout/types";
import { TemplateNotDefinedError, resolveTemplate } from "../../../app/layout/templates";
import { ComposerStop } from "./rules.js";

export interface ShapeContract { slots: Set<string>; required: Set<Role> }

export function shapeContract(templateId: TemplateId, shape: Shape, orientation?: Orientation): ShapeContract {
  try {
    const t = orientation === "north-up" ? resolveNorthUpTemplate(templateId, shape) : resolveTemplate(templateId, shape);
    return { slots: new Set(t.slots), required: new Set(t.required) };
  } catch (e) {
    if (e instanceof TemplateNotDefinedError) throw new ComposerStop(e.message);
    throw e;
  }
}
