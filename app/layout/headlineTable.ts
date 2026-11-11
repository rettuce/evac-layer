import { createHash } from 'node:crypto'

// Kept free of file reads, so the Composer (agents), the server and tests share it: each passes in the tables it read
// from data/jma/.

export type TableLang = 'en' | 'zh_hans' | 'zh_hant' | 'ko' | 'th' | 'vi' | 'fil' | 'id'
export const TABLE_LANGS: readonly TableLang[] = ['en', 'zh_hans', 'zh_hant', 'ko', 'th', 'vi', 'fil', 'id']
export type HeadlineLang = 'ja' | 'ja_easy' | TableLang
export type HeadlineText = Record<HeadlineLang, string>

export interface DictionaryRow { no: number; ja: string; text: Record<TableLang, string> }
export interface WarningNames { source?: Record<string, unknown>; cancel: DictionaryRow; names: DictionaryRow[] }
export interface JaEasyNames { reviewed: boolean; cancel: string; names: { ja: string; ja_easy: string }[] }
export interface HeadlineTables { names: WarningNames; easy: JaEasyNames }

export const DRILL_PREFIX_JA = '【訓練】'
export const DRILL_WORD: Record<Exclude<HeadlineLang, 'ja'>, string> = {
  ja_easy: 'くんれん ', en: 'DRILL: ', zh_hans: '演习：', zh_hant: '演習：', ko: '훈련: ', th: 'ฝึกซ้อม: ', vi: 'Diễn tập: ', fil: 'Pagsasanay: ', id: 'Latihan: ',
}

// The dictionary has no word for "<warning> cleared", so each language joins the warning's entry and the entry for
// 解除 (No.20) in one fixed order, adding no words of its own. An entry the dictionary ends with a full stop (the Tagalog
// tsunami names) loses it only here, where it would land mid-phrase.
export const CANCEL_FORM: Record<TableLang, (name: string, cancel: string) => string> = {
  en: (name, cancel) => `${name}: ${cancel}`,
  zh_hans: (name, cancel) => `${name}${cancel}`,
  zh_hant: (name, cancel) => `${name}${cancel}`,
  ko: (name, cancel) => `${name} ${cancel}`,
  th: (name, cancel) => `${cancel}${name}`,
  vi: (name, cancel) => `${name}: ${cancel}`,
  fil: (name, cancel) => `${name}: ${cancel}`,
  id: (name, cancel) => `${name}: ${cancel}`,
}
const SENTENCE_END = /[.。]$/

function cancelled(lang: TableLang, name: string, cancel: string): string {
  return CANCEL_FORM[lang](name.replace(SENTENCE_END, ''), cancel)
}

// A bulletin and the dictionary may spell one name with full- or half-width digits and with or without spaces.
export function warningKey(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, '')
}

// ja: the Japanese headline as composed, without the drill prefix. name: the warning whose dictionary entry gives the
// other languages; it differs from ja only on a tsunami warning cleared outright (code 50), whose ja is 警報解除.
export interface WarningOnScreen { ja: string; name: string; cleared: boolean; drill: boolean }

export function headlineFromTables(w: WarningOnScreen, tables: HeadlineTables): { text: HeadlineText } | { missing: string } {
  const key = warningKey(w.name)
  const row = tables.names.names.find((n) => warningKey(n.ja) === key)
  if (!row) return { missing: `warning name "${w.name}" is not in the JMA multilingual dictionary table (data/jma/warning-names.json); no headline translation for it` }
  const easy = tables.easy.names.find((n) => warningKey(n.ja) === key)?.ja_easy
  if (!easy) return { missing: `warning name "${w.name}" has no ja_easy headline in data/jma/warning-names-ja-easy.json` }
  const marked = (lang: Exclude<HeadlineLang, 'ja'>, text: string) => (w.drill ? `${DRILL_WORD[lang]}${text}` : text)
  const text = { ja: `${w.drill ? DRILL_PREFIX_JA : ''}${w.ja}`, ja_easy: marked('ja_easy', w.cleared ? `${easy} ${tables.easy.cancel}` : easy) } as HeadlineText
  for (const lang of TABLE_LANGS) text[lang] = marked(lang, w.cleared ? cancelled(lang, row.text[lang], tables.names.cancel.text[lang]) : row.text[lang])
  return { text }
}

