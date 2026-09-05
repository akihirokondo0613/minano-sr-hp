#!/usr/bin/env python3
# 社内書式ページの生成器。
#   python3 scripts/shoshiki/build_shoshiki.py          … shoshiki.html と shoshiki/*.html を書き出す
#   python3 scripts/shoshiki/build_shoshiki.py --check  … 書き出さず、差分があれば exit 1
# 正本: data/shoshiki/forms.json（文面）。donor は portal.html（head・nav・footer の骨格を借りる）。
# 書式ページ（shoshiki/D-xx.html）は印刷用の独立HTMLで、会社情報はブラウザ内（localStorage）にだけ保存する。
import html
import json
import pathlib
import re
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent.parent
sys.path.insert(0, str(HERE))
import render_forms as R  # noqa: E402

e = html.escape
DATA = R.DATA
META = DATA["meta"]
AS_OF = META["as_of"]
DOMAIN = "https://minano-sr.com"
PAGE = "shoshiki.html"
FORM_URL = "https://forms.gle/vFUpB3fqzetNHQQKA"  # Word一式のメール登録（Googleフォーム・contact@・2026-09-05）
FORMS = [f for f in DATA["forms"] if f.get("to") != "社労士"]
BY_NO = {f["no"]: f for f in FORMS}

TITLE = "社内書式のひな形｜入社から退職まで52本を無料で｜みなの社会保険労務士事務所"
DESC = "入社誓約書・有給休暇申請書・身上異動届・休職届・退職届・労働者代表の選出・就業規則意見書など、会社と従業員の間で使う社内書式52本。ブラウザで記入して印刷でき、会社名を入れると全書式に自動で入ります。登録不要。"

CAT_NOTE = {
    "01_入社": "内定から入社までに取り交わす書類",
    "02_勤怠・休暇": "日々の申請。承認欄つき",
    "03_身上変更": "住所・氏名・扶養・口座の変更",
    "04_休職・復職": "私傷病で休むときと戻るとき",
    "05_懲戒・注意": "注意→事実確認→弁明→処分の順で",
    "06_退職": "退職・解雇・定年後の再雇用",
    "07_育児介護_補完": "厚労省様式に無い分の補完",
    "09_証明書": "本人の求めに応じて会社が発行",
    "10_労使協定・労働者代表": "36協定・就業規則の前提になる手続",
    "11_人事・賃金": "異動・昇給などの通知",
    "08_帳簿（Excel）": "法定帳簿のExcel",
}
CAT_ORDER = [
    "01_入社",
    "02_勤怠・休暇",
    "03_身上変更",
    "04_休職・復職",
    "05_懲戒・注意",
    "06_退職",
    "07_育児介護_補完",
    "09_証明書",
    "10_労使協定・労働者代表",
    "11_人事・賃金",
    "08_帳簿（Excel）",
]
SCENES = [
    (
        "人を採用する",
        [
            "D-01",
            "D-02",
            "D-03",
            "D-04",
            "D-05",
            "D-06",
            "D-07",
            "D-08",
            "D-09",
            "D-10",
            "D-38",
        ],
    ),
    ("残業・休暇・欠勤", ["D-11", "D-12", "D-13", "D-14", "D-50", "D-31", "D-32"]),
    ("住所・氏名・扶養・口座が変わった", ["D-16", "D-07"]),
    ("副業をしたいと言われた", ["D-15"]),
    ("病気で長く休む・復帰する", ["D-17", "D-18", "D-19", "D-20", "D-21"]),
    ("出産・育児・介護", ["D-47", "D-30"]),
    ("問題行動があった", ["D-22", "D-46", "D-44", "D-45", "D-23"]),
    (
        "退職する・辞めてもらう",
        ["D-24", "D-25", "D-26", "D-27", "D-28", "D-51", "D-42", "D-43", "D-29"],
    ),
    ("定年を迎える人がいる", ["D-48", "D-49"]),
    ("36協定・就業規則を出す", ["D-34", "D-35", "D-36", "D-37", "D-38", "D-40"]),
    ("給与の支払い方を決める", ["D-39", "D-40", "D-41"]),
    ("証明書を求められた", ["D-33", "D-43"]),
]


def href(f):
    if f.get("kind") == "xlsx":
        return f"shoshiki/{f['no']}_{f['title']}.xlsx"
    return f"shoshiki/{f['no']}.html"


