"""入社書類セット（準備ガイド・従業員用PDF4点）と手続き連絡票PDF4点、計9本を作り直す。

原稿:
  procedure_forms.json  入社・退職・休職連絡票、事業所基本情報シート
  kit_forms.json        本人情報シート・給与口座振込同意書・通勤経路届・緊急連絡先届
  guide.json            入社書類の準備ガイド（2ページの案内）
処理: ReportLab で描画 → 入力欄へ埋め込みメイリオを割当（form_font.py）
      → CP932 範囲へサブセット化（scripts/shoshiki/subset_form_font.py）→ /Tabs /R とメタデータ
使い方:
  python3 scripts/onboarding_kit/build.py --out /tmp/kit        # 作業用フォルダへ出力（既定）
  python3 scripts/onboarding_kit/build.py --install             # assets/download/ を上書き
  python3 scripts/onboarding_kit/build.py --only personal guide # 一部だけ
フォントは Microsoft Word 同梱のメイリオ（--font-dir または環境変数 MINANO_FONT_DIR）。
CI・preflight では実行しない（フォントがライセンス上 CI に無いため）。
"""

import argparse
import json
import logging
import os
import sys
import tempfile
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(REPO / "scripts" / "shoshiki"))

import form_font  # noqa: E402
import layout as L  # noqa: E402
import subset_form_font  # noqa: E402

logging.getLogger("fontTools").setLevel(logging.ERROR)

DEFAULT_FONT_DIR = "/Applications/Microsoft Word.app/Contents/Resources/DFonts"
DOWNLOAD = REPO / "assets" / "download"

# slug → assets/download/ からの公開パス
TARGETS = {
    "guide": "onboarding-kit/guide.pdf",
    "personal": "onboarding-kit/personal.pdf",
    "bank": "onboarding-kit/bank.pdf",
    "commute": "onboarding-kit/commute.pdf",
    "emergency": "onboarding-kit/emergency.pdf",
    "business": "procedure-establishment.pdf",
    "onboarding": "procedure-onboarding.pdf",
    "retirement": "procedure-retirement.pdf",
    "leave": "procedure-leave.pdf",
}


def load(name):
    return json.loads((HERE / name).read_text(encoding="utf-8"))


def new_canvas(raw, meta):
    c = canvas.Canvas(str(raw), pagesize=A4)
    c.setTitle(meta["title"])
    c.setAuthor(L.OFFICE)
    if meta.get("creator"):
        c.setCreator(meta["creator"])
    if meta.get("subject"):
        c.setSubject(meta["subject"])
    return c


def form_meta(product):
    return {
        "title": product.get("meta_title", product["title"] + "（入力用・記入例）"),
        "subject": product.get("subject"),
        "creator": product.get("creator"),
    }


def draw_form(product, raw):
    c = new_canvas(raw, form_meta(product))
    spare = [L.page(c, product, False), L.page(c, product, True)]
    c.save()
    return spare


def _guide_header(c, title, page, label):
    c.setFillColor(L.GREEN)
    c.rect(L.LEFT, A4[1] - 36, 31, 3, fill=1, stroke=0)
    c.setFont("Meiryo", 9)
    c.drawString(L.LEFT + 43, A4[1] - 36, L.OFFICE)
    c.setFillColor(L.INK)
    c.setFont("MeiryoBold", 22)
    c.drawString(L.LEFT, A4[1] - 69, title)
    c.setFont("Meiryo", 7.8)
    c.setFillColor(L.MUTED)
    c.drawString(L.LEFT, 21, L.FOOTER)
    c.drawRightString(A4[0] - L.LEFT, 21, f"{page} / 2　{label}")
    return A4[1] - 89


def _link(c, text, url, top):
    h = L.paragraph(c, text, L.LEFT, top, L.WIDTH, "small")
    c.linkURL(url, (L.LEFT, top - h, L.LEFT + L.WIDTH, top), relative=0)
    return top - h - 4


