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
  "15205": {
    id: "15205",
    name: "柏崎市",
    prefecture: "新潟県",
    pdfs: ["municipal-pdfs/kashiwazaki/kinkyu_hinan_basho_20261002.pdf", "municipal-pdfs/kashiwazaki/dosha_hm_2022.pdf"],
    gsi: ["gsi-shelters/15205_1.csv", "gsi-shelters/15205_2.csv"],
  },
  "22424": {
    id: "22424",
    name: "吉田町",
    prefecture: "静岡県",
    pdfs: ["municipal-pdfs/yoshida/hinanjo_list.pdf", "municipal-pdfs/yoshida/tsunami_hm_map.pdf", "municipal-pdfs/yoshida/kozui_hm_en.pdf"],
    gsi: ["gsi-shelters/22424_1.csv", "gsi-shelters/22424_2.csv"],
  },
  "14100": {
    id: "14100",
    name: "横浜市",
    prefecture: "神奈川県",
    pdfs: ["municipal-pdfs/yokohama/bousai_yokohama_ja_2026.pdf", "municipal-pdfs/yokohama/bousai_yokohama_en.pdf"],
    gsi: ["gsi-shelters/14100_1.csv", "gsi-shelters/14100_2.csv"],
  },
};