CSS = """
/* 社内書式：会社情報の設定・場面チップ・分類表 */
.sh-set{background:var(--shiro);border:1px solid var(--line);border-radius:14px;padding:18px 20px 16px}
.sh-set .row{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px 16px}
.sh-set label{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--ink3);font-weight:700}
.sh-set input{font:inherit;font-size:14px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--shiro);color:var(--iwa);min-width:0}
.sh-set .btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.sh-set button{font:inherit;font-size:12.5px;font-weight:700;padding:7px 12px;border:1px solid var(--moegi-t);background:var(--shiro);color:var(--sugi);border-radius:8px;cursor:pointer}
.sh-set .hint{margin:10px 0 0;font-size:12px;line-height:1.9;color:var(--ink4)}
.sh-now{font-weight:700;color:var(--sugi)}
.qk-list{display:flex;flex-wrap:wrap;gap:10px}
.qk{display:inline-flex;align-items:center;gap:8px;background:var(--shiro);border:1px solid var(--line);border-radius:999px;padding:9px 16px;font-size:13px;font-weight:700;color:var(--ink2);letter-spacing:.02em;text-decoration:none;transition:border-color .34s cubic-bezier(.22,.61,.36,1),transform .34s cubic-bezier(.22,.61,.36,1)}
.qk::before{content:'';width:7px;height:7px;border-radius:50%;background:var(--moegi);flex-shrink:0}
.qk:hover{border-color:var(--moegi-t);transform:translateY(-2px);color:var(--sugi)}
.sh-scenes{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:12px}
.sh-scene{min-width:0;background:var(--shiro);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.sh-scene h3{margin:0 0 8px;font-size:14px;font-family:var(--disp);font-weight:800;color:var(--iwa)}
.sh-scene .qk{padding:6px 12px;font-size:12.5px;margin:2px 4px 2px 0}
.sh-cat{margin-top:22px}
.sh-cat h3{margin:0 0 2px;font-size:15.5px;font-family:var(--disp);font-weight:800;color:var(--iwa)}
.sh-cat .note{margin:0 0 8px;font-size:12.5px;color:var(--ink4)}
.sh-tblwrap{overflow-x:auto}
.sh-tbl{width:100%;min-width:560px;border-collapse:collapse;background:var(--shiro);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.sh-tbl th,.sh-tbl td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line2);vertical-align:top;font-size:13.5px;line-height:1.7}
.sh-tbl th{font-family:var(--mono);font-size:10.5px;color:var(--ink4);font-weight:400;letter-spacing:.08em;background:var(--kinu,#F7F8F3)}
.sh-tbl tr:last-child td{border-bottom:none}
.sh-tbl td.no{font-family:var(--mono);font-size:11.5px;color:var(--ink4);white-space:nowrap}
.sh-tbl td.nm a{color:var(--sugi);font-weight:700;text-decoration:none}
.sh-tbl td.nm a:hover{text-decoration:underline}
.sh-tbl td.use{color:var(--ink3)}
.sh-tbl td.go{white-space:nowrap}
.sh-tbl td.go a{font-family:var(--mono);font-size:12px;color:var(--moegi-t);text-decoration:none;font-weight:600}
.sh-word{background:var(--shiro);border:1px solid var(--line);border-radius:14px;padding:18px 20px}
.sh-word p{margin:0 0 10px;font-size:13.5px;line-height:1.9;color:var(--ink2)}
.sh-word .gbtn{display:inline-block;padding:10px 18px;background:var(--sugi);color:#fff;border-radius:999px;text-decoration:none;font-weight:700;font-size:14px}
.sh-word .gbtn:hover{background:var(--moegi-t)}
.sh-about p{font-size:13px;line-height:1.95;color:var(--ink3);margin:0 0 6px}
"""


def scene_block():
    out = ['<div class="sh-scenes">']
    for name, nos in SCENES:
        links = "".join(
            f'<a class="qk" href="{e(href(BY_NO[n]))}">{e(BY_NO[n]["title"])}</a>'
            for n in nos
            if n in BY_NO
        )
        out.append(f'<div class="sh-scene"><h3>{e(name)}</h3>{links}</div>')
    out.append("</div>")
    return "".join(out)


