#!/usr/bin/env python3
"""配布資料（型A・制度資料）の生成。

  データ（JSON） → 資料HTML → A4のPDF（2ページ。多くても4ページまで）

くわしい説明は載せない。数字と手順だけを置き、詳細はQRコードでWebへ送る。
金額・要件・期限は data/ の正本JSONから読む。この生成器の中に数値を書かない。
正本を直して再生成すれば、資料の数字も一緒に直る。

使い方:
    python3 scripts/shiryo/build_shiryo.py chinage-oen-2026            # PDFまで
    python3 scripts/shiryo/build_shiryo.py chinage-oen-2026 --html     # HTMLだけ（確認用）
"""

import base64
import html
import json
import mimetypes
import pathlib
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
OUT_DIR = ROOT / "assets" / "download"


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def esc(s):
    return html.escape(str(s), quote=False)


def data_uri(rel):
    """画像をdata URIに焼き込む（PDFに確実に載せるため）。"""
    if not rel:
        return ""
    p = ROOT / rel
    if not p.exists():
        return ""
    mime = mimetypes.guess_type(p.name)[0] or "image/webp"
    return f"data:{mime};base64," + base64.b64encode(p.read_bytes()).decode()


def qr_svg(url, size_mm=20):
    """QRを画像として埋め込む（SVGのdata URI。拡大しても粗くならない）。"""
    import segno

    q = segno.make(url, error="m")
    uri = q.svg_data_uri(scale=10, border=0, dark="#123F30")
    return (
        f'<div class="qr" style="width:{size_mm}mm;height:{size_mm}mm">'
        f'<img src="{uri}" alt="QRコード" style="width:100%;height:100%;display:block"></div>'
    )


def iter_offices(node):
    """窓口JSONの構造に依存せず、id を持つ辞書を拾う。"""
    if isinstance(node, dict):
        if "id" in node and "name" in node:
            yield node
        for v in node.values():
            yield from iter_offices(v)
    elif isinstance(node, list):
        for v in node:
            yield from iter_offices(v)


