import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MUNICIPALITIES_DIR, RAW_DIR } from "../paths.js";
import { formatErrors, validateDoc } from "../schemas.js";
import { readGsiCsv } from "./gsi.js";

const MUNICIPALITIES: Record<string, string> = { "17204": "輪島市", "22424": "吉田町", "14100": "横浜市", "05210": "由利本荘市", "15205": "柏崎市" };
// Retrieval dates of the CSVs under RAW_DIR/gsi-shelters, as recorded in the raw data manifest.
const RETRIEVED: Record<string, string> = { "17204": "2026-10-19", "22424": "2026-10-19", "14100": "2026-10-19", "05210": "2026-11-02", "15205": "2026-11-02" };
const CSV_URL = (file: string) => `https://hinanmap.gsi.go.jp/hinanjocp/defaultFtpData/csv/${file}`;
const NOTICE_URL = "https://www.gsi.go.jp/bousaichiri/hinanbasho-menseki.html";
const NOTICE_JA = "最新でない場合や未掲載の場合があるため、最新かつ詳細の状況などは必ず当該市町村にご確認ください。";

const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(MUNICIPALITIES);
for (const id of ids) {
  const name = MUNICIPALITIES[id] ?? (() => { throw new Error(`unknown municipality ${id}`); })();
  const files = [`${id}_2.csv`, `${id}_1.csv`];
  const shelters = files.flatMap((f) => readGsiCsv(path.join(RAW_DIR, "gsi-shelters", f)));
  const doc = {
    municipality_id: id,
    name,
    provenance: {
      publisher: "国土地理院",
      dataset: "指定緊急避難場所データ・指定避難所データ",
      license: "PDL1.0",
      attribution: "出典：国土地理院ウェブサイト（https://hinanmap.gsi.go.jp/）",
      edited: "EVAC LAYER が CSV の列を JSON に対応付けた（施設名・住所・座標・災害種別の値は変更していない）",
      notice_ja: NOTICE_JA,
      notice_url: NOTICE_URL,
      files: files.map((f) => {
        const abs = path.join(RAW_DIR, "gsi-shelters", f);
        return { file: f, url: CSV_URL(f), retrieved: RETRIEVED[id], sha256: crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex"), rows: readGsiCsv(abs).length };
      }),
    },
    counts: {
      emergency_evacuation_site: shelters.filter((s) => s.kind === "emergency_evacuation_site").length,
      evacuation_shelter: shelters.filter((s) => s.kind === "evacuation_shelter").length,
    },
    shelters: [...shelters].sort((a, b) => a.source.id.localeCompare(b.source.id) || a.kind.localeCompare(b.kind)),
  };
  const out = path.join(MUNICIPALITIES_DIR, `${id}.shelters.json`);
  fs.mkdirSync(MUNICIPALITIES_DIR, { recursive: true });
  fs.writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
  const byHazard = Object.fromEntries(["tsunami", "flood", "landslide", "storm_surge", "earthquake", "large_fire", "inland_flood", "volcano"].map((h) => [h, shelters.filter((s) => s.hazards_ok.includes(h as never)).length]));
  console.log(JSON.stringify({ id, name, ...doc.counts, by_hazard: byHazard, out: path.relative(process.cwd(), out) }));
}