def cat_blocks():
    by_cat = {}
    for f in FORMS:
        by_cat.setdefault(f["cat"], []).append(f)
    out = []
    for cat in CAT_ORDER:
        fs = by_cat.get(cat, [])
        if not fs:
            continue
        out.append(
            f'<div class="sh-cat"><h3>{e(cat.split("_", 1)[1])}</h3><p class="note">{e(CAT_NOTE.get(cat, ""))}</p>'
        )
        out.append(
            '<div class="sh-tblwrap"><table class="sh-tbl"><thead><tr><th>番号</th><th>書式</th><th>用途</th><th></th></tr></thead><tbody>'
        )
        for f in fs:
            go = "Excel ↓" if f.get("kind") == "xlsx" else "記入する →"
            out.append(
                f'<tr><td class="no">{e(f["no"])}</td><td class="nm"><a href="{e(href(f))}">{e(f["title"])}</a></td><td class="use">{e(f["guide"]["use"])}</td><td class="go"><a href="{e(href(f))}">{go}</a></td></tr>'
            )
        out.append("</tbody></table></div></div>")
    return "".join(out)


def main_html():
    n_forms = len([f for f in FORMS if not f.get("kind")])
    n_xlsx = len([f for f in FORMS if f.get("kind")])
    set_panel = (
        '<div class="sh-set" id="cfg-wrap"><div class="row">'
        '<label>会社名<input id="co-name" placeholder="株式会社○○"></label>'
        '<label>代表者の役職<input id="co-title" placeholder="代表取締役"></label>'
        '<label>代表者氏名<input id="co-rep" placeholder="○○ ○○"></label>'
        '<label>所在地<input id="co-addr" placeholder="富山市○○1-2-3"></label>'
        '<label>電話<input id="co-tel" placeholder="076-000-0000"></label>'
        '<label>担当部署・担当者<input id="co-dept" placeholder="総務部 ○○"></label>'
        '</div><div class="btns"><button type="button" onclick="coExport()">設定をファイルに書き出す</button>'
        '<button type="button" onclick="document.getElementById(\'co-file\').click()">設定ファイルを読み込む</button><input type="file" id="co-file" accept=".json" style="display:none" onchange="coImport(this)">'
        '<button type="button" onclick="coClear()">消去</button></div>'
        '<p class="hint">いま設定されている会社名：<span class="co-name sh-now">【会社名】</span>。入力した内容はこのブラウザの中にだけ保存され、当事務所には送信されません。各書式を開くと宛名・発信者欄・右下の社名に自動で入ります。別のPCで使うときは「書き出す」で保存したファイルを読み込んでください。</p></div>'
    )
    return f"""<main id="main" class="content">

  <section class="cat rv" id="setting">
    <div class="cat-head">
      <div class="cat-icon kmono" aria-hidden="true">社名</div>
      <h2 class="cat-title">会社情報を入れる</h2>
    </div>
    <p class="cat-desc">最初に一度だけ入力してください。すべての書式の宛名・発信者欄・右下の社名に入ります。</p>
    {set_panel}
  </section>

  <section class="cat rv" id="scene">
    <div class="cat-head">
      <div class="cat-icon kmono" aria-hidden="true">場面</div>
      <h2 class="cat-title">場面から探す</h2>
    </div>
    <p class="cat-desc">「こういうことが起きた」から必要な書式へ。開くとブラウザ上でそのまま記入し、印刷またはPDFに保存できます。</p>
    {scene_block()}
  </section>

  <section class="cat rv" id="list">
    <div class="cat-head">
      <div class="cat-icon kmono" aria-hidden="true">一覧</div>
      <h2 class="cat-title">分類から探す</h2>
    </div>
    <p class="cat-desc">書式{n_forms}本と帳簿{n_xlsx}本。用途の欄に、その書式が要る理由を一行で書いています。</p>
    {cat_blocks()}
  </section>

  <section class="cat rv" id="word">
    <div class="cat-head">
      <div class="cat-icon kmono" aria-hidden="true">Word</div>
      <h2 class="cat-title">Word版を一式でほしい方へ</h2>
    </div>
    <div class="sh-word">
      <p>全書式のWord版（zip）を、メール登録の方にお渡しします。法改正で書式を更新したときは、希望された方にだけお知らせします。登録した内容は書式のお渡しと更新案内にしか使いません。</p>
      <a class="gbtn" href="{e(FORM_URL)}" target="_blank" rel="noopener">メール登録してWord一式を受け取る ↗</a>
    </div>
  </section>

  <section class="cat rv sh-about" id="about">
    <div class="cat-head">
      <div class="cat-icon kmono" aria-hidden="true">注</div>
      <h2 class="cat-title">この書式集について</h2>
    </div>
    <p>書式は一般的な内容で、法令は{e(AS_OF[:7].replace("-", "年"))}月時点の理解に基づいて作っています。会社の就業規則・労使協定と食い違うときは規程が優先します。解雇・懲戒・労使協定など、書式だけでは判断できない場面は、使う前に専門家にご確認ください。</p>
    <p>自社内での利用と改変は自由です。第三者への再配布・販売はご遠慮ください。作成・提供：みなの社会保険労務士事務所（富山市）。</p>
  </section>

</main>"""


