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
  "05210": {
    id: "05210",
    name: "由利本荘市",
    prefecture: "秋田県",
    pdfs: [
      "municipal-pdfs/yurihonjo/hinan_honjo_2026.pdf",
      "municipal-pdfs/yurihonjo/kozui_dosha_hokubu.pdf",
      "municipal-pdfs/yurihonjo/kozui_dosha_nanbu.pdf",
      "municipal-pdfs/yurihonjo/tsunami_honjo_nishime.pdf",
      "municipal-pdfs/yurihonjo/tsunami_iwaki_matsugasaki.pdf",
    ],
    gsi: ["gsi-shelters/05210_1.csv", "gsi-shelters/05210_2.csv"],
  },
};
