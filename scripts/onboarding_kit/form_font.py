"""AcroForm の日本語入力欄に、埋め込みメイリオ（/DR /CJK）を割り当てる。

Codex期間の tmp/pdfs/form_font_probe/japanese_form_font.py を取り込んだもの。
変更点は pypdf 6 系の _get_qualified_field_name(parent=...) への追随だけで、出力は旧版と同じ。
埋め込みは全字のため、build.py の後段で scripts/shoshiki/subset_form_font.py により CP932 範囲へ縮める。
"""

import re
from functools import lru_cache
from pathlib import Path
from struct import pack

from pypdf import PdfReader, PdfWriter
from pypdf.generic import (
    ArrayObject,
    DecodedStreamObject,
    DictionaryObject,
    FloatObject,
    NameObject,
    NumberObject,
    TextStringObject,
)
from reportlab.pdfbase.ttfonts import TTFontFile, TTFontMaker

# 入力欄用フォント。build.py が --font-dir（既定は Microsoft Word 同梱のメイリオ）から設定する。
FONT = "/Applications/Microsoft Word.app/Contents/Resources/DFonts/meiryo.ttc"


def embedded_meiryo(writer):
    """全文字を保持するメイリオをType0字体として埋め込む実験。"""
    face = TTFontFile(FONT, subfontIndex=0)
    maker = TTFontMaker()
    for record in face.tables:
        maker.add(record["tag"], face.get_table(record["tag"]))
    font_bytes = maker.makeStream()
    font_stream = DecodedStreamObject()
    font_stream.set_data(font_bytes)
    font_stream[NameObject("/Length1")] = NumberObject(len(font_bytes))
    font_ref = writer._add_object(font_stream.flate_encode())
    descriptor = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/FontDescriptor"),
            NameObject("/FontName"): NameObject("/Meiryo"),
            NameObject("/Flags"): NumberObject(32),
            NameObject("/FontBBox"): ArrayObject([FloatObject(x) for x in face.bbox]),
            NameObject("/ItalicAngle"): FloatObject(face.italicAngle),
            NameObject("/Ascent"): FloatObject(face.ascent),
            NameObject("/Descent"): FloatObject(face.descent),
            NameObject("/CapHeight"): FloatObject(face.capHeight),
            NameObject("/StemV"): FloatObject(face.stemV),
            NameObject("/FontFile2"): font_ref,
        }
    )
    cid_map = DecodedStreamObject()
    cid_map.set_data(
        b"".join(pack(">H", face.charToGlyph.get(i, 0)) for i in range(65536))
    )
    widths = ArrayObject()
    for code, width in sorted(face.charWidths.items()):
        if 0 <= code <= 65535:
            widths.extend([NumberObject(code), ArrayObject([FloatObject(width)])])
    cid_font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/CIDFontType2"),
            NameObject("/BaseFont"): NameObject("/Meiryo"),
            NameObject("/CIDSystemInfo"): DictionaryObject(
                {
                    NameObject("/Registry"): TextStringObject("Adobe"),
                    NameObject("/Ordering"): TextStringObject("Identity"),
                    NameObject("/Supplement"): NumberObject(0),
                }
            ),
            NameObject("/FontDescriptor"): writer._add_object(descriptor),
            NameObject("/CIDToGIDMap"): writer._add_object(cid_map.flate_encode()),
            NameObject("/DW"): NumberObject(1000),
            NameObject("/W"): widths,
        }
    )
    cmap = DecodedStreamObject()
    cmap.set_data(
        b"/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n"
        b"/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n"
        b"/CMapName /Meiryo-UCS def\n/CMapType 2 def\n"
        b"1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n"
        b"1 beginbfrange\n<0000> <FFFF> <0000>\nendbfrange\n"
        b"endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n"
    )
    type0 = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type0"),
            NameObject("/BaseFont"): NameObject("/Meiryo"),
            NameObject("/Encoding"): NameObject("/Identity-H"),
            NameObject("/DescendantFonts"): ArrayObject([writer._add_object(cid_font)]),
            NameObject("/ToUnicode"): writer._add_object(cmap.flate_encode()),
        }
    )
    return writer._add_object(type0)


def _walk_fields(fields, prefix=""):
    for reference in fields:
        obj = reference.get_object()
        name = str(obj.get("/T", ""))
        full_name = ".".join(part for part in (prefix, name) if part)
        yield obj, full_name
        if "/Kids" in obj:
            yield from _walk_fields(obj["/Kids"], full_name)


@lru_cache(maxsize=1)
def _meiryo_metrics():
    return TTFontFile(FONT, subfontIndex=0)


def _appearance_lines(text, width, font_size):
    """表示用だけを文字単位で折り返す。保存値にはこの改行を使わない。"""
    face = _meiryo_metrics()
    lines = []
    for paragraph in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line, used = "", 0.0
        for char in paragraph:
            advance = (
                face.charWidths.get(ord(char), face.defaultWidth) * font_size / 1000
            )
            if advance > width:
                return None
            if line and used + advance > width:
                lines.append(line)
                line, used = "", 0.0
            line += char
            used += advance
        lines.append(line)
    return lines


