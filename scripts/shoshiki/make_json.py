# forms_base.py の FORMS・forms_extra.py の EXTRA・hints.py の記法版文面を data/shoshiki/forms.json に変換する。
#   python3 scripts/shoshiki/make_json.py
# 文面・改行位置を直すときは hints.py（記法版）を直してこれを回し、build_shoshiki.py / build_zip.py で再生成する。記入欄のヒント文字列は次のミニ記法に変換する。
#   [A|B|C]  … 選択肢（□ A  □ B  □ C）。各選択肢は途中で折り返さない
#   {d}      … 「　　年　　月　　日」の日付空欄
#   {bNN}    … 幅NNmmの下線空欄
#   //       … 強制改行
import json
import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent.parent
import forms_base as B  # noqa: E402
from hints import HINTS, TEXT_FIX  # noqa: E402
from forms_extra import EXTRA  # noqa: E402

DATE_RE = re.compile(r"[　 ]*年[　 ]*月[　 ]*日")
SP_RE = re.compile(r"[　]{3,}")


def conv_text(t):
    """素の文字列：日付・空欄を記法に"""
    t = DATE_RE.sub("{d}", t)
    # 「（　　　　円）」のような括弧内の空欄
    t = re.sub(r"（[　]{2,}", "（{b14}", t)
    t = SP_RE.sub(lambda m: "{b%d}" % min(30, max(8, len(m.group(0)) * 3)), t)
    return t


MISSING = []


def conv_hint(h, key=None):
    """HINTS にあればそれを使う。無ければ元の文字列（□や長い空白が残れば警告）"""
    if key in HINTS:
        return HINTS[key]
    if "□" in h or re.search(r"[　]{3,}", h):
        MISSING.append((key, h))
    return h


def _old_conv_hint(h):
    """□ 区切りの選択肢を [A|B] に。選択肢の後ろに続くラベルは切り出す"""
    if "□" not in h:
        return conv_text(h)
    segs = h.split("□")
    out = conv_text(segs[0].rstrip("　 "))
    opts = []
    tail_text = ""

    def flush():
        nonlocal opts, out, tail_text
        if opts:
            out += (
                ("　" if out and not out.endswith(("：", "//")) else "")
                + "["
                + "|".join(opts)
                + "]"
            )
            opts = []
        if tail_text:
            out += "　" + tail_text
            tail_text = ""

    for s in segs[1:]:
        s = s.strip(" ")
        # 選択肢の後に「　　ラベル：」が続くケース
        m = re.search(r"[　]{2,}(?=\S)", s)
        if m and "：" in s[m.end() :]:
            opt, rest = s[: m.start()], s[m.end() :]
            opts.append(conv_text(opt.strip("　")))
            flush()
            out += conv_text(rest.rstrip("　"))
            continue
        opts.append(conv_text(s.strip("　")))
    flush()
    return out


def fix_text(t):
    t = TEXT_FIX.get(t, TEXT_FIX.get(t.strip(), t))
    t = re.sub(r"[　]{2,}", "{b8}", t)  # 「第　　条」のような残りの空白は短い空欄に
    if "□" in t or re.search(r"[　]{3,}", t):
        MISSING.append(("text", t))
    return t


EXTRA_BLOCKS = {  # FORMS に無い会社記入欄（署名欄の後ろに出る）
    "D-30": [
        {
            "type": "fields",
            "rows": [{"label": "会社の決定", "value": HINTS[("D-30", "会社の決定")]}],
            "company": True,
        }
    ],
}

COMPANY_BLOCKS = {  # 会社（承認者）が記入する表。署名欄の後ろに出す
    ("D-11", "承認"),
    ("D-12", "承認"),
    ("D-13", "承認"),
    ("D-14", "承認"),
    ("D-15", "会社の判断"),
    ("D-17", "会社の決定"),
    ("D-07", "承認"),
    ("D-24", "受理日"),
    ("D-50", "承認"),
    ("D-16", "受付日"),
}


def conv_blocks(blocks, no):
    res = []
    for b in blocks:
        k = b[0]
        if k == "p":
            res.append({"type": "p", "text": fix_text(b[1])})
        elif k == "fields":
            blk = {
                "type": "fields",
                "rows": [
                    {"label": lab, "value": conv_hint(v, (no, lab))} for lab, v in b[1]
                ],
            }
            if (no, b[1][0][0]) in COMPANY_BLOCKS:
                blk["company"] = True
            res.append(blk)
        elif k == "checks":
            res.append({"type": "checks", "title": b[1], "items": list(b[2])})
        elif k == "box":
            res.append({"type": "box", "title": b[1], "height": b[2]})
        elif k == "note":
            res.append({"type": "note", "text": fix_text(b[1])})
    return res


def main():
    forms = []
    for f in B.FORMS:
        forms.append(
            {
                "no": f["no"],
                "cat": f["cat"],
                "title": f["title"],
                "to": f["to"],
                "intro": [fix_text(s) for s in f["intro"]],
                "blocks": conv_blocks(f["blocks"], f["no"])
                + EXTRA_BLOCKS.get(f["no"], []),
                "guide": {
                    "use": f["guide"][0],
                    "law": f["guide"][1],
                    "ops": f["guide"][2],
                },
            }
        )
    for f in EXTRA:
        forms.append(
            {
                "no": f["no"],
                "cat": f["cat"],
                "title": f["title"],
                "to": f["to"],
                **({"addr": f["addr"]} if "addr" in f else {}),
                **({"sig": f["sig"]} if "sig" in f else {}),
                "intro": [fix_text(s) for s in f["intro"]],
                "blocks": conv_blocks(f["blocks"], f["no"]),
                "guide": {
                    "use": f["guide"][0],
                    "law": f["guide"][1],
                    "ops": f["guide"][2],
                },
            }
        )
    forms.sort(key=lambda f: f["no"])
    xl = [
        {
            "no": f["no"],
            "cat": f["cat"],
            "title": f["title"],
            "kind": "xlsx",
            "guide": {"use": f["guide"][0], "law": f["guide"][1], "ops": f["guide"][2]},
        }
        for f in B.XLSX_FORMS
    ]
    data = {
        "meta": {
            "issuer": "みなの社会保険労務士事務所",
            "as_of": B.DATE,
            "company_placeholder": B.CO,
            "note": "会社の実情に合わせて修正して使用してください",
        },
        "forms": forms + xl,
    }
    (REPO / "data" / "shoshiki" / "forms.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    print("forms:", len(forms), "+ xlsx", len(xl))
    for k, h in MISSING:
        print("未変換:", k, "⇒", h[:60])


if __name__ == "__main__":
    main()
