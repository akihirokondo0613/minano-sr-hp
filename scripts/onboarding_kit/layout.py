"""連絡票・入社書類PDFの共通レイアウト（1ページ目＝入力欄、2ページ目＝赤字の架空記入例）。

Codex期間の tmp/procedure_forms/build_forms.py の描画部分を取り込んだもの。
座標・文字サイズ・色は公開版（2026-10-05 生成）と同じ。原稿は procedure_forms.json・kit_forms.json。
"""

from html import escape
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph

import form_font

OFFICE = "みなの社会保険労務士事務所"
FOOTER = OFFICE + "　minano-sr.com"

INK = colors.HexColor("#25312C")
GREEN = colors.HexColor("#265D50")
MUTED = colors.HexColor("#56645D")
LINE = colors.HexColor("#A4B1AA")
PALE = colors.HexColor("#F0F4F1")
BOX = colors.HexColor("#F8FAF9")
RED = colors.HexColor("#B42318")
WIDTH = A4[0] - 76
LEFT = 38


def setup_fonts(font_dir):
    """本文用のメイリオ（標準・太字）を登録し、入力欄用フォントの所在も合わせる。"""
    font_dir = Path(font_dir)
    for name, filename in [("Meiryo", "meiryo.ttc"), ("MeiryoBold", "meiryob.ttc")]:
        path = font_dir / filename
        if not path.is_file():
            raise FileNotFoundError(
                f"フォントが見つかりません: {path}（--font-dir で指定）"
            )
        pdfmetrics.registerFont(TTFont(name, str(path)))
    pdfmetrics.registerFontFamily("Meiryo", normal="Meiryo", bold="MeiryoBold")
    form_font.FONT = str(font_dir / "meiryo.ttc")


def _style(name, font, size, leading, color):
    return ParagraphStyle(
        name,
        fontName=font,
        fontSize=size,
        leading=leading,
        wordWrap="CJK",
        textColor=color,
    )


styles = {
    "body": _style("body", "Meiryo", 9, 13.6, INK),
    "label": _style("label", "MeiryoBold", 9, 12, INK),
    "small": _style("small", "Meiryo", 8.4, 12.3, MUTED),
    "group": _style("group", "MeiryoBold", 10, 14, INK),
    "example": _style("example", "Meiryo", 9, 12, RED),
}


def para(text, style):
    return Paragraph(escape(text).replace("\n", "<br/>"), styles[style])


def paragraph(c, text, x, top, width, style="body"):
    p = para(text, style)
    _, h = p.wrap(width, 1000)
    p.drawOn(c, x, top - h)
    return h


def row_height(row, width):
    gaps = 8 * (len(row["fields"]) - 1)
    usable = width - gaps
    labels = []
    for spec in row["fields"]:
        w = usable * spec.get("ratio", 1 / len(row["fields"]))
        labels.append(para(spec["label"], "label").wrap(w, 1000)[1])
    return max(labels) + row.get("box", 21) + 5


def draw_row(c, row, x, top, width, slug, example):
    height = row_height(row, width)
    gaps = 8 * (len(row["fields"]) - 1)
    usable = width - gaps
    box = row.get("box", 21)
    label_h = height - box - 5
    for spec in row["fields"]:
        w = usable * spec.get("ratio", 1 / len(row["fields"]))
        paragraph(c, spec["label"], x, top, w, "label")
        y = top - label_h - 2 - box
        if example:
            c.setFillColor(colors.white)
            c.setStrokeColor(LINE)
            c.setLineWidth(0.55)
            c.rect(x, y, w, box, fill=1, stroke=1)
            value = spec.get("example", "資料参照")
            h = paragraph(c, value, x + 4, y + box - 3, w - 8, "example")
            if h > box - 3:
                raise ValueError(("記入例の枠不足", slug, spec["name"], h, box))
        else:
            c.acroForm.textfield(
                name=slug + "_" + spec["name"],
                tooltip=spec.get("tooltip", spec["label"]),
                x=x,
                y=y,
                width=w,
                height=box,
                fontName="Helvetica",
                fontSize=10,
                borderWidth=0.6,
                borderColor=LINE,
                fillColor=BOX,
                textColor=INK,
                forceBorder=True,
                value="",
                maxlen=spec.get("maxlen", 500),
                fieldFlags=" ".join(
                    flag
                    for flag, enabled in (
                        ("multiline", spec.get("multiline") or box > 30),
                        ("required", spec.get("required")),
                    )
                    if enabled
                ),
            )
        x += w + 8
    return height


