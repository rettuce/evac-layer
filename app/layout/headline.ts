// "レベル５" is read as one word; a JMA headline may only wrap after it.
const LEVEL_LEAD = /^(レベル\s*[0-9０-９])\s*(.+)$/

export function headlineParts(text: string): { lead?: string; rest: string } {
  const match = LEVEL_LEAD.exec(text)
  return match ? { lead: match[1]!.replace(/\s+/g, ''), rest: match[2]! } : { rest: text }
}