def _multiline_appearance(text, rectangle, requested_size):
    width = abs(float(rectangle[2]) - float(rectangle[0])) - 4
    height = abs(float(rectangle[3]) - float(rectangle[1])) - 2
    face = _meiryo_metrics()
    leading = (face.bbox[3] - face.bbox[1]) / 1000
    maximum = min(requested_size if requested_size > 0 else 10, 10)
    for tenth in range(round(maximum * 10), 39, -1):
        size = tenth / 10
        lines = _appearance_lines(text, width, size)
        if lines is not None and len(lines) * leading * size <= height:
            return "\n".join(lines), size
    raise ValueError("日本語の複数行欄に全文を表示できません。欄の高さを広げてください")


def update_japanese_form_field_values(writer, values, *, auto_regenerate=False):
    """/Vを保ち、日本語複数行欄の外観だけを折り返して生成する。"""
    acro = writer._root_object["/AcroForm"]
    fonts = acro["/DR"]["/Font"]
    restored = []
    for resource in fonts.values():
        resource = resource.get_object()
        if resource.get("/Encoding") == "/Identity-H" and "/ToUnicode" in resource:
            restored.append((resource, resource.pop("/ToUnicode")))
    try:
        for page in writer.pages:
            if "/Annots" in page:
                display_values = dict(values)
                canonical_values = []
                for reference in page["/Annots"]:
                    annotation = reference.get_object()
                    parent = (
                        annotation
                        if "/FT" in annotation and "/T" in annotation
                        else annotation.get("/Parent", DictionaryObject()).get_object()
                    )
                    name = writer._get_qualified_field_name(parent=parent)
                    key = name if name in values else parent.get("/T")
                    if key not in values or parent.get("/FT") != "/Tx":
                        continue
                    if not int(parent.get("/Ff", 0)) & 4096:
                        continue
                    value = values[key]
                    if not isinstance(value, str):
                        continue
                    appearance = str(
                        annotation.get_inherited("/DA", acro.get("/DA", ""))
                    )
                    font_match = re.search(r"/CJK\s+([\d.]+)\s+Tf", appearance)
                    if not font_match:
                        continue
                    displayed, size = _multiline_appearance(
                        value, annotation["/Rect"], float(font_match.group(1))
                    )
                    old_da = annotation.get("/DA")
                    old_value_in_widget = "/V" in annotation
                    canonical_values.append(
                        (parent, annotation, value, old_da, old_value_in_widget)
                    )
                    display_values[key] = displayed
                    annotation[NameObject("/DA")] = TextStringObject(
                        re.sub(r"/CJK\s+[\d.]+\s+Tf", f"/CJK {size} Tf", appearance)
                    )
                try:
                    writer.update_page_form_field_values(
                        page, display_values, auto_regenerate=auto_regenerate
                    )
                finally:
                    for (
                        parent,
                        annotation,
                        value,
                        old_da,
                        widget_value,
                    ) in canonical_values:
                        parent[NameObject("/V")] = TextStringObject(value)
                        if annotation is not parent and widget_value:
                            annotation[NameObject("/V")] = TextStringObject(value)
                        if old_da is None:
                            annotation.pop("/DA", None)
                        else:
                            annotation[NameObject("/DA")] = old_da
    finally:
        for resource, cmap in restored:
            resource[NameObject("/ToUnicode")] = cmap


def configure_japanese_form_fonts(
    input_path, output_path, *, ascii_fields=(), font_size=0
):
    """AcroFormの日本語欄に埋込メイリオを割り当てる。既存/Btnは保つ。"""
    input_path, output_path = Path(input_path), Path(output_path)
    if input_path.resolve() == output_path.resolve():
        raise ValueError("原本と出力先は分けてください")
    writer = PdfWriter(clone_from=input_path)
    acro = writer._root_object["/AcroForm"]
    if "/DR" not in acro:
        acro[NameObject("/DR")] = DictionaryObject()
    if "/Font" not in acro["/DR"]:
        acro["/DR"][NameObject("/Font")] = DictionaryObject()
    font = embedded_meiryo(writer)
    acro["/DR"]["/Font"][NameObject("/CJK")] = font
    acro[NameObject("/DA")] = TextStringObject(f"/CJK {font_size} Tf 0 g")
    values = {}
    for field, name in _walk_fields(acro["/Fields"]):
        if field.get("/FT") == "/Tx":
            if name not in ascii_fields:
                field[NameObject("/DA")] = TextStringObject(f"/CJK {font_size} Tf 0 g")
            values[name] = str(field.get("/V", ""))
    update_japanese_form_field_values(writer, values, auto_regenerate=False)
    writer.write(output_path)
    saved_fields = PdfReader(output_path).get_fields()
    for name, value in values.items():
        if str(saved_fields[name].get("/V", "")) != value:
            raise ValueError(f"保存値の不一致: {name}")
    return {"text_fields": len(values), "font": "Meiryo", "path": str(output_path)}


def verify_japanese_form_save(input_path, output_path, values):
    """日本語のサンプルを/ Vと/ APの両方に保存し、保存後値を照合する。"""
    writer = PdfWriter(clone_from=input_path)
    update_japanese_form_field_values(writer, values, auto_regenerate=False)
    writer.write(output_path)
    reader = PdfReader(output_path)
    fields = reader.get_fields()
    for name, expected in values.items():
        if fields[name]["/V"] != expected:
            raise ValueError(f"保存値の不一致: {name}")
    appearances = []
    for page in reader.pages:
        for reference in page.get("/Annots", []):
            annotation = reference.get_object()
            if annotation.get("/FT") == "/Tx" and "/AP" in annotation:
                appearances.append(annotation["/AP"]["/N"].get_data())
    return {"values_match": True, "appearance_streams": len(appearances)}
