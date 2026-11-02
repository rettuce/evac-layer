export type Hazard = "heavy_rain" | "landslide" | "flood" | "tsunami";
export type BulletinCode = "VPWW55" | "VPWW56" | "VXKOii" | "VTSE41";
export type AreaStatus = "issued" | "continued" | "upgraded" | "downgraded" | "cleared" | "none";
export type TsunamiCategory = "major_warning" | "warning" | "advisory" | "forecast" | "cleared" | "none";

// The XML body does not carry the WMO header, so the bulletin type is identified from Control/Title.
export const CONTROL_TITLE_TO_CODE: ReadonlyArray<[RegExp, BulletinCode]> = [
  [/^気象警報・注意報（Ｒ０６）（大雨）$/, "VPWW55"],
  [/^気象警報・注意報（Ｒ０６）（土砂）$/, "VPWW56"],
  [/^指定河川洪水予報$/, "VXKOii"],
  [/^津波警報・注意報・予報/, "VTSE41"],
];

export const CODE_TO_HAZARD: Record<BulletinCode, Hazard> = {
  VPWW55: "heavy_rain",
  VPWW56: "landslide",
  VXKOii: "flood",
  VTSE41: "tsunami",
};

export const INFO_TYPE: Record<string, "issued" | "corrected" | "cancelled"> = {
  発表: "issued",
  訂正: "corrected",
  取消: "cancelled",
};

// Kind codes observed in the official samples (jmaxml_20260917_Samples). Names without "レベルN"
// (pre-R6 flood forecast names) are resolved through this table; R6 names must agree with it.
export const KIND_CODE_LEVEL: Record<BulletinCode, Record<string, number | null>> = {
  VPWW55: { "10": 2, "03": 3, "43": 4 },
  VPWW56: { "29": 2, "09": 3, "49": 4 },
  VXKOii: { "10": null, "20": 2, "30": 3, "31": 3, "40": 4, "41": 4, "51": 5, "53": 5 },
  VTSE41: {},
};

// Body Item/Kind/Status values seen in the official samples and in the recorded long feed (2026-10-11..11-02).
export const VPWW_STATUS: Record<string, "present" | "cleared" | "none"> = {
  発表: "present",
  継続: "present",
  警報から注意報: "present",
  危険警報から注意報: "present",
  解除: "cleared",
  "発表警報・注意報はなし": "none",
};

export const TSUNAMI_KIND: Record<string, TsunamiCategory> = {
  "00": "none",
  "50": "cleared",
  "51": "warning",
  "52": "major_warning",
  "53": "major_warning",
  "60": "cleared",
  "62": "advisory",
  "71": "forecast",
  "72": "forecast",
  "73": "forecast",
};

export const TSUNAMI_RANK: Record<TsunamiCategory, number> = {
  none: 0,
  cleared: 0,
  forecast: 1,
  advisory: 2,
  warning: 3,
  major_warning: 4,
};

const FULLWIDTH_DIGITS = "０１２３４５６７８９";

export function levelFromName(name: string): number | null {
  const m = name.match(/レベル([0-9０-９])/);
  if (!m) return null;
  const d = m[1];
  const fw = FULLWIDTH_DIGITS.indexOf(d);
  return fw >= 0 ? fw : Number(d);
}
