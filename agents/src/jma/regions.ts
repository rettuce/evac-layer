// Tsunami forecast region -> municipality, limited to the demo municipalities. Region codes appear in the
// official VTSE41 samples; membership follows the JMA region definitions
// (https://www.jma.go.jp/jma/kishou/know/jishin/joho/tsunami-yohoku.html, checked 2026-11-02):
// 石川県能登 = 石川県（かほく市以南を除く）, 静岡県 = whole prefecture,
// 東京湾内湾 includes 神奈川県（観音崎東端以北の東京湾沿岸に限る）.
export const TSUNAMI_REGION_MUNICIPALITIES: Record<string, { name: string; municipalities: string[] }> = {
  "360": { name: "石川県能登", municipalities: ["17204"] },
  "380": { name: "静岡県", municipalities: ["22424"] },
  "312": { name: "東京湾内湾", municipalities: ["14100"] },
};

export function tsunamiRegionsFor(municipalityId: string): string[] {
  return Object.entries(TSUNAMI_REGION_MUNICIPALITIES)
    .filter(([, r]) => r.municipalities.includes(municipalityId))
    .map(([code]) => code);
}
