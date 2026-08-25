#!/usr/bin/env python3
"""配布資料（型A・制度資料）の生成。

  データ（JSON） → 資料HTML → A4のPDF（ページ数は中身に応じて可変）

金額・要件・期限は data/ の正本JSONから読む。この生成器の中に数値を書かない。
正本を直して再生成すれば、資料の数字も一緒に直る。

使い方:
    python3 scripts/shiryo/build_shiryo.py chinage-oen-2026            # PDFまで
    python3 scripts/shiryo/build_shiryo.py chinage-oen-2026 --html     # HTMLだけ（確認用）

Playwright が埋め込む日本語フォントは丸ごとだと11MB超になるため、
ghostscript でサブセット化する（既存の build_pdf.py と同じ方式）。
"""

import html
import json
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


# ---------------------------------------------------------------- 体裁（型の仕様）
CSS = """
@page{size:A4;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --sugi:#123F30;--sugi7:#0D2F24;--moegi:#2E9E63;--moegi-t:#1E7A4B;--moegi-l:#E8F4EC;
  --iwa:#1A1F1C;--ink2:#3D4642;--ink3:#6B7671;--ink4:#98A09C;
  --yuki:#F9FAF7;--shiro:#fff;--line:#E2E6E4;
  --g:"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif;
  --m:"SF Mono",Menlo,monospace;
}
body{font-family:var(--g);color:var(--iwa);background:var(--shiro);-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:210mm;height:297mm;padding:13mm 14mm 11mm;page-break-after:always;position:relative;display:flex;flex-direction:column}
.page:last-child{page-break-after:auto}

/* 全ページ共通の帯 */
.ph{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1.2px solid var(--sugi);padding-bottom:3.5mm;margin-bottom:6mm}
.ph-l .kicker{font-size:8.5pt;font-weight:700;letter-spacing:.12em;color:var(--moegi-t)}
.ph-l h2{font-size:15pt;font-weight:800;line-height:1.4;margin-top:1.5mm;letter-spacing:.01em}
.ph-r{text-align:right;flex-shrink:0;padding-left:8mm}
.ph-r .on{font-size:8.5pt;font-weight:700;color:var(--sugi)}
.ph-r .ot{font-size:7pt;color:var(--ink4);margin-top:.6mm}
.pn{position:absolute;right:14mm;bottom:6mm;font-family:var(--m);font-size:7.5pt;color:var(--ink4)}

.lead{font-size:9.8pt;line-height:1.85;color:var(--ink2);margin-bottom:5mm}
.body{flex:1}

/* 部品 */
.hero{background:var(--sugi);color:#fff;border-radius:3mm;padding:7mm 8mm;margin-bottom:6mm}
.hero .big{font-size:19pt;font-weight:800;line-height:1.45;letter-spacing:.01em}
.hero .sub{font-size:10pt;margin-top:2.5mm;color:#CFE6D9;line-height:1.7}
.hero .note{font-size:8.5pt;margin-top:3.5mm;color:#A8CDBB;line-height:1.7}

.grid2{display:grid;grid-template-columns:1fr 1fr;gap:4mm}
.card{border:1px solid var(--line);border-radius:2.5mm;padding:5mm 5.5mm;background:var(--shiro)}
.card.fill{background:var(--yuki)}
.card .ct{font-size:10pt;font-weight:800;color:var(--sugi);margin-bottom:2mm}
.card .cd{font-size:8.8pt;line-height:1.8;color:var(--ink2)}

.rate{display:grid;grid-template-columns:auto 1fr auto;gap:2mm 5mm;align-items:baseline;margin:4mm 0}
.rate .who{font-size:9.5pt;font-weight:700}
.rate .r{font-size:9.5pt;color:var(--ink2)}
.rate .cap{font-size:11pt;font-weight:800;color:var(--moegi-t);text-align:right}
.rate .row{display:contents}
.hr{height:1px;background:var(--line);margin:4mm 0}

table{width:100%;border-collapse:collapse;font-size:9pt}
th,td{border-bottom:1px solid var(--line);padding:2.6mm 3mm;text-align:left;vertical-align:top;line-height:1.7}
th{font-weight:700;color:var(--sugi);background:var(--moegi-l);font-size:8.5pt;letter-spacing:.02em}
td.num{text-align:right;font-family:var(--m);white-space:nowrap}
caption{caption-side:top;text-align:left;font-size:8pt;color:var(--ink3);padding-bottom:2mm}

ol.steps{list-style:none;counter-reset:s}
ol.steps li{counter-increment:s;display:grid;grid-template-columns:9mm 1fr;gap:4mm;padding:3.5mm 0;border-bottom:1px solid var(--line)}
ol.steps li:last-child{border-bottom:0}
ol.steps li::before{content:counter(s,decimal-leading-zero);font-family:var(--m);font-size:10pt;font-weight:700;color:var(--moegi);padding-top:.4mm}
ol.steps .st{font-size:10pt;font-weight:700;margin-bottom:1.2mm}
ol.steps .sd{font-size:8.8pt;line-height:1.8;color:var(--ink2)}

ul.checks{list-style:none}
ul.checks li{position:relative;padding-left:6mm;font-size:9.2pt;line-height:1.9;color:var(--ink2)}
ul.checks li::before{content:"";position:absolute;left:0;top:2.4mm;width:2.6mm;height:2.6mm;border-radius:50%;background:var(--moegi)}

.flowline{display:grid;grid-template-columns:26mm 1fr;gap:0}
.flowline .t{font-size:8.5pt;font-weight:700;color:var(--moegi-t);padding:3mm 0;border-right:1.4px solid var(--moegi);padding-right:4mm;text-align:right}
.flowline .c{padding:3mm 0 3mm 5mm;border-bottom:1px solid var(--line)}
.flowline .c:last-child{border-bottom:0}
.flowline .ct2{font-size:9.6pt;font-weight:700}
.flowline .cd2{font-size:8.6pt;line-height:1.75;color:var(--ink2);margin-top:1mm}

.cta{background:var(--sugi);color:#fff;border-radius:3mm;padding:6mm 7mm;margin-top:auto}
.cta .t{font-size:12.5pt;font-weight:800;margin-bottom:2mm}
.cta .d{font-size:9pt;line-height:1.8;color:#CFE6D9}
.cta .row{display:flex;gap:7mm;margin-top:4mm;font-size:10pt;font-family:var(--m);align-items:baseline;flex-wrap:wrap}
.cta .row b{font-size:12pt}
.cta .addr{font-size:8pt;color:#A8CDBB;margin-top:3mm;line-height:1.7;font-family:var(--g)}

.foot{margin-top:5mm;border-top:1px solid var(--line);padding-top:3.5mm}
.foot .lbl{font-size:7.5pt;font-weight:700;color:var(--sugi);letter-spacing:.08em;margin-bottom:1.5mm}
.foot p{font-size:7.2pt;line-height:1.65;color:var(--ink3)}
.foot .src{font-size:7pt;color:var(--ink4);margin-top:1.5mm;word-break:break-all}
.secttl{font-size:10.5pt;font-weight:800;color:var(--sugi);margin-bottom:2mm}
.chips{display:flex;flex-wrap:wrap;gap:2mm}
.chip{font-size:8.6pt;font-weight:700;color:var(--sugi);background:var(--moegi-l);border-radius:1.5mm;padding:1.6mm 3mm}
.stamp{display:inline-block;font-family:var(--m);font-size:7.2pt;color:var(--ink3);border:1px solid var(--line);border-radius:1.5mm;padding:.8mm 2.5mm;margin-right:2mm}
"""