def draw_guide(guide, raw):
    c = new_canvas(
        raw,
        {
            "title": guide["meta_title"],
            **{k: guide.get(k) for k in ("subject", "creator")},
        },
    )
    p1, p2 = guide["page1"], guide["page2"]
    top = _guide_header(c, p1["heading"], 1, guide["footer_label"])
    top -= L.paragraph(c, p1["intro"], L.LEFT, top, L.WIDTH, "body") + 10
    for row in p1["company_rows"]:
        top -= L.draw_row(c, row, L.LEFT, top, L.WIDTH, guide["slug"], False)
    top -= 12
    for title, text in p1["steps"]:
        top -= L.paragraph(c, title, L.LEFT, top, L.WIDTH, "group") + 3
        top -= L.paragraph(c, text, L.LEFT, top, L.WIDTH, "body") + 12
    top -= L.paragraph(c, p1["note"], L.LEFT, top, L.WIDTH, "small") + 9
    for text, url in p1["links"]:
        top = _link(c, text, url, top)
    if top <= 42:
        raise ValueError(("準備ガイド1ページ目がはみ出す", top))
    spare = [top - 42]
    c.showPage()
    top = _guide_header(c, p2["heading"], 2, guide["footer_label"])
    top -= L.paragraph(c, p2["intro"], L.LEFT, top, L.WIDTH, "body") + 12
    for when, doc, description in p2["rows"]:
        c.setFillColor(L.PALE)
        c.rect(L.LEFT, top - 19, L.WIDTH, 19, fill=1, stroke=0)
        L.paragraph(c, when + "｜" + doc, L.LEFT + 6, top - 3, L.WIDTH - 12, "label")
        top -= 24
        top -= L.paragraph(c, description, L.LEFT + 6, top, L.WIDTH - 12, "small") + 9
    for text, url in p2["links"]:
        top = _link(c, text, url, top)
    if top <= 42:
        raise ValueError(("準備ガイド2ページ目がはみ出す", top))
    spare.append(top - 42)
    c.showPage()
    c.save()
    return spare


def finish(raw, work, target, tabs):
    """入力欄フォント割当 → サブセット化 → /Tabs。target へ書き出し、検査値を返す。"""
    fonted = work / (raw.stem + "_font.pdf")
    form_font.configure_japanese_form_fonts(raw, fonted, font_size=9)
    subset = work / (raw.stem + "_subset.pdf")
    with redirect_stdout(StringIO()):
        subset_form_font.main(str(fonted), str(subset))
    if tabs:
        writer = PdfWriter(clone_from=subset)
        for page in writer.pages:
            page[NameObject("/Tabs")] = NameObject("/R")
        target.parent.mkdir(parents=True, exist_ok=True)
        with open(target, "wb") as f:
            writer.write(f)
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(subset.read_bytes())
    r = PdfReader(target)
    fields = r.get_fields() or {}
    assert len(r.pages) == 2, (target, len(r.pages))
    assert fields and all(str(f.get("/V", "")) == "" for f in fields.values()), target
    return {
        "file": str(target),
        "pages": len(r.pages),
        "fields": len(fields),
        "bytes": target.stat().st_size,
    }


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--out", help="出力先（assets/download と同じ構成で書き出す）")
    ap.add_argument(
        "--install", action="store_true", help="assets/download/ へ直接書き出す"
    )
    ap.add_argument(
        "--font-dir", default=os.environ.get("MINANO_FONT_DIR", DEFAULT_FONT_DIR)
    )
    ap.add_argument(
        "--only", nargs="*", choices=sorted(TARGETS), help="作る書式の slug"
    )
    ap.add_argument(
        "--no-tabs",
        action="store_true",
        help="/Tabs /R を付けない（2026-10-05公開版の再現確認用）",
    )
    args = ap.parse_args()
    if args.install and args.out:
        ap.error("--out と --install は同時に使えません")
    out = (
        DOWNLOAD
        if args.install
        else Path(args.out or tempfile.mkdtemp(prefix="onboarding-kit-"))
    )
    L.setup_fonts(args.font_dir)

    products = {
        p["slug"]: p for p in load("procedure_forms.json") + load("kit_forms.json")
    }
    guide = load("guide.json")
    reports = []
    with tempfile.TemporaryDirectory(prefix="onboarding-kit-work-", dir=None) as tmp:
        work = Path(tmp)
        for slug in args.only or TARGETS:
            raw = work / (slug + "_raw.pdf")
            if slug == "guide":
                spare = draw_guide(guide, raw)
            else:
                spare = draw_form(products[slug], raw)
            report = finish(raw, work, out / TARGETS[slug], not args.no_tabs)
            report["spare_pt"] = [round(x, 1) for x in spare]  # 各ページ下端の余白
            reports.append(report)
    print(json.dumps(reports, ensure_ascii=False, indent=1))
    print("出力先:", out)


if __name__ == "__main__":
    main()
