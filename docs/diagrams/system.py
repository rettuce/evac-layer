"""Draws docs/diagrams/system.svg: five columns, three rows, hand-placed."""
from pathlib import Path

W, H = 1600, 960
CW, CH = 250, 116
COLS = [70, 380, 690, 1000, 1310]
ROWS = [110, 440, 770]
FILL = {"card": ("#ffffff", "#555555"), "claude": ("#f1e9ff", "#6d3fc4"), "data": ("#f3f3f0", "#8a8a8a"), "human": ("#fff3d6", "#b45309")}
out = []


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;")


def cx(c):
    return COLS[c] + CW / 2


def cy(r):
    return ROWS[r] + CH / 2


def card(c, r, title, subs, kind="card"):
    fill, stroke = FILL[kind]
    x, y = COLS[c], ROWS[r]
    out.append(f'<rect x="{x}" y="{y}" width="{CW}" height="{CH}" rx="8" fill="{fill}" stroke="{stroke}" stroke-width="1.5"/>')
    ty = y + 40 if len(subs) == 2 else y + 46
    out.append(f'<text x="{x + CW / 2}" y="{ty}" text-anchor="middle" font-size="19" font-weight="700" fill="#1a1a1a">{esc(title)}</text>')
    for i, sub in enumerate(subs):
        out.append(f'<text x="{x + CW / 2}" y="{ty + 26 + i * 20}" text-anchor="middle" font-size="13.5" fill="#444">{esc(sub)}</text>')


def zone(c0, c1, r, label):
    x, y = COLS[c0] - 24, ROWS[r] - 52
    w, h = COLS[c1] + CW + 24 - x, CH + 52 + 28
    out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="#fbfbfa" stroke="#9a9a9a" stroke-width="1" stroke-dasharray="6 4"/>')
    out.append(f'<text x="{x + 16}" y="{y + 30}" font-size="17" font-weight="700" fill="#333">{esc(label)}</text>')


def arrow(x1, y1, x2, y2, label=None, dashed=False, color="#555", mid=None):
    pts = [(x1, y1)]
    if x1 != x2 and y1 != y2:
        mid = (y1 + y2) / 2 if mid is None else mid
        pts += [(x1, mid), (x2, mid)]
    pts.append((x2, y2))
    d = "M " + " L ".join(f"{x},{y}" for x, y in pts)
    dash = ' stroke-dasharray="6 4"' if dashed else ""
    marker = "ahp" if color != "#555" else "ah"
    out.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="1.5"{dash} marker-end="url(#{marker})"/>')
    if label:
        if len(pts) == 4:
            lx, ly = (pts[1][0] + pts[2][0]) / 2, pts[1][1]
        else:
            lx, ly = (x1 + x2) / 2, (y1 + y2) / 2
        w = len(label) * 12.8 + 16
        out.append(f'<rect x="{lx - w / 2}" y="{ly - 11}" width="{w}" height="22" rx="4" fill="#ffffff" stroke="{color}" stroke-width="0.8"/>')
        out.append(f'<text x="{lx}" y="{ly + 5}" text-anchor="middle" font-size="12.5" fill="{color}">{esc(label)}</text>')


def right(c0, c1, r, label=None):
    arrow(COLS[c0] + CW, cy(r), COLS[c1], cy(r), label)


def left(c0, c1, r, label=None):
    arrow(COLS[c0], cy(r), COLS[c1] + CW, cy(r), label)


zone(0, 2, 0, "平時（あらかじめ・自治体ごとに 1 回）")
zone(4, 4, 0, "スクリーンの登録（1 枚 1 回）")
zone(0, 4, 1, "有事（電文が届いたら・自動）")
zone(3, 4, 2, "検査（画面ごとに 3 段）")
zone(0, 2, 2, "承認と配信")

card(0, 0, "自治体の資料", ["ハザードマップ PDF", "国土地理院の避難場所データ"], "data")
card(1, 0, "Reader", ["Claude", "出典ページつきで読む"], "claude")
card(2, 0, "municipality.json", ["危険箇所・避難場所・出典"], "data")
card(4, 0, "site.json", ["緯度経度・向き・市町村コード"], "data")
right(0, 1, 0)
right(1, 2, 0)

card(0, 1, "気象庁 防災情報 XML", ["大雨・土砂災害・洪水・津波"], "data")
card(1, 1, "parser", ["警報・警戒レベル・対象地域"])
card(2, 1, "Writer", ["Claude", "やさしい日本語・英・中・韓"], "claude")
card(3, 1, "Composer", ["最寄りの避難場所", "方向・距離・図記号・優先順位"])
card(4, 1, "layout JSON", ["5 つの基準形状"], "data")
for c in range(4):
    right(c, c + 1, 1)

card(4, 2, "Renderer", ["Nuxt", "同じ入力なら同じ画面"])
card(3, 2, "Verifier", ["規則・ブラウザ DOM", "Vision（Claude）"], "claude")
card(2, 2, "運営者が平時に承認", ["自動配信を入れる／切る"], "human")
card(1, 2, "イベント発火", ["alert / clear のイベント", "feed・webhook・静的ファイル"])
card(0, 2, "どのスクリーンでも", ["自社のサイネージも", "他社の CMS も"], "data")
left(4, 3, 2)
left(3, 2, 2, "検査 pass")
left(2, 1, 2)
left(1, 0, 2)

arrow(cx(2), ROWS[0] + CH, cx(3) - 40, ROWS[1], "読む", mid=ROWS[0] + CH + 80)
arrow(cx(4), ROWS[0] + CH, cx(3) + 40, ROWS[1], "位置から引く", mid=ROWS[0] + CH + 110)
arrow(cx(4), ROWS[1] + CH, cx(4), ROWS[2])
arrow(cx(3) - 60, ROWS[2], cx(2) + 40, ROWS[1] + CH, "指摘を差し戻す（最大 3 回）", dashed=True, color="#6d3fc4", mid=ROWS[1] + CH + 95)

svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="'Noto Sans JP','Hiragino Sans','Yu Gothic',sans-serif">
<defs>
<marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#555"/></marker>
<marker id="ahp" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#6d3fc4"/></marker>
</defs>
<rect width="{W}" height="{H}" fill="#ffffff"/>
<text x="46" y="40" font-size="22" font-weight="700" fill="#1a1a1a">EVAC LAYER の仕組み</text>
<text x="{W - 46}" y="40" text-anchor="end" font-size="13" fill="#666">紫 = Claude が読む・書く・見る　橙 = 人が決める　灰 = データ</text>
{chr(10).join(out)}
</svg>
"""
Path(__file__).with_name("system.svg").write_text(svg)