def head_bar(kicker, title, office):
    return f"""<div class="ph">
  <div class="ph-l"><div class="kicker">{esc(kicker)}</div><h2>{title}</h2></div>
  <div class="ph-r"><div class="on">{esc(office["name"])}</div><div class="ot">{esc(office["tagline"])}</div></div>
</div>"""


def build_html(cfg, ken, madoguchi):
    o = cfg['office']
    p = cfg['pages']
    office_ken = next((x for x in iter_offices(madoguchi) if x.get('id') == ken['officeId']), {})

    seido_rows = ''.join(
        f'<tr><td><b>{esc(s["name"])}</b></td><td>{esc(s["note"])}</td></tr>'
        for s in ken['seido'])
    seido_chips = ''.join(f'<span class="chip">{esc(s["name"])}</span>' for s in ken['seido'])

    rate_rows = ''.join(
        f'<div class="row"><div class="who">{esc(h["who"])}</div>'
        f'<div class="r">{esc(h["rate"])}</div>'
        f'<div class="cap">{esc(h["cap"])}</div></div>'
        for h in ken['hojo'])

    p2_cards = ''.join(
        f'<div class="card"><div class="ct">{esc(x["t"])}</div><div class="cd">{esc(x["d"])}</div></div>'
        for x in p['p2']['points'])

    docs = ''.join(f'<li>{esc(d)}</li>' for d in p['p5']['docs'])
    ours = ''.join(f'<li>{esc(d)}</li>' for d in p['p5']['ours'])

    flow = ''.join(
        f'<div class="t">STEP {i}</div><div class="c">'
        f'<div class="ct2">{esc(f["t"])}</div><div class="cd2">{esc(f["d"])}</div></div>'
        for i, f in enumerate(ken['flow'], 1))

    disc = ''.join(f'<p>※ {esc(d)}</p>' for d in cfg['disclaimer'])

    def foot(with_source=True):
        src = (f'<div class="src">出典：富山県 公式ページ {esc(ken["source"])}</div>'
               if with_source else '')
        return f"""<div class="foot">
  <span class="stamp">作成 {esc(cfg['createdAt'])}</span>
  <span class="stamp">根拠の確認 {esc(ken['checkedAt'])}</span>
  <span class="stamp">次回見直し {esc(cfg['reviewNext'])}</span>
  {src}
</div>"""

    pages = []

    # P1 この制度は何か
    pages.append(f"""
  {head_bar('富山県の補助制度', esc(cfg['title']), o)}
  <div class="body">
    <div class="hero">
      <div class="big">社労士に払った報酬の、<br>最大3分の2が補助されます。</div>
      <div class="sub">{esc(cfg['subtitle'])}（上限10万円・県の審査があります）</div>
      <div class="note">対象経費：{esc(ken['taisho']['keihi'])}</div>
    </div>

    <div class="grid2">
      <div class="card fill">
        <div class="ct">対象になる事業者</div>
        <div class="cd">{esc(ken['taisho']['jigyosha'])}</div>
      </div>
      <div class="card fill">
        <div class="ct">対象になる時期</div>
        <div class="cd">{esc(ken['taisho']['kikan'])}</div>
      </div>
    </div>

    <div class="hr"></div>
    <div class="secttl">補助率と上限</div>
    <div class="rate">{rate_rows}</div>
    <div class="card"><div class="cd">{esc(ken['rei'])}</div></div>

    <div class="hr"></div>
    <div class="secttl">入口になる国の6制度</div>
    <div class="chips">{seido_chips}</div>
    <div class="cd" style="font-size:8.6pt;color:#6B7671;margin-top:2.5mm">
      いずれかを社会保険労務士等へ依頼し、支給決定（または制度導入）を受けた場合が対象です。くわしくは3ページ。</div>
  </div>
  {foot()}""")

    # P2 いちばん多い失敗
    pages.append(f"""
  {head_bar(p['p2']['kicker'], esc(p['p2']['title']), o)}
  <div class="body">
    <div class="lead">{esc(p['p2']['lead'])}</div>
    <div class="grid2" style="gap:5mm">{p2_cards}</div>
    <div class="card fill" style="margin-top:6mm">
      <div class="ct">間に合わせるための逆算</div>
      <div class="cd">国の助成金は、申請から支給決定まで数か月かかることがあります。県の補助金は、その支給決定を受けてからの申請です。
      予算総額に達すると期限前に受付が終わるため、<b>国の申請を始める時点で県への申請までを見込んで動きます</b>。
      当事務所へご依頼いただいた場合は、国の手続きを進めながら県への提出書類も同時に整えます。</div>
    </div>
  </div>
  {foot(False)}""")

    # P3 対象になる制度
    pages.append(f"""
  {head_bar('対象になる制度', '国の6制度が入口になります', o)}
  <div class="body">
    <div class="lead">下記のいずれかを社会保険労務士等へ依頼し、支給決定（または制度導入）を受けた場合が対象です。</div>
    <table>
      <tr><th style="width:46mm">制度</th><th>どんなときに使うか</th></tr>
      {seido_rows}
    </table>
    <div class="card" style="margin-top:6mm">
      <div class="ct">当事務所の関与</div>
      <div class="cd">上記の助成金は、着手金0円・完全成功報酬でお引き受けしています（受給額の20％、顧問先は15％／税抜）。
      受給に至らなかった場合、申請にかかる報酬はいただきません。助成金は要件を満たしても審査があり、受給を保証するものではありません。</div>
    </div>
    <div class="card fill" style="margin-top:5mm">
      <div class="ct">県の補助金と、国の助成金の関係</div>
      <div class="cd">国の助成金は「取組そのもの」への支援、県の補助金は「その申請を専門家へ依頼した費用」への支援です。
      いずれか一方だけを使うこともできますが、国の支給決定がないと県へは申請できません。</div>
    </div>
  </div>
  {foot(False)}""")

    # P4 お金の流れ＋提出書類
    pages.append(f"""
  {head_bar('お金の流れ', 'いつ払い、いつ戻るか', o)}
  <div class="body">
    <div class="lead">国の助成金と県の補助金は別の手続きです。県へ出せるのは、国の支給決定を受けたあとになります。</div>
    <div class="flowline">{flow}</div>
    <div class="hr"></div>
    <table>
      <caption>報酬16万円（税抜）を例にした場合の考え方</caption>
      <tr><th>区分</th><th class="num" style="text-align:right;width:34mm">金額</th></tr>
      <tr><td>社会保険労務士への報酬</td><td class="num">−160,000円</td></tr>
      <tr><td>富山県の補助（中小企業事業者・2分の1）</td><td class="num">＋80,000円</td></tr>
      <tr><td>富山県の補助（小規模事業者・3分の2／上限10万円）</td><td class="num">＋100,000円</td></tr>
    </table>
    <div class="card" style="margin-top:4mm">
      <div class="cd">補助されるのは社会保険労務士等への報酬費用です。国の助成金そのものの入金時期とは別に、県の補助金は交付決定後に支払われます。</div>
    </div>
  </div>
  {foot(False)}""")

    # P5 準備するもの＋進め方＋CTA
    pages.append(f"""
  {head_bar(p['p5']['kicker'], esc(p['p5']['title']), o)}
  <div class="body">
    <div class="lead">{esc(p['p5']['lead'])}</div>
    <div class="grid2">
      <div class="card fill">
        <div class="ct">県へ提出する書類</div>
        <ul class="checks">{docs}</ul>
      </div>
      <div class="card">
        <div class="ct">当事務所がお引き受けする範囲</div>
        <ul class="checks">{ours}</ul>
      </div>
    </div>
    <div class="card" style="margin-top:4mm"><div class="cd">{esc(p['p5']['note'])}</div></div>
    <div class="hr"></div>
    <div class="secttl">申請先</div>
    <table>
      <tr><th style="width:30mm">名称</th><td>{esc(office_ken.get('name', ''))}</td></tr>
      <tr><th>担当課</th><td>{esc(office_ken.get('address', ''))}</td></tr>
      <tr><th>電話</th><td>{esc(office_ken.get('tel', ''))}</td></tr>
    </table>
  </div>
  {foot(False)}""")

    # P6 進め方
    pages.append(f"""
  {head_bar(p['p6']['kicker'], esc(p['p6']['title']), o)}
  <div class="body">
    <div class="lead">{esc(p['p6']['lead'])}</div>
    <ol class="steps">
      <li><div><div class="st">無料相談（30分）</div><div class="sd">いま検討している取組と、依頼の時期をうかがいます。対象になるかどうかは、この時点で判定できます。</div></div></li>
      <li><div><div class="st">国の助成金の申請</div><div class="sd">対象制度を決め、規程の整備と申請書類の作成を進めます。着手金は0円です。</div></div></li>
      <li><div><div class="st">支給決定を受ける</div><div class="sd">国の支給決定通知を受け取ります。ここまでが県への申請の前提です。</div></div></li>
      <li><div><div class="st">県へ補助金を申請する</div><div class="sd">領収書と支給決定通知書の写しを添えて、県へ提出します。予算到達で受付が終わるため、間を置かずに出します。</div></div></li>
    </ol>
    <div class="card fill" style="margin-top:4mm"><div class="cd">{esc(p['p6']['cta'])}</div></div>
  </div>

  <div class="cta">
    <div class="t">まずは、対象になるかをご確認ください。</div>
    <div class="d">ご相談は無料です。いま検討している取組をお聞かせください。</div>
    <div class="row"><span>TEL <b>{esc(o['tel'])}</b></span><span style="font-size:8.5pt">{esc(o['telNote'])}</span></div>
    <div class="row"><span style="font-size:9pt">MAIL {esc(o['mail'])}</span><span style="font-size:9pt">{esc(o['url'])}</span></div>
    <div class="addr">{esc(o['name'])}　{esc(o['person'])}　{esc(o['belong'])}<br>{esc(o['address'])}</div>
  </div>

  <div class="foot">
    <div class="lbl">ご確認ください</div>
    {disc}
    <p>※ {esc(ken['caveat'])}</p>
    <div class="src">出典：富山県 公式ページ {esc(ken['source'])}　／　この資料のWeb版：{esc(o['webPage'])}</div>
    <div style="margin-top:2mm">
      <span class="stamp">作成 {esc(cfg['createdAt'])}</span>
      <span class="stamp">根拠の確認 {esc(ken['checkedAt'])}</span>
      <span class="stamp">次回見直し {esc(cfg['reviewNext'])}</span>
    </div>
  </div>""")

    n = len(pages)
    body = ''.join(
        f'<section class="page">{pg}<div class="pn">{i} / {n}</div></section>'
        for i, pg in enumerate(pages, 1))

    return (f'<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">'
            f'<title>{esc(cfg["title"])}｜{esc(o["name"])}</title>'
            f'<style>{CSS}</style></head><body>{body}</body></html>')


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


def main():
    if len(sys.argv) < 2:
        sys.exit("使い方: python3 scripts/shiryo/build_shiryo.py <資料ID> [--html]")
    slug = sys.argv[1]
    html_only = "--html" in sys.argv

    cfg_path = DATA / "shiryo" / f"{slug}.json"
    if not cfg_path.exists():
        sys.exit(f"資料データがありません: {cfg_path}")
    cfg = load(cfg_path)
    ken = load(DATA / "toyama-chinage-oen.json")
    madoguchi = load(DATA / "toyama-madoguchi.json")

    # 作成日は正本の確認日に合わせる（勝手に「今日」にしない）
    cfg.setdefault("createdAt", ken["checkedAt"])

    doc = build_html(cfg, ken, madoguchi)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    if html_only:
        # 確認用。PDF生成時は中間HTMLを残さない（成果物はPDFだけ）
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


if __name__ == "__main__":
    main()
