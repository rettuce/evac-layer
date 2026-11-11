# Builds data/jma/warning-names.json from the JMA multilingual dictionary (https://www.data.jma.go.jp/developer/multilingual.html), entries as written:
#   curl -O https://www.data.jma.go.jp/developer/jma_multilingual.xlsx
#   uv run --with openpyxl python scripts/jma-warning-names.py jma_multilingual.xlsx --updated 2026-03-26 --retrieved 2026-11-11 > data/jma/warning-names.json
import argparse
import json
import sys

from openpyxl import load_workbook

SHEET = "多言語辞書（本体）"
LANG_COLUMNS = {
    "en": "英語",
    "zh_hans": "中国語(簡体字)",
    "zh_hant": "中国語(繁体字)",
    "ko": "韓国語",
    "th": "タイ語",
    "vi": "ベトナム語",
    "fil": "タガログ語",
    "id": "インドネシア語",
}
CANCEL = (20, "解除")
# The dictionary's own 解除 for the tsunami warnings (英語 "Lifted"). It joins the names the dictionary files under the same
# 情報種別等 (津波警報・注意報); every other name keeps CANCEL.
TSUNAMI_CANCEL = (923, "解除")
# Every name the Composer can put in a headline: the R6 names of the heavy rain, landslide and flood bulletins at
# levels 2 to 5 (a level 2 name appears only cleared), the tsunami categories, and the pre-R6 flood forecast names
# that agents/src/jma/codes.ts still reads. Storm surge is left out: no bulletin EVAC LAYER parses carries it.
NAMES = [
    (7264, "レベル５氾濫特別警報"),
    (7265, "レベル５土砂災害特別警報"),
    (7266, "レベル５大雨特別警報"),
    (7268, "レベル４氾濫危険警報"),
    (7269, "レベル４土砂災害危険警報"),
    (7270, "レベル４大雨危険警報"),
    (7272, "レベル３氾濫警報"),
    (7273, "レベル３土砂災害警報"),
    (7274, "レベル３大雨警報"),
    (7276, "レベル２氾濫注意報"),
    (7277, "レベル２土砂災害注意報"),
    (7278, "レベル２大雨注意報"),
    (915, "大津波警報"),
    (916, "津波警報"),
    (917, "津波注意報"),
    (244, "氾濫注意情報"),
    (246, "氾濫警戒情報"),
    (247, "氾濫危険情報"),
    (248, "氾濫発生情報"),
]


def read_rows(path):
    sheet = load_workbook(path, read_only=True, data_only=True)[SHEET]
    rows = sheet.iter_rows(values_only=True)
    header = [str(c).strip() if c is not None else "" for c in next(rows)]
    col = {name: header.index(name) for name in ["No.", "情報種別等", "日本語", *LANG_COLUMNS.values()]}
    by_no = {}
    for r in rows:
        try:
            by_no[int(r[col["No."]])] = r
        except (TypeError, ValueError):
            continue
    return by_no, col


def entry(by_no, col, no, ja):
    row = by_no.get(no)
    if row is None:
        sys.exit(f"No.{no} is not in the sheet {SHEET}")
    if str(row[col["日本語"]]).strip() != ja:
        sys.exit(f"No.{no} is {row[col['日本語']]!r}, expected {ja!r}: the dictionary was renumbered, check the list")
    text = {}
    for lang, column in LANG_COLUMNS.items():
        value = row[col[column]]
        if value is None or not str(value).strip():
            sys.exit(f"No.{no} {ja} has no {column}")
        text[lang] = str(value).strip()
    return {"no": no, "ja": ja, "text": text}


def category(by_no, col, no):
    return str(by_no[no][col["情報種別等"]]).strip()


def tsunami_cancel(by_no, col):
    row = entry(by_no, col, *TSUNAMI_CANCEL)
    kind = category(by_no, col, TSUNAMI_CANCEL[0])
    applies_to = [ja for no, ja in NAMES if category(by_no, col, no) == kind]
    if not applies_to:
        sys.exit(f"No.{TSUNAMI_CANCEL[0]} is filed under {kind!r}, and no name of the list is")
    return {**row, "applies_to": applies_to}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("xlsx")
    parser.add_argument("--updated", required=True, help="the dictionary's update date shown on its page")
    parser.add_argument("--retrieved", required=True, help="the date the file was downloaded")
    args = parser.parse_args()
    by_no, col = read_rows(args.xlsx)
    table = {
        "source": {
            "title": "多言語辞書",
            "publisher": "気象庁",
            "page": "https://www.data.jma.go.jp/developer/multilingual.html",
            "file": "https://www.data.jma.go.jp/developer/jma_multilingual.xlsx",
            "sheet": SHEET,
            "updated": args.updated,
            "retrieved": args.retrieved,
            "terms": "気象庁ホームページ利用規約（公共データ利用規約（第1.0版）に準拠）",
            "terms_url": "https://www.jma.go.jp/jma/kishou/info/coment.html",
            "credit": "気象庁「多言語辞書」を加工して作成",
            "processing": "EVAC LAYER が見出しに出す警報名の行と「解除」の行（No.20 と、津波警報・注意報の No.923）だけを抜き出し、8 言語の列だけを残した。訳語は前後の空白を除いたほかは辞書の表記のまま。no は辞書の No.。解除の見出しは警報名の訳と「解除」の訳を言語ごとに決めた形で並べる（app/layout/headlineTable.ts の CANCEL_FORM）。「解除」の訳は、辞書が No.923 と同じ情報種別等（津波警報・注意報）に置く警報名（tsunami_cancel.applies_to）には No.923、ほかの警報名には No.20 を使う。そのとき警報名の訳の末尾の句点（. 。）だけを外す。表の値は外さない。",
            "generator": "scripts/jma-warning-names.py",
        },
        "languages": LANG_COLUMNS,
        "cancel": entry(by_no, col, *CANCEL),
        "tsunami_cancel": tsunami_cancel(by_no, col),
        "names": [entry(by_no, col, no, ja) for no, ja in NAMES],
    }
    sys.stdout.write(json.dumps(table, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
