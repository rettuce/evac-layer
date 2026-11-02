import type Anthropic from "@anthropic-ai/sdk";

export interface Citation { file: string; page: number; method: "citation" | "vision"; cited_text: string | null }
export interface Claim { text: string; citation_ids: string[] }

export function collectClaims(content: Anthropic.ContentBlock[], files: string[]) {
  const citations = new Map<string, Citation>();
  const claims: Claim[] = [];
  for (const block of content) {
    if (block.type !== "text" || !block.citations?.length) continue;
    const ids: string[] = [];
    for (const c of block.citations) {
      if (c.type !== "page_location") throw new Error(`unexpected citation type ${c.type}; PDFs should yield page_location`);
      const file = files[c.document_index] ?? (() => { throw new Error(`citation points at document_index ${c.document_index}, only ${files.length} documents sent`); })();
      const id = `C${citations.size + 1}`;
      citations.set(id, { file, page: c.start_page_number, method: "citation", cited_text: c.cited_text.trim() });
      ids.push(id);
    }
    claims.push({ text: block.text.trim(), citation_ids: ids });
  }
  return { claims, citations };
}

export function renderClaims(claims: Claim[], citations: Map<string, Citation>): string {
  return claims
    .map((cl) => {
      const refs = cl.citation_ids.map((id) => {
        const c = citations.get(id)!;
        const quote = c.cited_text === null ? "（ページ画像から読み取り・引用文なし）" : `「${c.cited_text.replace(/\s+/g, " ")}」`;
        return `  ${id} = ${c.file} p.${c.page} ${quote}`;
      });
      return `- ${cl.text}\n${refs.join("\n")}`;
    })
    .join("\n");
}

export function addVisionClaims(claims: Claim[], citations: Map<string, Citation>, file: string, page: number, lines: string[]) {
  for (const text of lines.map((l) => l.trim()).filter(Boolean)) {
    const id = `C${citations.size + 1}`;
    citations.set(id, { file, page, method: "vision", cited_text: null });
    claims.push({ text, citation_ids: [id] });
  }
}
