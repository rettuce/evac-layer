export const OVERFLOW_SCREEN = 'screen'
export const OVERFLOW_PICTOGRAM = 'pictogram'

export interface CellOverflow {
  cellId: string
  langs: string[]
}

// data-overflow="<cell id>:<lang>,…": the lang (a text key, or "pictogram") tells the Verifier
// whether the Writer (ja_easy, en, …) or the code (ja) owns the text that spilled.
export function overflowAttr(cells: CellOverflow[], screenOverflows: boolean): string {
  const entries = cells.flatMap(({ cellId, langs }) => [...new Set(langs.length ? langs : ['ja'])].map((lang) => `${cellId}:${lang}`))
  return [...entries, ...(screenOverflows ? [OVERFLOW_SCREEN] : [])].join(',')
}