// Changes when any entry, paraphrase, cancel word, drill word or joining form changes, so a check made against an
// earlier table no longer counts. The reviewed mark and the notes are not part of it: reviewing changes no headline.
export function headlineTableVersion(tables: HeadlineTables): string {
  const entries = (rows: DictionaryRow[]) => rows.map((r) => [r.no, r.ja, TABLE_LANGS.map((l) => r.text[l])])
  const content = {
    names: entries(tables.names.names), cancel: entries([tables.names.cancel]),
    easy: tables.easy.names.map((n) => [n.ja, n.ja_easy]), easy_cancel: tables.easy.cancel,
    forms: TABLE_LANGS.map((l) => cancelled(l, '{name}.', '{cancel}')), drill: DRILL_WORD, drill_ja: DRILL_PREFIX_JA,
  }
  return `sha256:${createHash('sha256').update(JSON.stringify(content)).digest('hex')}`
}

// The readings a stored Japanese headline allows: 警報解除 (tsunami code 50) does not say which warning ended, so it
// may be the cleared 津波警報 or 大津波警報.
export function warningsForHeadline(ja: string, hazard: string | undefined): WarningOnScreen[] {
  const drill = ja.startsWith(DRILL_PREFIX_JA)
  const rest = drill ? ja.slice(DRILL_PREFIX_JA.length) : ja
  const cleared = rest.endsWith('解除')
  const name = cleared ? rest.slice(0, -'解除'.length) : rest
  if (cleared && name === '警報' && hazard === 'tsunami') return ['津波警報', '大津波警報'].map((n) => ({ ja: rest, name: n, cleared, drill }))
  return [{ ja: rest, name, cleared, drill }]
}

function sameText(a: Record<string, unknown> | undefined, b: HeadlineText): boolean {
  if (!a) return false
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].every((k) => a[k] === b[k as HeadlineLang])
}

export function headlineMatchesTable(text: Record<string, unknown> | undefined, hazard: string | undefined, tables: HeadlineTables): boolean {
  const ja = text?.ja
  if (typeof ja !== 'string') return false
  return warningsForHeadline(ja, hazard).some((w) => {
    const found = headlineFromTables(w, tables)
    return 'text' in found && sameText(text, found.text)
  })
}

// What the Verifier writes into a report when it compared every shape's headline, with the bulletin, against the table.
export interface HeadlineCheck { ok: boolean; table_version: string; layout_digest: string; shapes: string[] }

interface HeadlinedLayout { alert?: { hazard?: string }; cells?: { role?: string; text?: Record<string, unknown> }[] }

type HeadlineEvidenceArgs = { files: { shape: string; body: string }[]; digest: string; report: { headline_table?: HeadlineCheck } | undefined; tables: HeadlineTables | undefined }

// A class approval may open a screen only when both say its headline is the table's: the check the Verifier made with
// the bulletin, bound to these layout files and this table, and the stored files read again here. While the ja_easy
// table is unreviewed nothing counts.
export function headlineEvidence(args: HeadlineEvidenceArgs): boolean {
  return !!args.tables?.easy.reviewed && headlineMatchesCheckedTable(args)
}

// headlineEvidence without the review of the ja_easy table, which is a gate of its own at delivery.
export function headlineMatchesCheckedTable(args: HeadlineEvidenceArgs): boolean {
  const { files, digest, report, tables } = args
  const check = report?.headline_table
  if (!tables || !check?.ok || !files.length) return false
  if (check.table_version !== headlineTableVersion(tables) || check.layout_digest !== digest) return false
  if (!files.every((f) => check.shapes.includes(f.shape))) return false
  return files.every((f) => {
    const layout = JSON.parse(f.body) as HeadlinedLayout
    const headline = layout.cells?.find((c) => c.role === 'headline')
    return headline !== undefined && headlineMatchesTable(headline.text, layout.alert?.hazard, tables)
  })
}

export interface DictionarySource { type: 'jma-dictionary'; title: string; publisher: string; url: string; updated: string; credit: string }

// The same on every screen made from one table, so it does not tell the screens of a class apart.
export function dictionarySource(tables: HeadlineTables): DictionarySource {
  const source = (tables.names.source ?? {}) as { page?: string; updated?: string; credit?: string }
  return {
    type: 'jma-dictionary', title: '多言語辞書', publisher: '気象庁',
    url: source.page ?? 'https://www.data.jma.go.jp/developer/multilingual.html',
    updated: source.updated ?? '', credit: source.credit ?? '気象庁「多言語辞書」を加工して作成',
  }
}
