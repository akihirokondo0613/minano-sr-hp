"""作り直したPDF9本を公開前に点検する。

点検: 2ページ、入力欄は1ページ目だけ・値は空、各ページ /Tabs /R、メタデータ（作成者・用途・題名）、
      2ページ目に「架空」の明示、非公開の氏名が本文・メタデータ・入力欄の説明に無いこと。
--pdfkit を付けると、長い住所・氏名などを PDFKit（Macのプレビューと同じ部品）で全欄に入れて保存→開き直し、
値が残るかを確かめ、1ページ目の見え方を PNG に書き出す（--png-dir）。
使い方:
  MINANO_PRIVATE_NAMES="氏名,ローマ字" python3 scripts/onboarding_kit/verify_pdfs.py 出力dir [--pdfkit --png-dir DIR]
  非公開の氏名はリポジトリに書かない（環境変数で渡す）。
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import zlib
from pathlib import Path

from pypdf import PdfReader

from build import TARGETS
from layout import OFFICE

HERE = Path(__file__).resolve().parent

# 欄名の語尾で決める長い記入値（収まりの確認用。すべて架空）
LONG = [
    ("kana", "ハセガワ　ユキコ　グエン　ティ　タン"),
    ("contact_name", "長谷川　由紀子　グエン　ティ　タン"),
    ("consent_name", "長谷川　由紀子　グエン　ティ　タン"),
    ("name", "長谷川　由紀子　グエン　ティ　タン"),
    ("contact", "総務部人事課　長谷川　由紀子"),
    ("company", "株式会社サンプルホールディングス富山支店"),
    ("building", "サンプルハイツ第二ステーションフロント南棟（管理棟側）"),
    ("street", "○○町大字△△字□□一丁目２３番地４５の６７"),
    ("city", "富山市大字サンプル"),
    (
        "remarks",
        "現住所は住民票と異なります（○○市△△町１－２）。前職の雇用保険被保険者証は紛失のため番号不明。旧姓は山田。外国籍のため在留カードを別途提出します。",
    ),
    (
        "reason_detail",
        "本人から転職のため退職の申出があり、9月末に退職届を受理。契約満了ではなく更新の予定もありました。引継ぎのため最終出勤日を調整しています。",
    ),
    ("notes", "平日日中は職場、夜間は携帯電話へ。土日は別の番号へ連絡してください。"),
    (
        "route",
        "自宅→徒歩10分→サンプル駅→あいの風とやま鉄道→富山駅→市内電車→サンプル停留所→徒歩5分→勤務先",
    ),
    (
        "method",
        "会社の指定する方法（共有フォルダへ保存しメールで連絡）。不明点は総務部人事課（076-000-0000）",
    ),
    ("approved", "経路は申請どおり承認。1か月定期券12,000円を毎月支給。"),
    ("phone", "090-0000-0000"),
    ("tel", "076-000-0000"),
    ("email", "hasegawa.yukiko.sample@example.com"),
    ("postal", "000-0000"),
    ("prefecture", "神奈川県"),
]


def long_value(name, maxlen):
    for key, value in LONG:
        if name.endswith(key):
            break
    else:
        value = "サンプル記入"
    return value[: int(maxlen)] if maxlen else value


def check(path, private):
    r = PdfReader(path)
    errs = []
    if len(r.pages) != 2:
        errs.append(f"ページ数 {len(r.pages)}")
    widgets = []
    for i, p in enumerate(r.pages):
        if str(p.get("/Tabs")) != "/R":
            errs.append(f"{i + 1}ページ目の /Tabs が {p.get('/Tabs')}")
        for a in p.get("/Annots", []) or []:
            a = a.get_object()
            if a.get("/Subtype") == "/Widget":
                widgets.append((i, a))
    if not widgets or any(i != 0 for i, _ in widgets):
        errs.append("入力欄が1ページ目以外にある、または無い")
    if any(str(a.get("/V", "")) for _, a in widgets):
        errs.append("入力欄に値が残っている")
    meta = r.metadata or {}
    if meta.get("/Creator") != OFFICE or meta.get("/Author") != OFFICE:
        errs.append(f"作成者 {meta.get('/Author')} / {meta.get('/Creator')}")
    if not meta.get("/Subject") or meta.get("/Subject") == "unspecified":
        errs.append("Subject が未設定")
    texts = [p.extract_text() or "" for p in r.pages]
    if "架空" not in texts[1] and "guide" not in path.name:
        errs.append("2ページ目に「架空」の明示が無い")
    # 非公開の氏名：本文・メタデータ・入力欄の説明（/TU）・ファイルの生バイト（圧縮を展開）
    blob = "\n".join(texts) + json.dumps(
        {k: str(v) for k, v in meta.items()}, ensure_ascii=False
    )
    blob += "\n".join(str(a.get("/TU", "")) for _, a in widgets)
    data = path.read_bytes()
    for name in private:
        if (
            name in blob
            or name.encode("utf-8") in data
            or name.encode("utf-16-be") in data
        ):
            errs.append(f"非公開の氏名を検出: {name[:1]}…")
    for stream in _streams(data):
        for name in private:
            if name.encode("utf-8") in stream or name.encode("utf-16-be") in stream:
                errs.append(f"非公開の氏名を検出（圧縮内）: {name[:1]}…")
    # reportlab の入力欄は欄と外観（ウィジェット）が同じオブジェクト
    values = {
        str(a["/T"]): long_value(str(a["/T"]), a.get("/MaxLen")) for _, a in widgets
    }
    return errs, values, meta


def _streams(data):
    i = 0
    while True:
        s = data.find(b"stream", i)
        if s < 0:
            return
        s += 6
        if data[s : s + 2] == b"\r\n":
            s += 2
        elif data[s : s + 1] in (b"\n", b"\r"):
            s += 1
        e = data.find(b"endstream", s)
        if e < 0:
            return
        try:
            yield zlib.decompress(data[s:e])
        except zlib.error:
            pass
        i = e + 9


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dir")
    ap.add_argument("--pdfkit", action="store_true")
    ap.add_argument("--png-dir")
    args = ap.parse_args()
    private = [
        s for s in os.environ.get("MINANO_PRIVATE_NAMES", "").split(",") if s.strip()
    ]
    if not private:
        print(
            "注意: MINANO_PRIVATE_NAMES が空なので、非公開氏名の検査は行いません",
            file=sys.stderr,
        )
    base = Path(args.dir)
    failed = False
    for slug, rel in TARGETS.items():
        path = base / rel
        errs, values, meta = check(path, private)
        line = f"{slug:11s} {'OK' if not errs else 'NG: ' + ' / '.join(errs)}  題名={meta.get('/Title')}"
        if args.pdfkit:
            with tempfile.TemporaryDirectory() as tmp:
                vj = Path(tmp) / "values.json"
                vj.write_text(json.dumps(values, ensure_ascii=False), encoding="utf-8")
                png = Path(args.png_dir or tmp) / f"{slug}-pdfkit.png"
                png.parent.mkdir(parents=True, exist_ok=True)
                res = subprocess.run(
                    [
                        "swift",
                        str(HERE / "pdfkit_roundtrip.swift"),
                        str(path),
                        str(vj),
                        str(Path(tmp) / "saved.pdf"),
                        str(png),
                    ],
                    capture_output=True,
                    text=True,
                )
                line += (
                    "  PDFKit: "
                    + (res.stdout.strip().splitlines() or [res.stderr.strip()])[-1]
                )
                if res.returncode != 0:
                    errs.append("PDFKit")
        failed |= bool(errs)
        print(line)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