# ---------------------------------------------------------------- 体裁（型の仕様）
CSS = """
@page{size:A4;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --sugi:#123F30;--moegi:#2E9E63;--moegi-t:#1E7A4B;--moegi-l:#E8F4EC;
  --iwa:#1A1F1C;--ink2:#3D4642;--ink3:#6B7671;--ink4:#98A09C;
  --yuki:#F9FAF7;--shiro:#fff;--line:#E2E6E4;--kohaku:#B8860B;--kohaku-l:#FBF3E0;
  --g:"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif;
  --m:"SF Mono",Menlo,monospace;
}
body{font-family:var(--g);color:var(--iwa);background:var(--shiro);-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:210mm;height:297mm;padding:11mm 12mm 9mm;page-break-after:always;position:relative;display:flex;flex-direction:column}
.page:last-child{page-break-after:auto}

.ph{display:flex;justify-content:space-between;align-items:center;margin-bottom:5mm}
.ph .brand{display:flex;align-items:center;gap:3mm}
.ph .mark{width:9mm;height:9mm;border-radius:2.4mm;background:var(--sugi);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11pt;font-weight:800}
.ph .bn{font-size:9.5pt;font-weight:800;letter-spacing:.02em}
.ph .bt{font-size:6.8pt;color:var(--ink4);margin-top:.4mm}
.ph .to{font-size:8pt;color:var(--ink3);font-weight:700}

.head{background:var(--sugi);color:#fff;border-radius:3.5mm;padding:8mm 9mm 7mm;position:relative;overflow:hidden}
.head .kick{font-size:8pt;font-weight:700;letter-spacing:.16em;color:#8FC9A9}
.head h1{font-size:20.5pt;font-weight:800;line-height:1.5;margin-top:2.5mm;letter-spacing:.005em;max-width:124mm}
.head h1 em{font-style:normal;color:#8FC9A9}
.head .note{display:inline-block;font-size:8.4pt;margin-top:4mm;color:var(--sugi);background:#8FC9A9;border-radius:1.5mm;padding:1.2mm 3mm;font-weight:700}
.head .illwrap{position:absolute;right:6mm;top:50%;transform:translateY(-50%);width:40mm;background:#fff;border-radius:2.5mm;padding:2.5mm}
.head .illwrap img{width:100%;display:block;border-radius:1.5mm}

.calc{display:grid;grid-template-columns:1fr 6mm 1fr 6mm 1fr;align-items:center;gap:0;margin-top:6mm}
.calc .cap{grid-column:1/-1;font-size:8.2pt;color:var(--ink3);margin-bottom:3mm}
.calc .box{border:1.4px solid var(--line);border-radius:3mm;padding:5mm 3mm;text-align:center}
.calc .box.back{border-color:var(--moegi);background:var(--moegi-l)}
.calc .box.net{border-color:var(--sugi);background:var(--sugi);color:#fff}
.calc .lb{font-size:7.6pt;font-weight:700;color:var(--ink3);line-height:1.5}
.calc .box.back .lb{color:var(--moegi-t)}
.calc .box.net .lb{color:#8FC9A9}
.calc .yn{font-size:16pt;font-weight:800;margin-top:1.5mm;letter-spacing:-.01em}
.calc .box.back .yn{color:var(--moegi-t)}
.calc .op{font-size:14pt;font-weight:800;color:var(--ink4);text-align:center}
.calc .memo{grid-column:1/-1;font-size:7.8pt;color:var(--ink3);margin-top:3mm;line-height:1.7}

.facts{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm}
.fact{border-top:1.4px solid var(--sugi);padding-top:3mm}
.fact .ft{font-size:8pt;font-weight:800;color:var(--moegi-t);letter-spacing:.06em}
.fact .fd{font-size:8.8pt;line-height:1.75;color:var(--ink2);margin-top:1.5mm}

.rates{display:grid;grid-template-columns:1fr 1fr;gap:4mm;margin-top:6mm}
.rate{border:1px solid var(--line);border-radius:3mm;padding:4.5mm 5mm;display:flex;justify-content:space-between;align-items:center}
.rate .who{font-size:9.4pt;font-weight:800}
.rate .r{font-size:8.2pt;color:var(--ink3);margin-top:1mm}
.rate .cap2{font-size:12.5pt;font-weight:800;color:var(--moegi-t);white-space:nowrap}

.st{font-size:10.5pt;font-weight:800;color:var(--sugi);margin:6mm 0 3mm;display:flex;align-items:center;gap:3mm}
.st::after{content:"";flex:1;height:1px;background:var(--line)}

.chips{display:flex;flex-wrap:wrap;gap:2mm}
.chip{font-size:8.4pt;font-weight:700;color:var(--sugi);background:var(--moegi-l);border-radius:1.5mm;padding:1.6mm 3mm}

.steps{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm;counter-reset:s}
.step{counter-increment:s;background:var(--yuki);border-radius:3mm;padding:5mm 4mm}
.step::before{content:counter(s,decimal-leading-zero);font-family:var(--m);font-size:8.4pt;font-weight:700;color:var(--moegi)}
.step .stt{font-size:9.4pt;font-weight:800;margin-top:1.5mm;line-height:1.5}
.step .std{font-size:8pt;color:var(--ink3);margin-top:1.2mm;line-height:1.65}

.traps{display:grid;grid-template-columns:1fr 1fr;gap:4mm}
.trap{background:var(--kohaku-l);border-left:2.4px solid var(--kohaku);border-radius:0 2.5mm 2.5mm 0;padding:4.5mm 5mm}
.trap .tt{font-size:9.2pt;font-weight:800;color:#7A5A08}
.trap .td{font-size:8.4pt;line-height:1.75;color:#5C4406;margin-top:1.5mm}

.stbl{width:100%;border-collapse:collapse;font-size:9pt;margin-top:1mm}
.stbl th,.stbl td{border-bottom:1px solid var(--line);padding:2.4mm 3mm;text-align:left;vertical-align:top;line-height:1.6}
.stbl th{font-weight:700;color:var(--sugi);background:var(--moegi-l);font-size:8.4pt;letter-spacing:.02em}
.stbl td.num{text-align:right;font-family:var(--m);white-space:nowrap}
.stbl caption{caption-side:top;text-align:left;font-size:8pt;color:var(--ink3);padding-bottom:2mm}
.card{border:1px solid var(--line);border-radius:3mm;padding:5mm}
.card .cd{font-size:8.6pt;line-height:1.8;color:var(--ink2)}

.cta{background:var(--sugi);color:#fff;border-radius:3.5mm;padding:7mm 8mm;margin-top:auto;display:grid;grid-template-columns:1fr auto;gap:8mm;align-items:center}
.cta .t{font-size:13pt;font-weight:800}
.cta .d{font-size:8.6pt;line-height:1.8;color:#CFE6D9;margin-top:2mm}
.cta .tel{font-family:var(--m);font-size:15pt;font-weight:700;margin-top:4mm}
.cta .sub{font-size:8pt;color:#A8CDBB;margin-top:1.5mm;line-height:1.7}
.qrbox{background:#fff;border-radius:2.5mm;padding:3mm;text-align:center}
.qrbox .ql{font-size:7pt;color:var(--ink3);margin-top:1.5mm;font-weight:700}
.qr img{width:100%;height:100%;display:block}

.webnav{margin-top:auto;background:var(--yuki);border:1px solid var(--line);border-radius:3mm;padding:5mm 6mm;display:grid;grid-template-columns:1fr auto;gap:6mm;align-items:center}
.webnav .wt{font-size:9.6pt;font-weight:800;color:var(--sugi)}
.webnav .wd{font-size:8.2pt;color:var(--ink3);margin-top:1.5mm;line-height:1.7}
.webnav .wu{font-size:7.6pt;color:var(--ink4);margin-top:2mm;font-family:var(--m);word-break:break-all}
.qrbox.sm{padding:2mm;background:#fff;border:1px solid var(--line)}
.foot{margin-top:4mm;border-top:1px solid var(--line);padding-top:3mm}
.foot p{font-size:6.8pt;line-height:1.6;color:var(--ink3)}
.foot .src{font-size:6.6pt;color:var(--ink4);margin-top:1.2mm;word-break:break-all}
.stamps{margin-top:2mm}
.stamp{display:inline-block;font-family:var(--m);font-size:6.8pt;color:var(--ink3);border:1px solid var(--line);border-radius:1.2mm;padding:.6mm 2mm;margin-right:1.5mm}
.pn{position:absolute;right:12mm;bottom:5mm;font-family:var(--m);font-size:7pt;color:var(--ink4)}
"""


