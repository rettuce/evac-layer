export interface Preset { id: string; name: string; prefecture: string; pdfs: string[]; gsi: string[] }

// Paths are relative to RAW_DIR (see src/paths.ts).
export const PRESETS: Record<string, Preset> = {
  "17204": {
    id: "17204",
    name: "輪島市",
    prefecture: "石川県",
    pdfs: ["municipal-pdfs/wajima/kinkyu_hinan_basho.pdf", "municipal-pdfs/wajima/shitei_hinanjo.pdf", "municipal-pdfs/wajima/tsunami_hm_wajima.pdf"],
    gsi: ["gsi-shelters/17204_1.csv", "gsi-shelters/17204_2.csv"],
  },
};
