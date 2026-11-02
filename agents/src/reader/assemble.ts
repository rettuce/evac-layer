import type { Citation } from "./claims.js";
import type { Extraction } from "./extraction.js";
import type { Shelter } from "./gsi.js";

export interface SourceMeta { type: "pdf" | "gsi"; file: string; title: string; year: number | null; pages: number | null; sha256?: string }

export const normalizeName = (s: string) => s.normalize("NFKC").replace(/\s+/g, "");

function resolve(citations: Map<string, Citation>, id: string, what: string): Citation {
  const c = citations.get(id);
  if (!c) throw new Error(`stage 2 cited ${id} for ${what}, which is not in the stage 1 citation list`);
  return c;
}

function candidates(name: string, shelters: Shelter[]): string[] {
  const n = normalizeName(name).replace(/[（(].*?[）)]/g, "");
  return [...new Set(shelters.map((s) => s.name).filter((g) => {
    const gn = normalizeName(g).replace(/[（(].*?[）)]/g, "");
    return gn.includes(n) || n.includes(gn);
  }))].sort();
}

export function assemble(args: {
  id: string; name: string; prefecture: string; model: string; readerVersion: string;
  extraction: Extraction; citations: Map<string, Citation>; shelters: Shelter[]; pdfSources: SourceMeta[]; gsiSources: SourceMeta[];
}) {
  const { extraction: x, citations, shelters } = args;
  const titles = new Map(x.documents.map((d) => [d.file, d]));
  const sources = [
    ...args.pdfSources.map((s) => ({ ...s, title: titles.get(s.file)?.title || s.title, year: titles.get(s.file)?.year ?? s.year })),
    ...args.gsiSources,
  ];
  const gsiNames = new Set(shelters.map((s) => normalizeName(s.name)));
  const conflicts = x.shelter_mentions
    .filter((m) => !gsiNames.has(normalizeName(m.name)))
    .map((m) => ({
      kind: "shelter_name" as const,
      pdf_name: m.name,
      pdf_source: resolve(citations, m.citation_id, `shelter ${m.name}`),
      gsi_candidates: candidates(m.name, shelters),
      note_ja: "PDF の施設名が国土地理院データの施設名と一致しない。画面には出さない。",
    }))
    .sort((a, b) => a.pdf_name.localeCompare(b.pdf_name, "ja"));
  const byText = <T extends { text_ja: string }>(a: T, b: T) => a.text_ja.localeCompare(b.text_ja, "ja");
  return {
    id: args.id,
    name: args.name,
    prefecture: args.prefecture,
    sources,
    hazards: x.hazards.map((h) => {
      const source = resolve(citations, h.citation_id, `hazard ${h.type}`);
      return { type: h.type, areas: h.areas, notes_ja: h.notes_ja, source_page: source.page, source };
    }),
    routes: x.routes.map((r) => ({ text_ja: r.text_ja, source: resolve(citations, r.citation_id, "route") })).sort(byText),
    cautions: x.cautions.map((r) => ({ text_ja: r.text_ja, source: resolve(citations, r.citation_id, "caution") })).sort(byText),
    shelters: [...shelters].sort((a, b) => a.source.id.localeCompare(b.source.id)),
    contacts: x.contacts.map((c) => ({ label_ja: c.label_ja, phone: c.phone.replace(/[‐－ー−]/g, "-").replace(/\s/g, ""), source: resolve(citations, c.citation_id, `contact ${c.label_ja}`) })),
    conflicts,
    provenance: { reader_version: args.readerVersion, model: args.model },
  };
}
