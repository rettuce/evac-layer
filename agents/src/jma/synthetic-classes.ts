import { tsunamiRegionsFor } from "./regions.js";

export interface SyntheticKind { name: string; code: string; status: "発表" | "解除"; last?: { name: string; code: string } }

export interface TsunamiKind { name: string; code: string; last: { name: string; code: string } }

// title: Head/Title of a VTSE41, the kinds the bulletin carries, or 津波予報 once every warning and advisory has ended
// (地震火山関連_解説資料, Head/Title).
export type SyntheticPlan =
  | { cls: string; code: "VPWW55" | "VPWW56"; kind: SyntheticKind }
  | { cls: string; code: "VTSE41"; title: string; kind: TsunamiKind };

export type ClassListing = ({ supported: true } & SyntheticPlan) | { cls: string; supported: false; reason: string };

// An all-clear shows what ended. The one composed here is the clearance of the level 2 advisory, the way a warning
// ended in every recorded bulletin (warning → advisory → 解除); a warning cleared outright gets its own wording.
const PLANS: readonly SyntheticPlan[] = [
  { cls: "heavy_rain/evac-prepare/3", code: "VPWW55", kind: { name: "レベル３大雨警報", code: "03", status: "発表" } },
  { cls: "heavy_rain/evac-now/4", code: "VPWW55", kind: { name: "レベル４大雨危険警報", code: "43", status: "発表" } },
  { cls: "heavy_rain/all-clear/1", code: "VPWW55", kind: { name: "レベル２大雨注意報", code: "10", status: "解除", last: { name: "レベル２大雨注意報", code: "10" } } },
  { cls: "landslide/evac-prepare/3", code: "VPWW56", kind: { name: "レベル３土砂災害警報", code: "09", status: "発表" } },
  { cls: "landslide/evac-now/4", code: "VPWW56", kind: { name: "レベル４土砂災害危険警報", code: "49", status: "発表" } },
  { cls: "landslide/all-clear/1", code: "VPWW56", kind: { name: "レベル２土砂災害注意報", code: "29", status: "解除", last: { name: "レベル２土砂災害注意報", code: "29" } } },
];

const NO_TSUNAMI = { name: "津波なし", code: "00" };

// Each warning is a first bulletin (LastKind 津波なし). The all-clear, as above, ends the advisory (code 60): a warning
// cleared outright (code 50) composes the same class and wording, and a drop to a forecast (code 71-73) adds a caution
// that gives it wording of its own.
const TSUNAMI_PLANS: readonly SyntheticPlan[] = [
  { cls: "tsunami/evac-now/2", code: "VTSE41", title: "津波注意報", kind: { name: "津波注意報", code: "62", last: NO_TSUNAMI } },
  { cls: "tsunami/evac-now/3", code: "VTSE41", title: "津波警報", kind: { name: "津波警報", code: "51", last: NO_TSUNAMI } },
  { cls: "tsunami/evac-now/4", code: "VTSE41", title: "大津波警報", kind: { name: "大津波警報：発表", code: "53", last: NO_TSUNAMI } },
  { cls: "tsunami/all-clear/1", code: "VTSE41", title: "津波予報", kind: { name: "津波注意報解除", code: "60", last: { name: "津波注意報", code: "62" } } },
];

const LEVEL5_HELD = "level 5 special warning: no recorded or sample bulletin to model it on; held";
const FLOOD_LATER = "flood forecast (VXKO): needs the river and forecast area that cover the municipality; not yet synthesized";

export function classListing(municipalityId: string): ClassListing[] {
  const unsupported = (cls: string, reason: string): ClassListing => ({ cls, supported: false, reason });
  return [
    ...PLANS.map((p): ClassListing => ({ supported: true, ...p })),
    unsupported("heavy_rain/secure-now/5", LEVEL5_HELD),
    unsupported("landslide/secure-now/5", LEVEL5_HELD),
    ...["flood/evac-prepare/3", "flood/evac-now/4", "flood/secure-now/5", "flood/all-clear/1"].map((cls) => unsupported(cls, FLOOD_LATER)),
    ...(tsunamiRegionsFor(municipalityId).length ? TSUNAMI_PLANS.map((p): ClassListing => ({ supported: true, ...p })) : []),
  ];
}

// JIS X 0401: a municipality code begins with its prefecture's code.
const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
  "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
  "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
] as const;

export function prefectureOf(municipalityId: string): string {
  const name = PREFECTURES[Number(municipalityId.slice(0, 2)) - 1];
  if (!name) throw new Error(`municipality code ${municipalityId} has no prefecture`);
  return name;
}
