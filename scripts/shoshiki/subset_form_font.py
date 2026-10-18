"""AcroForm /DR の入力欄用フォント（全字埋め込みのメイリオ）を、CP932 で表せる文字だけ残してサブセット化する。
グリフ番号は保つ（retain_gids）ので、CIDToGIDMap・/W・既存の外観ストリームはそのまま使える。
使い方: python3 scripts/shoshiki/subset_form_font.py 入力.pdf 出力.pdf（配布PDFを作り直したときに使う。CIでは実行しない）
"""

import io
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, NumberObject, DecodedStreamObject


def cp932_chars():
    chars = set()
    for cp in range(0x20, 0x10000):
        ch = chr(cp)
        try:
            ch.encode("cp932")
            chars.add(cp)
        except UnicodeEncodeError:
            pass
    # 入力で使う全角・半角の記号の取りこぼし対策（CP932 外の一般的な記号）
    chars.update(range(0x2010, 0x2070))
    chars.update(
        [0x00A0, 0x00A9, 0x00AE, 0x2116, 0x2121, 0x301C, 0xFF5E, 0x2212, 0xFF0D]
    )
    return chars


def main(src, dst):
    reader = PdfReader(src)
    writer = PdfWriter(clone_from=reader)
    dr = writer._root_object["/AcroForm"]["/DR"]["/Font"]
    done = 0
    for name in list(dr.keys()):
        font = dr[name].get_object()
        if font.get("/Subtype") != "/Type0":
            continue
        desc = font["/DescendantFonts"][0].get_object()["/FontDescriptor"].get_object()
        ff = desc.get("/FontFile2")
        if ff is None:
            continue
        stream = ff.get_object()
        data = stream.get_data()
        tt = TTFont(io.BytesIO(data))
        opts = subset.Options()
        opts.retain_gids = True
        opts.notdef_outline = True
        opts.hinting = False
        opts.layout_features = ["*"]
        opts.name_IDs = ["*"]
        opts.drop_tables += ["DSIG"]
        sub = subset.Subsetter(opts)
        sub.populate(unicodes=cp932_chars())
        sub.subset(tt)
        out = io.BytesIO()
        tt.save(out)
        new = out.getvalue()
        ns = DecodedStreamObject()
        ns.set_data(new)
        ns[NameObject("/Length1")] = NumberObject(len(new))
        ref = writer._add_object(ns.flate_encode(level=9))
        desc[NameObject("/FontFile2")] = ref
        done += 1
        print(f"{name}: {len(data):,} -> {len(new):,} bytes")
    writer.compress_identical_objects(remove_duplicates=True, remove_unreferenced=True)
    with open(dst, "wb") as f:
        writer.write(f)
    print("fonts", done)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
