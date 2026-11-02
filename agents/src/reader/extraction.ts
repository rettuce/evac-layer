import { readSchema } from "../schemas.js";

const hazardEnum = (readSchema("common").$defs as Record<string, { enum: string[] }>).hazard.enum;

const cited = (props: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required: [...Object.keys(props), "citation_id"],
  properties: { ...props, citation_id: { type: "string", description: "One id from the claim list, e.g. C12" } },
});

export const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["documents", "hazards", "routes", "cautions", "contacts", "shelter_mentions"],
  properties: {
    documents: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["file", "title", "year"],
        properties: {
          file: { type: "string" },
          title: { type: "string" },
          year: { anyOf: [{ type: "integer" }, { type: "null" }] },
        },
      },
    },
    hazards: {
      type: "array",
      items: cited({
        type: { enum: hazardEnum },
        areas: { type: "array", items: { type: "string" } },
        notes_ja: { type: "string" },
      }),
    },
    routes: { type: "array", items: cited({ text_ja: { type: "string" } }) },
    cautions: { type: "array", items: cited({ text_ja: { type: "string" } }) },
    contacts: { type: "array", items: cited({ label_ja: { type: "string" }, phone: { type: "string" } }) },
    shelter_mentions: {
      type: "array",
      items: cited({ name: { type: "string" }, hazards_ok: { type: "array", items: { enum: hazardEnum } } }),
    },
  },
} as const;

export interface CitedItem { citation_id: string }
export interface Extraction {
  documents: { file: string; title: string; year: number | null }[];
  hazards: (CitedItem & { type: string; areas: string[]; notes_ja: string })[];
  routes: (CitedItem & { text_ja: string })[];
  cautions: (CitedItem & { text_ja: string })[];
  contacts: (CitedItem & { label_ja: string; phone: string })[];
  shelter_mentions: (CitedItem & { name: string; hazards_ok: string[] })[];
}

const UNSUPPORTED = new Set(["$schema", "$id", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "pattern", "minItems", "maxItems", "uniqueItems", "format"]);

export function toStructuredSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toStructuredSchema);
  if (schema === null || typeof schema !== "object") return schema;
  return Object.fromEntries(
    Object.entries(schema as Record<string, unknown>)
      .filter(([k]) => !UNSUPPORTED.has(k))
      .map(([k, v]) => [k, k === "properties" ? Object.fromEntries(Object.entries(v as object).map(([pk, pv]) => [pk, toStructuredSchema(pv)])) : toStructuredSchema(v)]),
  );
}
