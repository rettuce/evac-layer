import fs from "node:fs";
import path from "node:path";
import { Ajv2020, type ValidateFunction, type ErrorObject } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { SCHEMA_DIR } from "./paths.js";

export type SchemaName = "layout" | "alert" | "municipality" | "shelters" | "feed" | "export-manifest" | "site" | "municipality-preset";
const SCHEMA_NAMES: SchemaName[] = ["layout", "alert", "municipality", "shelters", "feed", "export-manifest", "site", "municipality-preset"];
const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => void;

export function readSchema(name: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, `${name}.schema.json`), "utf8"));
}

// layout.schema.json and feed.schema.json are what receivers validate against, so the files accept unknown optional
// fields (an added optional field is compatible and does not change feed_version). Our own output is checked against
// the same files with additionalProperties:false added at the objects below, so a misspelt field name in a cell is
// still caught here. A new object in either file that should be closed internally is added to this list.
const CLOSED_WHEN_STRICT: Record<string, string[]> = {
  layout: ["", "/properties/municipality", "/properties/alert", "/$defs/cell", "/$defs/text", "/$defs/source/oneOf/0", "/$defs/source/oneOf/1", "/$defs/source/oneOf/2", "/$defs/source/oneOf/3"],
  feed: ["", "/properties/site", "/properties/alert/anyOf/1", "/properties/layouts", "/properties/assets", "/$defs/asset"],
};

export function closeObjects(name: string, schema: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(schema);
  for (const pointer of CLOSED_WHEN_STRICT[name] ?? []) {
    let node: unknown = copy;
    for (const part of pointer.split("/").slice(1)) node = (node as Record<string, unknown>)[part];
    if (typeof node !== "object" || node === null) throw new Error(`schema/${name}.schema.json has no object at ${pointer}`);
    (node as Record<string, unknown>).additionalProperties = false;
  }
  return copy;
}

const compiled = new Map<boolean, Map<SchemaName, ValidateFunction>>();

function validators(publicMode: boolean): Map<SchemaName, ValidateFunction> {
  const cached = compiled.get(publicMode);
  if (cached) return cached;
  const load = (name: string) => (publicMode ? readSchema(name) : closeObjects(name, readSchema(name)));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  ajv.addSchema(readSchema("common"));
  ajv.addSchema(load("layout"));
  const map = new Map(SCHEMA_NAMES.map((n) => [n, n === "layout" ? ajv.getSchema("https://evac-layer.dev/schema/layout.schema.json")! : ajv.compile(load(n))]));
  compiled.set(publicMode, map);
  return map;
}

export function inferSchema(doc: unknown): SchemaName {
  if (typeof doc !== "object" || doc === null) throw new Error("document is not a JSON object");
  const d = doc as Record<string, unknown>;
  if (d.kind === "evac-screen") return "layout";
  if ("bulletin_id" in d && "code" in d) return "alert";
  if ("shelters" in d && "hazards" in d) return "municipality";
  if ("shelters" in d && "municipality_id" in d) return "shelters";
  if ("feed_version" in d && "state" in d) return "feed";
  if ("feed_version" in d && "entries" in d) return "export-manifest";
  if ("municipality_id" in d && "lat" in d && "lng" in d) return "site";
  if ("pdfs" in d && "gsi" in d) return "municipality-preset";
  throw new Error("cannot infer schema: expected layout (kind=evac-screen), alert (bulletin_id+code), municipality (shelters+hazards), site (municipality_id+lat+lng) or municipality-preset (pdfs+gsi); pass --schema");
}

export interface ValidationResult {
  schema: SchemaName;
  ok: boolean;
  errors: ErrorObject[];
}

export interface ValidateOptions {
  /** Validate as a receiver would, with the published schema files as they are. Default: strict. */
  public?: boolean;
}

export function validateDoc(doc: unknown, schema: SchemaName = inferSchema(doc), options: ValidateOptions = {}): ValidationResult {
  const fn = validators(options.public === true).get(schema)!;
  const ok = fn(doc) as boolean;
  return { schema, ok, errors: fn.errors ?? [] };
}

export function formatErrors(errors: ErrorObject[]): string {
  return errors.map((e) => `  ${e.instancePath || "/"} ${e.message}${e.params ? " " + JSON.stringify(e.params) : ""}`).join("\n");
}