def _company(c, product, top, example):
    for row in product["company_rows"]:
        top -= draw_row(c, row, LEFT, top, WIDTH, product["slug"], example)
    return top - 4


def _group(c, product, section, number, top, example):
    c.setFillColor(PALE)
    c.rect(LEFT, top - 20, WIDTH, 20, fill=1, stroke=0)
    paragraph(
        c, str(number) + "　" + section["title"], LEFT + 8, top - 3, WIDTH - 16, "group"
    )
    y = top - 25
    for row in section["rows"]:
        y -= draw_row(c, row, LEFT, y, WIDTH, product["slug"], example)
    return y - 4


def page(c, product, example):
    c.setFillColor(GREEN)
    c.rect(LEFT, A4[1] - 36, 31, 3, fill=1, stroke=0)
    c.setFillColor(MUTED)
    c.setFont("Meiryo", 9)
    c.drawString(LEFT + 43, A4[1] - 36, OFFICE)
    c.setFont("MeiryoBold", 9)
    c.drawRightString(
        A4[0] - LEFT,
        A4[1] - 36,
        "赤字＝記入例｜架空の情報"
        if example
        else product.get("input_badge", "入力用｜1名分"),
    )
    c.setFillColor(INK)
    c.setFont("MeiryoBold", 22)
    c.drawString(LEFT, A4[1] - 69, product["title"])
    top = A4[1] - 80
    top -= paragraph(c, product["subtitle"], LEFT, top, WIDTH, "body") + 6
    input_intro = product.get(
        "input_intro",
        "枠に入力して保存してください。添付資料で分かる欄は「資料参照」。記入例・確認先は2ページ目へ。",
    )
    example_intro = product.get(
        "example_intro",
        "赤字は架空の記入例です。1枚目に実際の情報を入力してください。住所は欄ごとに分けて記入します。",
    )
    paragraph(c, example_intro if example else input_intro, LEFT, top, WIDTH, "small")
    # 案内文の行数が異なっても、入力用と記入例の各欄の位置を一致させる。
    intro_height = max(
        para(t, "small").wrap(WIDTH, 1000)[1] for t in (input_intro, example_intro)
    )
    top -= intro_height + 6
    top = _company(c, product, top, example)
    for number, section in enumerate(product["sections"], 1):
        top = _group(c, product, section, number, top, example)
    c.setStrokeColor(LINE)
    c.line(LEFT, top - 2, A4[0] - LEFT, top - 2)
    top -= 12
    heading = (
        product.get("example_heading", "番号の確認先・記入のポイント")
        if example
        else "一緒にご準備いただく資料"
    )
    top -= paragraph(c, heading, LEFT, top, WIDTH, "label") + 3
    for item in product["example_notes"] if example else product["documents"]:
        top -= paragraph(c, "・" + item, LEFT, top, WIDTH, "small") + 1
    note = product.get("example_note" if example else "note")
    if note:
        top -= paragraph(c, note, LEFT, top - 2, WIDTH, "small") + 2
    if product.get("link") and not example:
        text, url = product["link"]
        h = paragraph(c, text, LEFT, top - 3, WIDTH, "small")
        c.linkURL(url, (LEFT, top - 3 - h, LEFT + WIDTH, top - 3), relative=0)
        top -= h + 3
    if top < 42:
        raise ValueError(("資料案内がはみ出す", product["slug"], example, top))
    c.setStrokeColor(LINE)
    c.line(LEFT, 33, A4[0] - LEFT, 33)
    c.setFillColor(MUTED)
    c.setFont("Meiryo", 7.8)
    c.drawString(LEFT, 21, FOOTER)
    c.drawRightString(A4[0] - LEFT, 21, "2 / 2　記入例" if example else "1 / 2　入力用")
    c.showPage()