def build_index():
    donor = (REPO / "portal.html").read_text(encoding="utf-8")
    s = donor
    # head
    s = re.sub(
        r"<title>.*?</title>", f"<title>{e(TITLE)}</title>", s, count=1, flags=re.S
    )
    s = re.sub(
        r'<meta name="description" content="[^"]*">',
        f'<meta name="description" content="{e(DESC)}">',
        s,
        count=1,
    )
    s = s.replace(f"{DOMAIN}/portal.html", f"{DOMAIN}/{PAGE}")
    s = re.sub(
        r'<meta property="og:title" content="[^"]*">',
        f'<meta property="og:title" content="{e(TITLE)}">',
        s,
        count=1,
    )
    s = re.sub(
        r'<meta property="og:description" content="[^"]*">',
        f'<meta property="og:description" content="{e(DESC)}">',
        s,
        count=1,
    )
    schema_obj = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "CollectionPage",
                "@id": f"{DOMAIN}/{PAGE}#webpage",
                "url": f"{DOMAIN}/{PAGE}",
                "name": TITLE,
                "description": DESC,
                "isPartOf": {"@id": f"{DOMAIN}/#website"},
                "publisher": {"@id": f"{DOMAIN}/#office"},
                "inLanguage": "ja-JP",
            },
            {
                "@type": "BreadcrumbList",
                "@id": f"{DOMAIN}/{PAGE}#breadcrumb",
                "itemListElement": [
                    {
                        "@type": "ListItem",
                        "position": 1,
                        "name": "ホーム",
                        "item": f"{DOMAIN}/",
                    },
                    {
                        "@type": "ListItem",
                        "position": 2,
                        "name": "社内書式",
                        "item": f"{DOMAIN}/{PAGE}",
                    },
                ],
            },
        ],
    }
    schema = (
        '<script type="application/ld+json" data-schema="webpage-collection">\n'
        + json.dumps(schema_obj, ensure_ascii=False, indent=2)
        + "\n</script>"
    )
    s = re.sub(
        r'<script type="application/ld\+json" data-schema="webpage-collection">.*?</script>',
        lambda _: schema,
        s,
        count=1,
        flags=re.S,
    )
    s = re.sub(
        r'<style id="fs-portal">.*?</style>',
        lambda _: f'<style id="fs-shoshiki">{CSS}</style>',
        s,
        count=1,
        flags=re.S,
    )
    # nav: 公式情報のactiveを外す（このページはナビ項目ではない）
    s = s.replace(
        '<li><a href="portal.html" class="active" aria-current="page">公式情報</a></li>',
        '<li><a href="portal.html">公式情報</a></li>',
    )
    s = s.replace(
        '<a href="portal.html" onclick="closeNav()" aria-current="page">公式情報</a>',
        '<a href="portal.html" onclick="closeNav()">公式情報</a>',
    )
    # hero
    s = re.sub(
        r'<nav class="breadcrumb">.*?</nav>',
        '<nav class="breadcrumb"><a href="/">ホーム</a><span class="sep">›</span><span>社内書式</span></nav>',
        s,
        count=1,
        flags=re.S,
    )
    s = re.sub(
        r'<div class="page-label">.*?</div>',
        '<div class="page-label">Internal Forms</div>',
        s,
        count=1,
        flags=re.S,
    )
    s = re.sub(
        r'<h1 class="page-h">.*?</h1>',
        '<h1 class="page-h">会社で使う<br><strong>社内書式のひな形</strong></h1>',
        s,
        count=1,
        flags=re.S,
    )
    s = re.sub(
        r'<p class="page-sub">.*?</p>',
        '<p class="page-sub">入社から退職までに会社と従業員の間で使う申請書・届出・誓約書・通知書のひな形です。ブラウザで記入して印刷でき、会社名を入れると全書式に自動で入ります。登録は不要です。</p>',
        s,
        count=1,
        flags=re.S,
    )
    s = re.sub(
        r"<b>ご利用にあたって</b>.*?</div>\s*</div>\s*</header>",
        "<b>ご利用にあたって</b>書式は一般的な内容です。就業規則や労使協定と食い違うときは規程が優先します。入力した会社情報はブラウザ内にだけ保存され、当事務所には送信されません。使い方や就業規則との整合はお気軽にご相談ください。\n    </div>\n  </div>\n</header>",
        s,
        count=1,
        flags=re.S,
    )
    # main
    s = re.sub(
        r'<main id="main" class="content">.*?</main>',
        lambda _: main_html(),
        s,
        count=1,
        flags=re.S,
    )
    # bottom cta
    s = re.sub(
        r'<div class="bcc-text">.*?</div>\s*<a href="uploads/contact.html" class="bcc-btn">',
        '<div class="bcc-text">\n      <h3>書式の使い方や、就業規則との整合はご相談ください</h3>\n      <p>解雇・懲戒・労使協定など、書式だけでは判断できない場面は、状況を伺ってから進め方をお伝えします。</p>\n    </div>\n    <a href="uploads/contact.html" class="bcc-btn">',
        s,
        count=1,
        flags=re.S,
    )
    # 計測パス
    s = s.replace('"path":"/portal.html"', f'"path":"/{PAGE}"')
    # 会社情報のJS（書式ページと同じ localStorage キー）
    s = s.replace("</body>", f"<script>{R.JS}</script>\n</body>", 1)
    return s