def header(o, to_line):
    return f"""<div class="ph">
  <div class="brand">
    <div class="mark">み</div>
    <div><div class="bn">{esc(o["name"])}</div><div class="bt">{esc(o["tagline"])}</div></div>
  </div>
  <div class="to">{esc(to_line)}</div>
</div>"""


# ---------------------------------------------------------------- ブロック（資料の部品）
def blk_hero(b, ctx):
    ill = data_uri(b.get("illust", ""))
    ill_tag = f'<div class="illwrap"><img src="{ill}" alt=""></div>' if ill else ""
    note = f'<div class="note">{esc(b["note"])}</div>' if b.get("note") else ""
    return f"""<div class="head">
    <div class="kick">{esc(b.get("kicker", ""))}</div>
    <h1>{b["headline"]}</h1>
    {note}
    {ill_tag}
  </div>"""


def blk_calc(b, ctx):
    def box(item, cls):
        return (f'<div class="box {cls}"><div class="lb">{esc(item["label"])}</div>'
                f'<div class="yn">{esc(item["yen"])}</div></div>')
    memo = f'<div class="memo">{esc(b["note"])}</div>' if b.get("note") else ""
    return f"""<div class="calc">
    <div class="cap">{esc(b.get("caption", ""))}</div>
    {box(b["pay"], "pay")}
    <div class="op">{esc(b.get("op1", "−"))}</div>
    {box(b["back"], "back")}
    <div class="op">＝</div>
    {box(b["net"], "net")}
    {memo}
  </div>"""


def blk_rates(b, ctx):
    rows = "".join(
        f'<div class="rate"><div><div class="who">{esc(r["who"])}</div>'
        f'<div class="r">{esc(r["rate"])}</div></div>'
        f'<div class="cap2">{esc(r["cap"])}</div></div>'
        for r in b["items"]
    )
    return f'<div class="rates">{rows}</div>'


def blk_facts(b, ctx):
    rows = "".join(
        f'<div class="fact"><div class="ft">{esc(f["t"])}</div>'
        f'<div class="fd">{esc(f["d"])}</div></div>'
        for f in b["items"]
    )
    title = f'<div class="st">{esc(b["title"])}</div>' if b.get("title") else ""
    return f'{title}<div class="facts">{rows}</div>'


def blk_chips(b, ctx):
    chips = "".join(f'<span class="chip">{esc(c)}</span>' for c in b["items"])
    title = f'<div class="st">{esc(b["title"])}</div>' if b.get("title") else ""
    return f'{title}<div class="chips">{chips}</div>'


def blk_card(b, ctx):
    title = f'<div class="ct">{esc(b["title"])}</div>' if b.get("title") else ""
    fill = " fill" if b.get("fill") else ""
    mt = ' style="margin-top:4mm"' if b.get("gap", True) else ""
    return f'<div class="card{fill}"{mt}>{title}<div class="cd">{b["text"]}</div></div>'


