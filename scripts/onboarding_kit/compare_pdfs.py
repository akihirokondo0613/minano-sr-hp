"""2つの出力フォルダ（assets/download と同じ構成）のPDFを比べる。

比べるもの: 全ページの描画（pypdfium2・入力欄を含めて2倍で描画した濃淡の差）、抽出テキスト、
入力欄（名前・ページ・/DA・/MaxLen・/Rect・/TU・/Ff）、メタデータ（作成日時を除く）。
使い方: python3 scripts/onboarding_kit/compare_pdfs.py 基準dir 比較dir [slug ...]
  例: python3 scripts/onboarding_kit/compare_pdfs.py assets/download /tmp/kit
"""

import difflib
import json
import sys
from pathlib import Path

import numpy as np
import pypdfium2 as pdfium
from pypdf import PdfReader

from build import TARGETS


def fields(path):
    out = {}
    for pi, p in enumerate(PdfReader(path).pages):
        for a in p.get("/Annots", []) or []:
            a = a.get_object()
            if a.get("/Subtype") != "/Widget":
                continue
            par = a if "/T" in a else a["/Parent"].get_object()
            out[str(par.get("/T"))] = dict(
                page=pi + 1,
                DA=str(a.get("/DA", par.get("/DA"))),
                MaxLen=par.get("/MaxLen"),
                Rect=[round(float(x), 2) for x in a["/Rect"]],
                TU=str(par.get("/TU")),
                Ff=par.get("/Ff"),
            )
    return out


def render(path, scale=2):
    doc = pdfium.PdfDocument(str(path))
    return [
        np.asarray(
            doc[i].render(scale=scale, may_draw_forms=True).to_pil().convert("L"),
            dtype=np.int16,
        )
        for i in range(len(doc))
    ]


def compare(a, b):
    rep = {}
    ia, ib = render(a), render(b)
    rep["pages"] = [len(ia), len(ib)]
    rep["image"] = []
    for k, (x, y) in enumerate(zip(ia, ib), 1):
        if x.shape != y.shape:
            rep["image"].append({"page": k, "shape": [x.shape, y.shape]})
            continue
        d = np.abs(x - y)
        rep["image"].append(
            {
                "page": k,
                "px_diff_gt32": int((d > 32).sum()),
                "px_diff": int((d > 0).sum()),
            }
        )
    ta = [p.extract_text() for p in PdfReader(a).pages]
    tb = [p.extract_text() for p in PdfReader(b).pages]
    rep["text"] = []
    for k, (x, y) in enumerate(zip(ta, tb), 1):
        diff = difflib.unified_diff(x.splitlines(), y.splitlines(), lineterm="", n=0)
        lines = [s for s in diff if not s.startswith(("---", "+++", "@@"))]
        if lines:
            # 行の並びだけが違う（描画位置は同じ）場合は区別する
            order_only = sorted(x.splitlines()) == sorted(y.splitlines())
            rep["text"].append({"page": k, "order_only": order_only, "diff": lines})
    fa, fb = fields(a), fields(b)
    rep["fields"] = [
        {"name": n, "a": fa.get(n), "b": fb.get(n)}
        for n in sorted(set(fa) | set(fb))
        if fa.get(n) != fb.get(n)
    ]
    ma, mb = dict(PdfReader(a).metadata or {}), dict(PdfReader(b).metadata or {})
    rep["meta"] = {
        k: [ma.get(k), mb.get(k)]
        for k in sorted(set(ma) | set(mb))
        if ma.get(k) != mb.get(k) and k not in ("/CreationDate", "/ModDate")
    }
    tabs = lambda p: [str(pg.get("/Tabs")) for pg in PdfReader(p).pages]  # noqa: E731
    if tabs(a) != tabs(b):
        rep["tabs"] = [tabs(a), tabs(b)]
    rep["same"] = (
        all(i.get("px_diff") == 0 for i in rep["image"])
        and all(t["order_only"] for t in rep["text"])
        and not rep["fields"]
        and not rep["meta"]
        and "tabs" not in rep
    )
    return rep


def main():
    base, other = Path(sys.argv[1]), Path(sys.argv[2])
    for slug in sys.argv[3:] or TARGETS:
        rep = compare(base / TARGETS[slug], other / TARGETS[slug])
        print(json.dumps({"slug": slug, **rep}, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