def build_form(f):
    s = R.page(f, True)
    s = s.replace(
        '<meta charset="utf-8">',
        '<meta charset="utf-8"><meta name="robots" content="noindex,follow">',
        1,
    )
    # A4固定幅（210mm≒794px）の印刷書式なので、スマホでは仮想幅820pxで全体を縮小表示させる
    # （device-width のままだと横スクロールになる）。PCの表示は変わらない。
    s = re.sub(
        r'<meta name="viewport" content="[^"]*">',
        '<meta name="viewport" content="width=820">',
        s,
        count=1,
    )
    s = s.replace(
        '<div class="bar"><b>編集モード</b>',
        '<div class="bar"><a href="../shoshiki.html" style="color:#fff;text-decoration:none;font-weight:700">← 社内書式一覧</a><b>編集モード</b>',
        1,
    )
    return s


def mark_phrases(text):
    """文節の切れ目に <wbr> を置く（scripts/lib/phrase-breaks.mjs と同じ関数を通す）。
    他の生成器と同様、生成物は最初から印つきで書き出し、sync-phrase-breaks --check で差が出ないようにする。"""
    lib = (REPO / "scripts" / "lib" / "phrase-breaks.mjs").as_uri()
    js = (
        f"import({lib!r}).then(m=>{{let b='';process.stdin.setEncoding('utf8');"
        "process.stdin.on('data',c=>b+=c);process.stdin.on('end',()=>process.stdout.write(m.markPhrases(b).html))})"
    )
    r = subprocess.run(
        ["node", "-e", js],
        input=text,
        capture_output=True,
        text=True,
        cwd=REPO,
        check=True,
    )
    return r.stdout


def main():
    check = "--check" in sys.argv
    outputs = {REPO / PAGE: mark_phrases(build_index())}
    for f in FORMS:
        if f.get("kind") == "xlsx":
            continue
        outputs[REPO / "shoshiki" / f"{f['no']}.html"] = mark_phrases(build_form(f))
    diff = []
    for p, content in outputs.items():
        cur = p.read_text(encoding="utf-8") if p.exists() else None
        if cur != content:
            diff.append(p.relative_to(REPO).as_posix())
            if not check:
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(content, encoding="utf-8")
    if check:
        if diff:
            print(
                "社内書式ページが最新ではありません。python3 scripts/shoshiki/build_shoshiki.py を実行してください。"
            )
            for d in diff:
                print("-", d)
            sys.exit(1)
        print("社内書式ページは最新です。")
        return
    print(f"wrote {len(outputs)} files（更新 {len(diff)}）")


if __name__ == "__main__":
    main()