def blk_steps(b, ctx):
    rows = "".join(
        f'<div class="step"><div class="stt">{esc(s["t"])}</div>'
        f'<div class="std">{esc(s["d"])}</div></div>'
        for s in b["items"]
    )
    title = f'<div class="st">{esc(b["title"])}</div>' if b.get("title") else ""
    n = len(b["items"])
    return f'{title}<div class="steps" style="grid-template-columns:repeat({n},1fr)">{rows}</div>'


def blk_traps(b, ctx):
    rows = "".join(
        f'<div class="trap"><div class="tt">{esc(t["t"])}</div>'
        f'<div class="td">{esc(t["d"])}</div></div>'
        for t in b["items"]
    )
    title = f'<div class="st">{esc(b["title"])}</div>' if b.get("title") else ""
    return f'{title}<div class="traps">{rows}</div>'


def blk_two(b, ctx):
    """左右2枚のカード。"""
    cards = "".join(
        f'<div class="card{" fill" if c.get("fill") else ""}">'
        f'<div class="ct">{esc(c["title"])}</div><div class="cd">{c["text"]}</div></div>'
        for c in b["items"]
    )
    title = f'<div class="st">{esc(b["title"])}</div>' if b.get("title") else ""
    return f'{title}<div class="rates" style="margin-top:0">{cards}</div>'


def blk_table(b, ctx):
    head = "".join(f"<th>{esc(h)}</th>" for h in b["head"])
    rows = "".join(
        "<tr>" + "".join(
            f'<td class="num">{esc(c)}</td>' if i and str(c).strip().startswith(("−", "＋", "¥", "約"))
            else f"<td>{c}</td>"
            for i, c in enumerate(r)
        ) + "</tr>"
        for r in b["rows"]
    )
    cap = f'<caption>{esc(b["caption"])}</caption>' if b.get("caption") else ""
    title = f'<div class="st">{esc(b["title"])}</div>' if b.get("title") else ""
    return f'{title}<table class="stbl">{cap}<tr>{head}</tr>{rows}</table>'


def blk_webnav(b, ctx):
    return f"""<div class="webnav">
    <div>
      <div class="wt">{esc(b.get("title", "くわしい解説はWebに載せています"))}</div>
      <div class="wd">{esc(b.get("text", "スマートフォンで読み取ってご覧ください。"))}</div>
      <div class="wu">{esc(ctx["qr"]["url"])}</div>
    </div>
    <div class="qrbox sm">{ctx["qr_small"]}</div>
  </div>"""


def blk_cta(b, ctx):
    o = ctx["office"]
    return f"""<div class="cta">
    <div>
      <div class="t">{esc(b.get("title", "対象になるか、まずご確認ください。"))}</div>
      <div class="d">{esc(b.get("text", "ご相談は無料です。"))}</div>
      <div class="tel">{esc(o["tel"])}</div>
      <div class="sub">{esc(o["telNote"])}　／　{esc(o["mail"])}　／　{esc(o["url"])}<br>
      {esc(o["name"])}　{esc(o["person"])}　{esc(o["belong"])}<br>{esc(o["address"])}</div>
    </div>
    <div class="qrbox">{ctx["qr"]["svg"]}<div class="ql">{esc(ctx["qr"]["label"])}</div></div>
  </div>"""


BLOCKS = {
    "hero": blk_hero, "calc": blk_calc, "rates": blk_rates, "facts": blk_facts,
    "chips": blk_chips, "card": blk_card, "steps": blk_steps, "traps": blk_traps,
    "two": blk_two, "table": blk_table, "webnav": blk_webnav, "cta": blk_cta,
}


def render_blocks(blocks, ctx):
    return "\n  ".join(BLOCKS[b["type"]](b, ctx) for b in blocks)


