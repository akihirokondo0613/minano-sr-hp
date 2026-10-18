"""書式一覧・トップに載せるPDFプレビュー（840×1189 の WebP）を実ファイルから作る。

準備ガイドは1ページ目、その他は2ページ目（赤字の架空記入例）。
本番は同じURLを7日キャッシュするので、絵が変わったら PREVIEWS のファイル名の版（-v2 等）を上げてから作り、
HTML（scripts/shoshiki/build_shoshiki.py・index.html・検査）の参照を新しい名前へ書き換える。
使い方: python3 scripts/onboarding_kit/previews.py [slug ...]   （省略時は全9点）
"""

import sys

import pypdfium2 as pdfium
from PIL import Image

from build import DOWNLOAD, REPO, TARGETS

OUT = REPO / "assets" / "previews"
SIZE = (840, 1189)

# slug → (描くページ番号, 書き出すファイル名)
PREVIEWS = {
    "guide": (1, "onboarding-guide-preview-v2.webp"),
    "personal": (2, "onboarding-personal-sample-v3.webp"),
    "bank": (2, "onboarding-bank-sample.webp"),
    "commute": (2, "onboarding-commute-sample.webp"),
    "emergency": (2, "onboarding-emergency-sample-v3.webp"),
    "business": (2, "procedure-establishment-sample-v2.webp"),
    "onboarding": (2, "procedure-onboarding-sample-v3.webp"),
    "retirement": (2, "procedure-retirement-sample-v2.webp"),
    "leave": (2, "procedure-leave-sample-v2.webp"),
}


def render(slug):
    page_no, name = PREVIEWS[slug]
    doc = pdfium.PdfDocument(str(DOWNLOAD / TARGETS[slug]))
    page = doc[page_no - 1]
    scale = SIZE[0] / page.get_width() * 2
    image = page.render(scale=scale, may_draw_forms=True).to_pil().convert("RGB")
    image = image.resize(SIZE, Image.LANCZOS)
    path = OUT / name
    image.save(path, "WEBP", quality=82, method=6)
    return path


if __name__ == "__main__":
    for slug in sys.argv[1:] or PREVIEWS:
        p = render(slug)
        print(p.relative_to(REPO), p.stat().st_size)
