import fs from "node:fs";
import path from "node:path";
import { Ajv2020, type ValidateFunction, type ErrorObject } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { SCHEMA_DIR } from "./paths.js";

export type SchemaName = "layout" | "alert" | "municipality";
const SCHEMA_NAMES: SchemaName[] = ["layout", "alert", "municipality"];
const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => void;

export function readSchema(name: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, `${name}.schema.json`), "utf8"));
}

let compiled: Map<SchemaName, ValidateFunction> | undefined;

function validators(): Map<SchemaName, ValidateFunction> {
  if (compiled) return compiled;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  ajv.addSchema(readSchema("common"));
  compiled = new Map(SCHEMA_NAMES.map((n) => [n, ajv.compile(readSchema(n))]));
  return compiled;
}

export function inferSchema(doc: unknown): SchemaName {
  if (typeof doc !== "object" || doc === null) throw new Error("document is not a JSON object");
  const d = doc as Record<string, unknown>;
  if (d.kind === "evac-screen") return "layout";
  if ("bulletin_id" in d && "code" in d) return "alert";
  if ("shelters" in d && "hazards" in d) return "municipality";
  throw new Error("cannot infer schema: expected layout (kind=evac-screen), alert (bulletin_id+code) or municipality (shelters+hazards); pass --schema");
}

export interface ValidationResult {
  schema: SchemaName;
  ok: boolean;
  errors: ErrorObject[];
}

export function validateDoc(doc: unknown, schema: SchemaName = inferSchema(doc)): ValidationResult {
  const fn = validators().get(schema)!;
  const ok = fn(doc) as boolean;
  return { schema, ok, errors: fn.errors ?? [] };
}

export function formatErrors(errors: ErrorObject[]): string {
  return errors.map((e) => `  ${e.instancePath || "/"} ${e.message}${e.params ? " " + JSON.stringify(e.params) : ""}`).join("\n");
}