def build_html(cfg, common):
    o = common["office"]
    qr_big = qr_svg(cfg["qr"]["url"])
    ctx = {
        "office": o,
        "qr": {**cfg["qr"], "svg": qr_big},
        "qr_small": qr_svg(cfg["qr"]["url"], size_mm=17),
    }

    disc = "".join(
        f"<p>※ {esc(d)}</p>"
        for d in cfg.get("disclaimer", []) + common["disclaimerCommon"]
    )
    stamps = (
        f'<div class="stamps"><span class="stamp">作成 {esc(cfg["createdAt"])}</span>'
        f'<span class="stamp">根拠の確認 {esc(cfg["checkedAt"])}</span>'
        f'<span class="stamp">次回見直し {esc(cfg["reviewNext"])}</span></div>'
    )
    sources = "　／　".join(cfg["sources"])
    foot = f"""<div class="foot">
    {disc}
    <div class="src">出典：{esc(sources)}</div>
    {stamps}
  </div>"""

    pages = []
    for i, page in enumerate(cfg["pages"]):
        head = header(o, page.get("to", cfg["audience"]))
        body = render_blocks(page["blocks"], ctx)
        tail = foot if i == len(cfg["pages"]) - 1 else ""
        pages.append(f"\n  {head}\n  {body}\n  {tail}")

    n = len(pages)
    body = "".join(
        f'<section class="page">{pg}<div class="pn">{i} / {n}</div></section>'
        for i, pg in enumerate(pages, 1)
    )
    return (
        f'<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">'
        f'<title>{esc(cfg["title"])}｜{esc(o["name"])}</title>'
        f"<style>{CSS}</style></head><body>{body}</body></html>"
    )


def build_thumb(pdf_path, slug, top_ratio=0.56, width_px=760):
    """PDFの1ページ目から、カード用のサムネイル（表紙の上部を切り出したWebP）を作る。

    小さく載せても見出しと数字が読めるように、全体を縮小せず上部だけを使う。
    """
    from PIL import Image

    gs = shutil.which("gs")
    if not gs:
        print("警告: ghostscript が無いためサムネイルを作れません")
        return None

    out = ROOT / "assets" / "shiryo" / f"{slug}-cover.webp"
    out.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as td:
        png = pathlib.Path(td) / "cover.png"
        subprocess.run(
            [gs, "-dNOPAUSE", "-dBATCH", "-dQUIET", "-sDEVICE=png16m", "-r200",
             "-dFirstPage=1", "-dLastPage=1", f"-sOutputFile={png}", str(pdf_path)],
            check=True,
        )
        im = Image.open(png).convert("RGB")
        im = im.crop((0, 0, im.width, int(im.height * top_ratio)))
        h = int(im.height * (width_px / im.width))
        im = im.resize((width_px, h), Image.LANCZOS)
        im.save(out, "WEBP", quality=82, method=6)

    print(f"表紙: {out.relative_to(ROOT)}（{out.stat().st_size / 1024:.0f}KB）")
    return out


def main():
    if len(sys.argv) < 2:
        sys.exit("使い方: python3 scripts/shiryo/build_shiryo.py <資料ID> [--html]")
    slug = sys.argv[1]
    html_only = "--html" in sys.argv

    cfg_path = DATA / "shiryo" / f"{slug}.json"
    if not cfg_path.exists():
        sys.exit(f"資料データがありません: {cfg_path}")
    cfg = load(cfg_path)
    common = load(DATA / "shiryo" / "_common.json")

    # 作成日は根拠を確認した日に合わせる（勝手に「今日」にしない）
    cfg.setdefault("createdAt", cfg["checkedAt"])

    doc = build_html(cfg, common)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    if html_only:
        html_path = OUT_DIR / f"{slug}.html"
        html_path.write_text(doc, encoding="utf-8")
        print(f"HTML: {html_path.relative_to(ROOT)}")
        return

    from playwright.sync_api import sync_playwright

    out = OUT_DIR / f"{slug}.pdf"
    with tempfile.TemporaryDirectory() as td:
        raw = pathlib.Path(td) / "raw.pdf"
        html_path = pathlib.Path(td) / f"{slug}.html"
        html_path.write_text(doc, encoding="utf-8")
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            page = browser.new_page()
            page.goto(html_path.resolve().as_uri(), wait_until="networkidle")
            page.emulate_media(media="print")
            page.pdf(
                path=str(raw),
                format="A4",
                print_background=True,
                margin={"top": "0", "right": "0", "bottom": "0", "left": "0"},
            )
            browser.close()

        gs = shutil.which("gs")
        if gs:
            subprocess.run(
                [
                    gs,
                    "-sDEVICE=pdfwrite",
                    "-dCompatibilityLevel=1.5",
                    "-dPDFSETTINGS=/prepress",
                    "-dSubsetFonts=true",
                    "-dNOPAUSE",
                    "-dQUIET",
                    "-dBATCH",
                    f"-sOutputFile={out}",
                    str(raw),
                ],
                check=True,
            )
        else:
            shutil.copy(raw, out)
            print("警告: ghostscript が無いため未圧縮のまま出力しました")

    print(f"PDF : {out.relative_to(ROOT)}（{out.stat().st_size / 1024 / 1024:.2f}MB）")
    build_thumb(out, slug)


if __name__ == "__main__":
    main()
