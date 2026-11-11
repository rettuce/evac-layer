import type { EvacScreen } from './types'

// The screen shows only the bulletin time and the municipality; every source behind it stays in the
// document (and on the admin page) so a delivered page can still be traced to its PDF page and bulletin.
export function sourceLines(screen: Pick<EvacScreen, 'sources' | 'alert'>): string[] {
  return screen.sources.map((source) => {
    if (source.type === 'pdf') return `自治体資料 ${source.file}${source.page === undefined ? '' : ` p.${source.page}`}`
    if (source.type === 'gsi') return `国土地理院 ${source.file ?? ''}`.trim()
    if (source.type === 'jma-dictionary') return `${source.credit ?? ''}（${source.updated ?? ''} 更新） ${source.url ?? ''}`.trim()
    const issued = source.bulletin_id === screen.alert.bulletin_id ? `（${screen.alert.issued_at}）` : ''
    return `気象庁 電文 ${source.bulletin_id ?? ''}${issued}`
  })
}
