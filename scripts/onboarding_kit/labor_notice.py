"""労働条件通知書Excel（assets/download/onboarding-kit/labor-notice.xlsx）の修正をXML直接編集で当てる。

この Excel の元は Codex 期間に @oai/artifact-tool（Codex 専用の実行環境）で作られ、
リポジトリでは再生成できない。そのため公開版の xlsx 自体を正本とし、ここでは差分だけを当てる。
openpyxl で開いて保存すると入力規則・書式の一部が落ちるので使わない。どの修正も二度当てても同じ結果になる。

当てる修正:
  1. 見出しに選択行を明記（PR #431）: 「…時間外労働（勤務制度は114行で選択）」「賃金（基本賃金の形態は115行で選択）」
  2. 入力セルの塗り FFFBEA → FFF2CC（PR #431）
  3. 様式2シート（一般労働者用・短時間労働者用）をパスワードなしで保護。両シートだけが使う書式をロックする
     （入力シートは保護しない。入力セルのロック解除はそのまま）
  4. 入力シートに印刷範囲 A1:J117 と「横1ページ・縦は自動」の拡大縮小、A4縦
使い方: python3 scripts/onboarding_kit/labor_notice.py [入力.xlsx] [出力.xlsx]
  省略時は公開版を読み、同じ場所へ書き戻す。
"""

import re
import sys
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DEFAULT = REPO / "assets/download/onboarding-kit/labor-notice.xlsx"

HEADINGS = {
    "<t>始業・終業・休憩・時間外労働</t>": "<t>始業・終業・休憩・時間外労働（勤務制度は114行で選択）</t>",
    "<t>賃金</t>": "<t>賃金（基本賃金の形態は115行で選択）</t>",
}
INPUT_FILL_OLD, INPUT_FILL_NEW = 'rgb="FFFFFBEA"', 'rgb="FFFFF2CC"'
INPUT_SHEET = "xl/worksheets/sheet1.xml"
FORM_SHEETS = ("xl/worksheets/sheet2.xml", "xl/worksheets/sheet3.xml")
INPUT_PRINT_AREA = "入力!$A$1:$J$117"
PROTECTION = '<sheetProtection sheet="1" objects="1" scenarios="1"/>'


def used_styles(sheet_xml):
    return {int(s) for s in re.findall(r'<c r="[A-Z]+\d+" s="(\d+)"', sheet_xml)}


def lock_styles(styles_xml, indices):
    """cellXfs のうち indices の書式を locked にする（<protection locked="0"/> を外す）。"""
    m = re.search(r"(<cellXfs[^>]*>)(.*?)(</cellXfs>)", styles_xml, re.S)
    xfs = re.findall(r"<xf [^>]*?/>|<xf [^>]*?>.*?</xf>", m.group(2), re.S)
    assert "".join(xfs) == m.group(2), "cellXfs の構造が想定外"
    out = []
    for i, xf in enumerate(xfs):
        if i in indices:
            xf = xf.replace('<protection locked="0"/>', "")
            xf = re.sub(r"<alignment([^>]*)></alignment>", r"<alignment\1/>", xf)
            xf = re.sub(r"<xf ([^>]*?)>\s*</xf>", r"<xf \1/>", xf)
        out.append(xf)
    return styles_xml[: m.start(2)] + "".join(out) + styles_xml[m.end(2) :]


def protect_sheet(sheet_xml):
    if "<sheetProtection" in sheet_xml:
        return sheet_xml
    return sheet_xml.replace("</sheetData>", "</sheetData>" + PROTECTION, 1)


def setup_input_print(sheet_xml):
    if "<pageSetUpPr" not in sheet_xml:
        assert "<sheetPr" not in sheet_xml, "入力シートの sheetPr が想定外"
        sheet_xml = sheet_xml.replace(
            "<dimension ",
            '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ',
            1,
        )
    if "<pageSetup " not in sheet_xml:
        sheet_xml = re.sub(
            r"(<pageMargins [^>]*/>)",
            r'\1<pageSetup paperSize="9" fitToWidth="1" fitToHeight="0" orientation="portrait"/>',
            sheet_xml,
            count=1,
        )
        assert "<pageSetup " in sheet_xml
    return sheet_xml


def set_print_area(workbook_xml):
    if 'localSheetId="0"' in workbook_xml:
        return workbook_xml
    name = f'<definedName name="_xlnm.Print_Area" localSheetId="0">{INPUT_PRINT_AREA}</definedName>'
    return workbook_xml.replace("<definedNames>", "<definedNames>" + name, 1)


def patch(src, dst):
    with zipfile.ZipFile(src) as z:
        items = [(info, z.read(info.filename)) for info in z.infolist()]
    files = {
        info.filename: data.decode("utf-8")
        for info, data in items
        if info.filename.endswith((".xml", ".rels"))
    }

    s = files["xl/sharedStrings.xml"]
    for old, new in HEADINGS.items():
        if new not in s:
            assert s.count(old) == 1, old
            s = s.replace(old, new)
    files["xl/sharedStrings.xml"] = s

    st = files["xl/styles.xml"].replace(INPUT_FILL_OLD, INPUT_FILL_NEW)
    form_styles = set().union(*(used_styles(files[n]) for n in FORM_SHEETS))
    shared = form_styles & used_styles(files[INPUT_SHEET])
    assert not shared, (
        f"入力シートと様式シートで共有する書式があります: {sorted(shared)}"
    )
    files["xl/styles.xml"] = lock_styles(st, form_styles)

    for n in FORM_SHEETS:
        files[n] = protect_sheet(files[n])
    files[INPUT_SHEET] = setup_input_print(files[INPUT_SHEET])
    files["xl/workbook.xml"] = set_print_area(files["xl/workbook.xml"])

    tmp = Path(str(dst) + ".tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for info, data in items:
            body = (
                files[info.filename].encode("utf-8") if info.filename in files else data
            )
            z.writestr(info, body, compress_type=zipfile.ZIP_DEFLATED)
    tmp.replace(dst)
    print("書き出し:", dst)


if __name__ == "__main__":
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT
    dst = Path(sys.argv[2]) if len(sys.argv) > 2 else src
    patch(src, dst)
