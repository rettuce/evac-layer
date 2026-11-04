// A facility name may break before its type word (広場, 小学校, センター …) and nowhere else by preference; the
// browser's phrase breaking (auto-phrase) remains the fallback. Longest words first so 高等学校 wins over 高校.
export const FACILITY_WORDS = [
  '高等学校',
  '小学校',
  '中学校',
  '高校',
  '体育館',
  '公民館',
  '会館',
  'センター',
  'グラウンド',
  'ホール',
  'タワー',
  '広場',
  '公園',
  '駅',
] as const

export function shelterNameSegments(name: string): string[] {
  const segments: string[] = []
  let rest = name
  while (rest) {
    let cut = -1
    for (const word of FACILITY_WORDS) {
      const at = rest.indexOf(word, 1)
      if (at > 0 && (cut === -1 || at < cut)) cut = at
    }
    if (cut === -1) {
      segments.push(rest)
      break
    }
    segments.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }
  return segments
}
