import { headlineFor } from "../composer/headline.js";
import type { Situation } from "../composer/rules.js";
import type { Alert } from "../jma/parse.js";

// What a Writer record was written from: two bulletins with the same match get the same wording. The warning is the
// headline the Composer sets (on an all-clear, the name of what ended); the river is the flood forecast area. Wording
// written blind (the Writer was not shown the warning name) does not depend on the warning, so it is matched without it.
export interface WriterMatch {
  hazard: string;
  template: string;
  level: number;
  status: Alert["status"];
  warning: string;
  caution?: Situation["caution"];
  river?: string;
}

const FIELDS: readonly (keyof WriterMatch)[] = ["hazard", "template", "level", "status", "warning", "caution", "river"];

// A VXKO Head/Title is the forecast area followed by the kind name the bulletin carries for every area.
export function riverOf(alert: Alert): string {
  const kind = alert.areas[0]?.kind_name ?? "";
  return kind && alert.raw_title.endsWith(kind) && alert.raw_title.length > kind.length ? alert.raw_title.slice(0, -kind.length) : alert.raw_title;
}

export function writerMatchFor(alert: Alert, municipalityId: string, situation: Situation): WriterMatch {
  return {
    hazard: alert.hazard,
    template: situation.template,
    level: situation.level,
    status: alert.status,
    warning: headlineFor(alert, municipalityId),
    ...(situation.caution ? { caution: situation.caution } : {}),
    ...(alert.code === "VXKOii" ? { river: riverOf(alert) } : {}),
  };
}

export function sameWriterMatch(a: WriterMatch, b: WriterMatch, opts: { blind?: boolean } = {}): boolean {
  return FIELDS.filter((k) => !(opts.blind && k === "warning")).every((k) => a[k] === b[k]);
}
