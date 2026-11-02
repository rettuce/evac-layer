import type Anthropic from "@anthropic-ai/sdk";

export interface Citation { file: string; page: number; method: "citation" | "vision"; cited_text: string | null }
export interface Claim { text: string; citation_ids: string[] }

export function collectClaims(content: Anthropic.ContentBlock[], files: string[]) {
  const citations = new Map<string, Citation>();
  const claims: Claim[] = [];
  // The model often writes the category tag ("[施設:…]") in an uncited block right before the cited fact, so the
  // latest uncited line is carried onto the next claim as its context.
  let context = "";
  for (const block of content) {
    if (block.type !== "text") continue;
    if (!block.citations?.length) {
      const lines = block.text.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length) context = lines[lines.length - 1];
      continue;
    }
    const ids: string[] = [];
    for (const c of block.citations) {
      if (c.type !== "page_location") throw new Error(`unexpected citation type ${c.type}; PDFs should yield page_location`);
      const file = files[c.document_index] ?? (() => { throw new Error(`citation points at document_index ${c.document_index}, only ${files.length} documents sent`); })();
      const id = `C${citations.size + 1}`;
      citations.set(id, { file, page: c.start_page_number, method: "citation", cited_text: c.cited_text.trim() });
      ids.push(id);
    }
    const text = block.text.trim();
    claims.push({ text: context && !text.startsWith("[") ? `${context} ${text}` : text, citation_ids: ids });
    context = "";
  }
  return { claims, citations };
}

// Page-level PDF citations can quote a whole page; stage 2 only needs to recognise the passage, so the prompt
// carries the start of the quote while the knowledge file keeps it whole.
const QUOTE_CHARS_IN_PROMPT = 60;
const clip = (t: string) => ([...t].length > QUOTE_CHARS_IN_PROMPT ? `${[...t].slice(0, QUOTE_CHARS_IN_PROMPT).join("")}…` : t);

export function renderClaims(claims: Claim[], citations: Map<string, Citation>): string {
  return claims
    .map((cl) => {
      const refs = cl.citation_ids.map((id) => {
        const c = citations.get(id)!;
        const quote = c.cited_text === null ? "（ページ画像から読み取り・引用文なし）" : `「${clip(c.cited_text.replace(/\s+/g, " "))}」`;
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
