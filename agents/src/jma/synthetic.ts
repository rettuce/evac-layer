import fs from "node:fs";
import path from "node:path";
import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { SYNTHETIC_PREFIX } from "../../../app/layout/replay";
import { AGENTS_DIR, DATA_DIR, SYNTHETIC_DIR } from "../paths.js";
import { parseJmaXml } from "./parse.js";
import type { SyntheticPlan } from "./synthetic-classes.js";

export const TEMPLATES_DIR = path.join(AGENTS_DIR, "src", "jma", "templates");

const TEMPLATE: Record<SyntheticPlan["code"], { file: string; title: string }> = {
  VPWW55: { file: "15_17_01_251222_VPWW55.xml", title: "大雨警報・注意報" },
  VPWW56: { file: "15_17_01_251222_VPWW56.xml", title: "土砂災害警報・注意報" },
};

const MUNICIPAL_WARNING = "気象警報・注意報（市町村等）";
const ISSUER = "気象庁";

type XmlNode = Record<string, unknown> & { ":@"?: Record<string, string> };
type Nodes = XmlNode[];

const XML_OPTIONS = { preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false, trimValues: true } as const;

export class SyntheticError extends Error {}

function nameOf(node: XmlNode): string {
  return Object.keys(node).find((k) => k !== ":@")!;
}

function childrenOf(node: XmlNode): Nodes {
  return node[nameOf(node)] as Nodes;
}

function only(nodes: Nodes, name: string): XmlNode {
  const found = nodes.filter((n) => nameOf(n) === name);
  if (found.length !== 1) throw new SyntheticError(`template: expected one <${name}>, found ${found.length}`);
  return found[0];
}

function element(name: string, value: string | Nodes): XmlNode {
  return { [name]: typeof value === "string" ? (value ? [{ "#text": value }] : []) : value };
}

function setText(nodes: Nodes, name: string, value: string): void {
  const node = only(nodes, name);
  node[name] = value ? [{ "#text": value }] : [];
}

export interface SyntheticTarget { municipalityId: string; municipalityName: string; prefecture: string }

// The sample's structure and issue time stay; the municipality, its prefecture and the warning kind are set, and every
// other area, the headline text and the free-text comments are dropped, so no place of the sample reaches the Writer.
export function synthesizeXml(plan: SyntheticPlan, target: SyntheticTarget): string {
  const template = TEMPLATE[plan.code];
  const tree = new XMLParser(XML_OPTIONS).parse(fs.readFileSync(path.join(TEMPLATES_DIR, template.file), "utf8")) as Nodes;
  const report = childrenOf(only(tree, "Report"));

  const control = childrenOf(only(report, "Control"));
  setText(control, "Status", "通常");
  setText(control, "EditorialOffice", ISSUER);
  setText(control, "PublishingOffice", ISSUER);

  const head = childrenOf(only(report, "Head"));
  setText(head, "Title", `${target.prefecture}${template.title}`);
  setText(head, "InfoType", "発表");
  const headline = only(head, "Headline");
  headline.Headline = [element("Text", "")];

  const bodyNode = only(report, "Body");
  const warning = childrenOf(bodyNode).find((n) => nameOf(n) === "Warning" && n[":@"]?.["@_type"] === MUNICIPAL_WARNING);
  if (!warning) throw new SyntheticError(`template ${template.file} has no Warning type="${MUNICIPAL_WARNING}"`);
  const item = childrenOf(warning).find((n) => nameOf(n) === "Item");
  if (!item) throw new SyntheticError(`template ${template.file} has no municipal Item`);
  const kind = [
    element("Name", plan.kind.name),
    element("Code", plan.kind.code),
    element("Status", plan.kind.status),
    ...(plan.kind.last ? [element("LastKind", [element("Name", plan.kind.last.name), element("Code", plan.kind.last.code)])] : []),
  ];
  const area = [element("Name", target.municipalityName), element("Code", `${target.municipalityId}00`)];
  const itemChildren = childrenOf(item).flatMap((n) => {
    const name = nameOf(n);
    if (name === "Kind") return [element("Kind", kind)];
    if (name === "Area") return [element("Area", area)];
    return [];
  });
  warning.Warning = [element("Item", itemChildren)];
  bodyNode.Body = [warning];

  return new XMLBuilder({ ...XML_OPTIONS, format: true, indentBy: "", suppressEmptyNode: true }).build(tree) as string;
}

export function syntheticBulletinId(xml: string): string {
  return `${SYNTHETIC_PREFIX}${parseJmaXml(xml).bulletin_id}`;
}

export function syntheticFile(municipalityId: string, bulletinId: string): string {
  return path.posix.join("synthetic", municipalityId, `${bulletinId}.xml`);
}

export function syntheticXmlPath(file: string): string {
  return path.join(DATA_DIR, file);
}

export function saveSyntheticXml(municipalityId: string, bulletinId: string, xml: string): string {
  const file = syntheticFile(municipalityId, bulletinId);
  const full = syntheticXmlPath(file);
  if (fs.existsSync(full) && fs.readFileSync(full, "utf8") === xml) return file;
  fs.mkdirSync(path.join(SYNTHETIC_DIR, municipalityId), { recursive: true });
  fs.writeFileSync(full, xml);
  return file;
}
