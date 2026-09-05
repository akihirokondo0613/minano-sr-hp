#!/usr/bin/env python3
# 社内書式の配布物を作る（Excel帳簿2本 → shoshiki/、Word一式＋Excel＋README の zip → shoshiki/dl/word-7kq3x9/）。
#   python3 scripts/shoshiki/build_zip.py
# 正本は data/shoshiki/forms.json（文面）と forms_base.py（Excel帳簿）。
# ファイル名は ASCII にする（日本語名の URL は Googleフォームの自動リンクが途中で切れて 404 になった）。
# zip の中のファイル名は日本語のまま（UTF-8 フラグ付きなので Windows/Mac とも正しく展開できる）。
import pathlib
import shutil
import sys
import zipfile

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent.parent
sys.path.insert(0, str(HERE))
import forms_base as B  # noqa: E402
import render_forms as R  # noqa: E402

DATA = R.DATA
AS_OF = DATA["meta"]["as_of"]
VER = AS_OF[:7].replace("-", "")  # 202609
DL_DIR = REPO / "shoshiki" / "dl" / "word-7kq3x9"
ZIP_NAME = f"shanai-shoshiki-word-{VER}.zip"
XLSX_FILES = {  # 番号 → サイトに置く ASCII 名（表示名は forms.json の title）
    "D-31": "D-31_shukkinbo.xlsx",
    "D-32": "D-32_nenkyu-kanribo.xlsx",
}
XLSX_BUILDERS = {"D-31": B.build_shukkinbo, "D-32": B.build_yukyu}
BUILD = HERE / "_build"
FORMS = [f for f in DATA["forms"] if f.get("to") != "社労士"]
FIXED_TIME = (
    2026,
    9,
    6,
    0,
    0,
    0,
)  # zip の中のタイムスタンプは固定（差分を出さないため）


def readme_text():
    lines = [
        f"社内書式 Word一式（{AS_OF}版）",
        "",
        "■ 使い方",
        "1. 必要な書式（.docx）をWordで開きます。",
        "2. 「【会社名】」を自社名に置き換えます（Ctrl+H または ⌘+H で「すべて置換」）。",
        "3. 宛名の代表者名、所在地、担当者を書き入れ、文面を自社の就業規則・実情に合わせて直します。",
        "4. 帳簿（出勤簿・年次有給休暇管理簿）はExcelです。",
        "",
        "■ 利用条件",
        "・自社内での利用は自由です。改変も自由です。",
        "・第三者への再配布・販売はご遠慮ください。",
        "・法令は作成時点の理解に基づく一般的な内容です。就業規則・労使協定と食い違うときは規程が優先します。",
        "  重要な手続（解雇・懲戒・労使協定など）は、実際に使う前に専門家にご確認ください。",
        "",
        "■ ブラウザで記入できる版",
        "会社名を入れると全書式の宛名・発信者欄に自動で入る「社内書式のひな形」ページもあります。",
        "https://minano-sr.com/shoshiki.html",
        "",
        "■ 収録一覧",
    ]
    for f in FORMS:
        lines.append(f"{f['no']}  {f['title']}")
    lines += ["", "作成・提供：みなの社会保険労務士事務所（富山市）"]
    return "\r\n".join(lines)


def main():
    if BUILD.exists():
        shutil.rmtree(BUILD)
    BUILD.mkdir()
    # Excel帳簿 → shoshiki/（サイトから直接ダウンロードする分）
    site_xlsx = {}
    for no, name in XLSX_FILES.items():
        out = REPO / "shoshiki" / name
        XLSX_BUILDERS[no](out)
        site_xlsx[no] = out
    # Word → _build/word/
    docx_paths = {}
    for f in FORMS:
        if f.get("kind") == "xlsx":
            continue
        out = BUILD / "word" / f["cat"] / f"{f['no']}_{f['title']}.docx"
        out.parent.mkdir(parents=True, exist_ok=True)
        R.build_docx(f, out)
        docx_paths[f["no"]] = out
    # zip
    DL_DIR.mkdir(parents=True, exist_ok=True)
    zpath = DL_DIR / ZIP_NAME
    n = 0
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        zi = zipfile.ZipInfo(
            "README（はじめにお読みください）.txt", date_time=FIXED_TIME
        )
        zi.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(
            zi, "﻿" + readme_text()
        )  # BOM 付き UTF-8（Windows のメモ帳でも化けない）
        for f in FORMS:
            if f.get("kind") == "xlsx":
                src = site_xlsx[f["no"]]
                arc = f"{f['cat']}/{f['no']}_{f['title']}.xlsx"
            else:
                src = docx_paths[f["no"]]
                arc = f"{f['cat']}/{src.name}"
            zi = zipfile.ZipInfo(arc, date_time=FIXED_TIME)
            zi.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(zi, src.read_bytes())
            n += 1
    size = zpath.stat().st_size
    print(f"wrote {zpath.relative_to(REPO)} ({n} files + README, {size // 1024} KB)")
    for no, p in site_xlsx.items():
        print(f"wrote {p.relative_to(REPO)}")
    # 中身の点検：文字列に置換文字や制御文字が混ざっていないか
    bad = []
    for no, p in list(site_xlsx.items()):
        import openpyxl

        wb = openpyxl.load_workbook(p)
        for ws in wb.worksheets:
            for row in ws.iter_rows():
                for c in row:
                    if isinstance(c.value, str) and (
                        "�" in c.value or "_x000" in c.value
                    ):
                        bad.append((p.name, c.coordinate, c.value[:30]))
    if bad:
        print("要確認:", bad)
        sys.exit(1)
    shutil.rmtree(BUILD)


if __name__ == "__main__":
    main()
