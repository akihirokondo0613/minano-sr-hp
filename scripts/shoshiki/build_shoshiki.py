#!/usr/bin/env python3
# 社内書式ページの生成器。
#   python3 scripts/shoshiki/build_shoshiki.py          … shoshiki.html・shoshiki/*.html・shoshiki/dl/word-7kq3x9/index.html を書き出す
#   python3 scripts/shoshiki/build_shoshiki.py --check  … 書き出さず、差分があれば exit 1
# 正本: data/shoshiki/forms.json（文面。作り方は make_json.py と docs/shoshiki.md）。donor は portal.html（head・nav・footer の骨格を借りる）。
# 書式ページ（shoshiki/D-xx.html）は印刷用の独立HTMLで、会社情報はブラウザ内（localStorage）にだけ保存する。
# 社内書式50本はHTML版。入社書類セットと社労士への手続き連絡票は別に案内する。
# 旧Office版の元データと保管用生成器は非公開で保持する。
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
DL_PATH = "shoshiki/dl/word-7kq3x9"
FORMS = [f for f in DATA["forms"] if f.get("to") != "社労士" and not f.get("kind")]
BY_NO = {f["no"]: f for f in FORMS}
N_FORMS = len(FORMS)
COMMON_PREVIEWS = json.loads(
    (REPO / "data" / "shoshiki" / "common_previews.json").read_text(encoding="utf-8")
)
COMMON_CATEGORIES = ["入社", "勤務・休暇", "休職・退職", "証明・その他"]
if len({form["no"] for form in COMMON_PREVIEWS}) != len(COMMON_PREVIEWS):
    raise ValueError("基本書式のプレビュー番号が重複しています。")
for form in COMMON_PREVIEWS:
    source = BY_NO.get(form["no"])
    if (
        not source
        or form["title"] != source["title"]
        or form["category"] not in COMMON_CATEGORIES
        or form["preview"] != f"assets/previews/common/{form['no']}.webp"
        or not form["use"]
    ):
        raise ValueError(f"基本書式のプレビュー情報を確認してください：{form['no']}")
ONBOARDING_KIT = [
    {
        "file": "guide.pdf",
        "title": "入社書類の準備ガイド",
        "role": "会社が用意",
        "use": "提出先・提出期限を入力して、従業員へ渡します。必要な書類と、準備する順番を確認できます。",
        "contents": "本人が記入する書類、番号を確認する資料、条件に応じて提出する資料。",
        "format": "入力欄付き／全2ページ",
        "download": "入社書類セット_準備ガイド.pdf",
        "preview": "assets/previews/onboarding-guide-preview.webp",
        "preview_alt": "入社書類の準備ガイドの1ページ目",
        "preview_caption": "準備ガイドの1ページ目",
    },
    {
        "file": "labor-notice.xlsx",
        "title": "労働条件通知書",
        "role": "会社が作成・交付",
        "use": "厚生労働省のモデルをもとにしたExcelです。入力シートに雇用条件を記入し、一般労働者用・短時間労働者用の通知書を印刷します。",
        "contents": "契約期間、業務・就業場所、勤務時間・休日、賃金、退職に関する条件。",
        "format": "Excel／入力・一般・短時間の3シート",
        "download": "労働条件通知書_入力用.xlsx",
        "preview": "assets/previews/labor-notice-sample.webp",
        "preview_alt": "会社が作成する労働条件通知書の架空記入例（一般労働者用）",
        "preview_caption": "一般労働者用の架空記入例",
    },
    {
        "file": "personal.pdf",
        "title": "従業員本人情報シート",
        "role": "従業員が記入",
        "use": "氏名・住所と、社会保険・雇用保険の手続きに使う番号をご記入ください。番号の確認資料も欄の近くに記載しています。",
        "contents": "本人情報、住所、基礎年金番号、雇用保険被保険者番号、マイナンバー。",
        "format": "入力欄・赤字の記入例付き／全2ページ",
        "download": "従業員本人情報シート_入力用・記入例.pdf",
        "preview": "assets/previews/onboarding-personal-sample.webp",
        "preview_alt": "従業員本人情報シートの赤字の架空記入例",
        "preview_caption": "赤字の架空記入例",
    },
    {
        "file": "bank.pdf",
        "title": "給与口座振込同意書",
        "role": "口座振込を希望する従業員が記入",
        "use": "給与の口座振込に同意し、本人名義の振込先を指定する書類です。",
        "contents": "銀行・支店、口座の種類・番号・名義、振込対象、開始希望時期、本人の同意。",
        "format": "入力欄・赤字の記入例付き／全2ページ",
        "download": "給与口座振込同意書_入力用・記入例.pdf",
        "preview": "assets/previews/onboarding-bank-sample.webp",
        "preview_alt": "給与口座振込同意書の赤字の架空記入例",
        "preview_caption": "赤字の架空記入例",
    },
    {
        "file": "commute.pdf",
        "title": "通勤経路・通勤手当申請書",
        "role": "会社から案内された従業員が記入",
        "use": "通勤経路の確認や、通勤手当の申請に使います。会社のルールに従ってご記入ください。",
        "contents": "通勤方法、利用区間・経由地、運賃・定期代、片道距離、所要時間。",
        "format": "入力欄・赤字の記入例付き／全2ページ",
        "download": "通勤経路・通勤手当申請書_入力用・記入例.pdf",
        "preview": "assets/previews/onboarding-commute-sample.webp",
        "preview_alt": "通勤経路・通勤手当申請書の赤字の架空記入例",
        "preview_caption": "赤字の架空記入例",
    },
    {
        "file": "emergency.pdf",
        "title": "緊急連絡先届",
        "role": "会社から案内された従業員が記入",
        "use": "緊急時の連絡先を会社へ届けます。住民票の住所と異なる現住所がある場合は、こちらへご記入ください。",
        "contents": "緊急連絡先の氏名・本人との関係・電話番号、住民票と異なる現住所。",
        "format": "入力欄・赤字の記入例付き／全2ページ",
        "download": "緊急連絡先届_入力用・記入例.pdf",
        "preview": "assets/previews/onboarding-emergency-sample.webp",
        "preview_alt": "緊急連絡先届の赤字の架空記入例",
        "preview_caption": "赤字の架空記入例",
    },
]
TAX_DECLARATION_URL = (
    "https://www.nta.go.jp/taxes/tetsuzuki/shinsei/annai/gensen/annai/1648_01.htm"
)
PROCEDURE_PDFS = [
    {
        "slug": "establishment",
        "title": "事業所基本情報シート",
        "context": "（初回・変更時）",
        "use": "初めてのご依頼・事業所情報が変わったときに、各手続きで共通して使う情報をご連絡ください。",
        "contents": "事業主・所在地、保険の事業所番号・加入先、通常の勤務条件・適用状況。",
    },
    {
        "slug": "onboarding",
        "title": "入社連絡票",
        "use": "従業員を採用し、社会保険・雇用保険の加入手続きを依頼するとき。",
        "contents": "本人の情報、入社日、勤務時間、給与見込・現物支給、扶養家族の有無。",
    },
    {
        "slug": "retirement",
        "title": "退職連絡票",
        "use": "従業員の退職に伴う資格喪失手続きを依頼するとき。離職票あり・なしの両方に使えます。",
        "contents": "退職日、最終出勤日、退職理由、離職票の希望、最終給与、本人・家族の資格確認書。",
    },
    {
        "slug": "leave",
        "title": "休職連絡票",
        "use": "会社の休職制度による休職開始・延長を連絡するとき。",
        "contents": "休職期間、休職中の給与、保険料の支払方法、会社の規程・本人への通知状況。",
    },
]
DEPENDENT_OFFICIAL = {
    "title": "健康保険被扶養者（異動）届・国民年金第3号被保険者関係届",
    "landing_url": "https://www.nenkin.go.jp/shinsei/kounen/tekiyo/hihokensha/20141224.html",
    "guidance_url": "https://www.nenkin.go.jp/shinsei/kounen/tekiyo/hihokensha/20141224.files/setumei.pdf",
    "links": [
        {
            "label": "届書（PDF） ↗",
            "url": "https://www.nenkin.go.jp/shinsei/kounen/tekiyo/hihokensha/20141224.files/01.pdf",
        },
        {
            "label": "届書（Excel） ↗",
            "url": "https://www.nenkin.go.jp/shinsei/kounen/tekiyo/hihokensha/20141224.files/02.xlsx",
        },
        {
            "label": "扶養追加の記入例（PDF） ↗",
            "url": "https://www.nenkin.go.jp/shinsei/kounen/tekiyo/hihokensha/20141224.files/kinyurei01.pdf",
        },
    ],
}

TITLE = "入社書類セット・手続き連絡票・社内書式｜みなの社会保険労務士事務所"
DESC = f"よく使う基本書式{len(COMMON_PREVIEWS)}点を用紙のプレビュー付きで掲載。労働条件通知書Excelと入力できる入社書類PDF、入社・退職・休職の手続き連絡票、社内書式{N_FORMS}本、扶養届の公式書式もご利用いただけます。登録不要。"

CAT_NOTE = {
    "01_入社": "内定から入社までに取り交わす書類",
    "02_勤怠・休暇": "日々の申請。承認欄つき",
    "03_身上変更": "住所・氏名・扶養・口座の変更",
    "04_休職・復職": "私傷病で休むときと戻るとき",
    "05_懲戒・注意": "注意→事実確認→弁明→処分の順で",
    "06_退職": "退職・解雇・定年後の再雇用",
    "07_産休_介護": "産前産後休業の届と介護短時間勤務の申出",
    "09_証明書": "本人の求めに応じて会社が発行",
    "10_労使協定・労働者代表": "36協定・就業規則の前提になる手続",
    "11_人事・賃金": "異動・昇給などの通知",
}
CAT_ORDER = [
    "01_入社",
    "02_勤怠・休暇",
    "03_身上変更",
    "04_休職・復職",
    "05_懲戒・注意",
    "06_退職",
    "07_産休_介護",
    "09_証明書",
    "10_労使協定・労働者代表",
    "11_人事・賃金",
]
# 場面から探す: (2文字のアイコン, 見出し, 一言, 書式番号)
SCENES = [
    (
        "採用",
        "人を採用する",
        "内定から入社日までに取り交わす",
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
            "D-52",
            "D-38",
        ],
    ),
    (
        "勤怠",
        "残業・休暇・欠勤",
        "日々の申請と承認",
        ["D-11", "D-12", "D-13", "D-14", "D-50"],
    ),
    (
        "変更",
        "住所・氏名・扶養・口座が変わった",
        "社会保険・税の手続の起点になる届",
        ["D-16", "D-07"],
    ),
    ("副業", "副業をしたいと言われた", "届出制にして労働時間を把握する", ["D-15"]),
    (
        "休職",
        "病気で長く休む・復帰する",
        "主治医の意見をもらって会社が判断",
        ["D-17", "D-18", "D-19", "D-20", "D-21"],
    ),
    ("育介", "出産・育児・介護", "産休の届と介護短時間勤務の申出", ["D-47", "D-30"]),
    (
        "懲戒",
        "問題行動があった",
        "注意→事実確認→弁明→処分の順に",
        ["D-22", "D-46", "D-44", "D-45", "D-23"],
    ),
    (
        "退職",
        "退職する・辞めてもらう",
        "合意退職と解雇で使う書類が違う",
        ["D-24", "D-25", "D-26", "D-27", "D-28", "D-51", "D-42", "D-43", "D-29"],
    ),
    (
        "定年",
        "定年を迎える人がいる",
        "継続雇用の希望確認と条件の通知",
        ["D-48", "D-49"],
    ),
    (
        "協定",
        "36協定・就業規則を出す",
        "労働者代表の選出から意見聴取まで",
        ["D-34", "D-35", "D-36", "D-37", "D-38", "D-40"],
    ),
    (
        "給与",
        "給与の支払い方を決める",
        "口座振込の同意と控除の協定",
        ["D-39", "D-40", "D-41"],
    ),
    ("証明", "証明書を求められた", "本人の請求に応じて会社が発行", ["D-33", "D-43"]),
]


def href(f):
    return f"shoshiki/{f['no']}.html"


def link_attrs(f):
    return f' href="{e(href(f))}"'


CSS = """
/* 社内書式：会社情報の設定・場面カード・分類表 */
.sh-set{background:var(--shiro);border:1px solid var(--line);border-radius:14px;padding:18px 20px 16px}
.sh-set .row{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px 16px}
.sh-set label{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--ink3);font-weight:700}
.sh-set input{font:inherit;font-size:14px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--shiro);color:var(--iwa);min-width:0}
.sh-set .btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.sh-set button{font:inherit;font-size:12.5px;font-weight:700;padding:7px 12px;border:1px solid var(--moegi-t);background:var(--shiro);color:var(--sugi);border-radius:8px;cursor:pointer}
.sh-set .hint{margin:10px 0 0;font-size:12px;line-height:1.9;color:var(--ink4)}
.sh-set .co-status{margin:10px 0 0;font-size:12px;color:#8A4116;line-height:1.8}
.sh-now{font-weight:700;color:var(--sugi)}
.qk{display:inline-flex;align-items:center;gap:7px;background:var(--shiro);border:1px solid var(--line);border-radius:999px;padding:6px 12px;font-size:12.5px;font-weight:600;color:var(--ink2);letter-spacing:.02em;text-decoration:none;transition:border-color .34s cubic-bezier(.22,.61,.36,1),transform .34s cubic-bezier(.22,.61,.36,1)}
.qk::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--moegi);flex-shrink:0}
.qk:hover{border-color:var(--moegi-t);transform:translateY(-2px);color:var(--sugi)}
.qk{max-width:100%}
.qk-label{min-width:0;overflow-wrap:break-word}
.qk-label:has(wbr){word-break:keep-all}
.sh-scenes{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:12px;align-items:start}
.sh-scene{min-width:0;background:var(--shiro);border:1px solid var(--line);border-radius:14px;padding:14px 16px 10px;display:flex;flex-direction:column;gap:10px}
.sh-scene-h{display:flex;align-items:center;gap:12px}
.sh-scene-h .kmono{width:44px;height:44px;font-size:14px;border-radius:10px}
.sh-scene-t{min-width:0;flex:1}
.sh-scene-t h3{margin:0;font-size:16.5px;letter-spacing:.02em;font-family:var(--disp);font-weight:800;color:var(--iwa);line-height:1.4}
.sh-scene-t p{margin:2px 0 0;font-size:12.5px;line-height:1.6;color:var(--ink3)}
.sh-cnt{font-family:var(--mono);font-size:11px;font-weight:600;color:var(--sugi);background:var(--moegi-l);padding:3px 9px;border-radius:999px;line-height:1.4;letter-spacing:.06em;white-space:nowrap;align-self:flex-start}
.sh-scene-l{display:flex;flex-wrap:wrap;gap:8px 6px;padding-top:10px;padding-bottom:4px;border-top:1px dashed var(--line2)}
@media(max-width:760px){.qk{font-size:13px;padding:8px 14px}}
.sh-cat{margin-top:22px}
.sh-cat h3{margin:0 0 2px;font-size:15.5px;font-family:var(--disp);font-weight:800;color:var(--iwa)}
.sh-cat .note{margin:0 0 8px;font-size:12.5px;color:var(--ink4)}
.sh-tblwrap{overflow-x:auto}
.sh-tbl{width:100%;min-width:560px;border-collapse:collapse;background:var(--shiro);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.sh-tbl th,.sh-tbl td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line2);vertical-align:top;font-size:13.5px;line-height:1.7}
.sh-tbl th{font-family:var(--mono);font-size:10.5px;color:var(--ink4);font-weight:400;letter-spacing:.08em;background:var(--kinu,#F7F8F3)}
.sh-tbl tr:last-child td{border-bottom:none}
.sh-tbl td.no{font-family:var(--mono);font-size:11.5px;color:var(--ink4);white-space:nowrap}
.sh-tbl td.nm{width:180px;min-width:180px;text-wrap:wrap}
.sh-tbl td.nm a{color:var(--sugi);font-weight:700;text-decoration:none}
.sh-tbl td.nm a:hover{text-decoration:underline}
.sh-tbl td.use{color:var(--ink3)}
.sh-tbl td.go{white-space:nowrap}
.sh-tbl td.go a{font-family:var(--mono);font-size:12px;color:var(--moegi-t);text-decoration:none;font-weight:600}
.sh-about p{font-size:13px;line-height:1.95;color:var(--ink3);margin:0 0 6px}
.sh-pdfs{display:grid;gap:12px}
.sh-pdf{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px 24px;align-items:center;background:var(--shiro);border:1px solid var(--line);border-radius:14px;padding:18px 20px}
.sh-pdf h3{margin:0 0 6px;font-family:var(--disp);font-size:18px;line-height:1.5;color:var(--iwa)}
.sh-pdf p{margin:0;font-size:14px;line-height:1.85;color:var(--ink3)}
.sh-pdf .sh-pdf-fields{margin-top:5px;font-size:13px;color:var(--ink4)}
.sh-kit-preview{max-width:260px;margin:14px 0 0}
.sh-kit-preview img{display:block;width:100%;height:auto;aspect-ratio:840/1189;border:1px solid var(--line);border-radius:3px;background:var(--shiro)}
.sh-kit-preview figcaption{margin-top:6px;font-size:12px;line-height:1.7;color:var(--ink4)}
.sh-preview-link{display:block;color:var(--sugi);text-decoration:none}
.sh-preview-link:focus-visible{outline:2px solid var(--sugi);outline-offset:4px;border-radius:3px}
.sh-pdf-action{display:flex;flex-direction:column;align-items:center;gap:6px}
.sh-pdf-action small{font-size:12px;color:var(--ink4)}
.sh-pdf .qk{min-height:44px;border-color:var(--moegi-t);color:var(--sugi)}
.sh-pdf .qk:focus-visible{outline:2px solid var(--sugi);outline-offset:4px}
.sh-pdf-guide{margin:18px 0 0;padding-left:1.5em;font-size:14px;line-height:1.9;color:var(--ink3)}
.sh-pdf-note{margin:10px 0 0;font-size:13px;line-height:1.9;color:var(--ink3)}
.sh-pdf-official .sh-pdf-action{align-items:flex-start}
.sh-pdf-official .sh-pdf-action .qk{font-size:13px}
@media(max-width:600px){.sh-pdf{grid-template-columns:minmax(0,1fr);padding:16px}.sh-pdf-action{align-items:flex-start}}
.sh-jump{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 28px;padding:16px;background:var(--moegi-l);border-radius:14px}
.sh-jump .qk{min-height:44px}
.sh-common-group{margin-top:28px}
.sh-common-group>h3{margin:0 0 12px;font-family:var(--disp);font-size:20px;line-height:1.5;color:var(--iwa)}
.sh-common-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}
.sh-common-card{display:flex;flex-direction:column;min-width:0;padding:18px;background:var(--shiro);border:1px solid var(--line);border-radius:14px}
.sh-common-card h4{margin:0 0 10px;font-family:var(--disp);font-size:17px;line-height:1.6;color:var(--iwa);overflow-wrap:break-word}
.sh-common-no{margin:0 0 4px;font-family:var(--mono);font-size:11px;color:var(--ink4)}
.sh-common-preview{width:100%;max-width:260px;margin:0 auto 12px}
.sh-common-preview img{display:block;width:100%;height:auto;aspect-ratio:840/1189;border:1px solid var(--line);border-radius:3px;background:var(--shiro)}
.sh-common-preview figcaption{margin-top:6px;font-size:12px;line-height:1.7;color:var(--ink4)}
.sh-common-use{margin:0 0 14px;font-size:13px;line-height:1.85;color:var(--ink3)}
.sh-common-card>.qk{align-self:flex-start;margin-top:auto;min-height:44px;border-color:var(--moegi-t);color:var(--sugi)}
.sh-common-card>.qk:focus-visible,.sh-jump .qk:focus-visible{outline:2px solid var(--sugi);outline-offset:4px}
@media(max-width:900px){.sh-common-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:600px){.sh-common-grid{grid-template-columns:minmax(0,1fr)}.sh-common-card{padding:16px}.sh-jump{padding:12px}}
"""


def scene_label(title):
    """長い書式名は意味の区切りで折り返す。"""
    return e(title).replace("に関する", "に関する<wbr>")


def scene_block():
    out = ['<div class="sh-scenes">']
    for icon, name, lead, nos in SCENES:
        fs = [BY_NO[n] for n in nos if n in BY_NO]
        links = "".join(
            f'<a class="qk"{link_attrs(f)}><span class="qk-label">{scene_label(f["title"])}</span></a>'
            for f in fs
        )
        out.append(
            '<div class="sh-scene">'
            f'<div class="sh-scene-h"><span class="kmono" aria-hidden="true">{e(icon)}</span>'
            f'<div class="sh-scene-t"><h3>{e(name)}</h3><p>{e(lead)}</p></div>'
            f'<span class="sh-cnt">{len(fs)}本</span></div>'
            f'<div class="sh-scene-l">{links}</div></div>'
        )
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
            f'<div class="sh-cat"><h3>{e(cat.split("_", 1)[1].replace("_", "・"))}</h3><p class="note">{e(CAT_NOTE.get(cat, ""))}</p>'
        )
        out.append(
            '<div class="sh-tblwrap"><table class="sh-tbl"><thead><tr><th>番号</th><th>書式</th><th>用途</th><th></th></tr></thead><tbody>'
        )
        for f in fs:
            go = "記入する →"
            out.append(
                f'<tr><td class="no">{e(f["no"])}</td><td class="nm"><a{link_attrs(f)}>{e(f["title"])}</a></td>'
                f'<td class="use">{e(f["guide"]["use"])}</td><td class="go"><a{link_attrs(f)}>{go}</a></td></tr>'
            )
        out.append("</tbody></table></div></div>")
    return "".join(out)


def preview_block(form, pdf_href=None):
    """実際のPDF・通知書の見本を表示し、PDFは全ページを別タブで開く。"""
    image = (
        f'<img src="{e(form["preview"])}" width="840" height="1189" loading="lazy" decoding="async" '
        f'alt="{e(form["preview_alt"])}">'
    )
    caption = e(form["preview_caption"])
    if pdf_href:
        image = (
            f'<a class="sh-preview-link" href="{e(pdf_href)}" target="_blank" rel="noopener noreferrer" '
            f'aria-label="{e(form["title"])}のPDF全2ページを表示（別タブ）">{image}</a>'
        )
        caption += "（クリックで全2ページを見る ↗）"
    return (
        f'<figure class="sh-kit-preview">{image}'
        f"<figcaption>{caption}</figcaption></figure>"
    )


def procedure_pdf_block():
    rows = []
    for form in PROCEDURE_PDFS:
        title = e(form["title"])
        context = (
            f'<wbr><span class="nw">{e(form["context"])}</span>'
            if form.get("context")
            else ""
        )
        href = f"assets/download/procedure-{form['slug']}.pdf"
        preview = preview_block(
            {
                **form,
                "preview": f"assets/previews/procedure-{form['slug']}-sample.webp",
                "preview_alt": f"{form['title']}の赤字の架空記入例",
                "preview_caption": "赤字の架空記入例",
            },
            href,
        )
        rows.append(
            f'<article class="sh-pdf" data-procedure-file="{e(form["slug"])}">'
            f"<div><h3>{title}{context}</h3><p>{e(form['use'])}</p>"
            f'<p class="sh-pdf-fields"><b>主な記入内容：</b>{e(form["contents"])}</p>{preview}</div>'
            '<div class="sh-pdf-action">'
            f'<a class="qk" href="{e(href)}" download="{title}_入力用・記入例.pdf" '
            f'aria-label="{title}をダウンロード（入力欄・記入例付きPDF、全2ページ）">PDFをダウンロード ↓</a>'
            "<small>入力欄・記入例付き／全2ページ</small></div></article>"
        )
    return '<div class="sh-pdfs">' + "".join(rows) + "</div>"


def onboarding_kit_block():
    rows = []
    for form in ONBOARDING_KIT:
        title = e(form["title"])
        is_excel = form["file"].endswith(".xlsx")
        label = "Excelをダウンロード ↓" if is_excel else "PDFをダウンロード ↓"
        file_type = (
            'type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" '
            if is_excel
            else ""
        )
        preview = preview_block(
            form,
            None if is_excel else f"assets/download/onboarding-kit/{form['file']}",
        )
        rows.append(
            f'<article class="sh-pdf" data-kit-file="{e(form["file"])}">'
            f"<div><h3>{title}</h3><p><b>{e(form['role'])}：</b>{e(form['use'])}</p>"
            f'<p class="sh-pdf-fields"><b>主な記入内容：</b>{e(form["contents"])}</p>{preview}</div>'
            '<div class="sh-pdf-action">'
            f'<a class="qk" href="assets/download/onboarding-kit/{e(form["file"])}" '
            f'download="{e(form["download"])}" '
            f"{file_type}"
            f'aria-label="{title}をダウンロード（{e(form["format"])}）">{label}</a>'
            f"<small>{e(form['format'])}</small></div></article>"
        )
    return '<div class="sh-pdfs">' + "".join(rows) + "</div>"


def dependent_official_block():
    links = "".join(
        f'<a class="qk" href="{e(link["url"])}" target="_blank" rel="noopener noreferrer">{e(link["label"])}</a>'
        for link in DEPENDENT_OFFICIAL["links"]
    )
    return (
        '<article class="sh-pdf sh-pdf-official">'
        "<div><h3>健康保険の扶養届</h3>"
        f"<p>{e(DEPENDENT_OFFICIAL['title'])}</p>"
        '<p class="sh-pdf-fields">会社を通じて日本年金機構へ提出します。配偶者が国民年金第3号の対象となる場合は、同時に届け出ます。</p></div>'
        f'<div class="sh-pdf-action">{links}'
        "<small>日本年金機構の公式サイトを開きます</small></div></article>"
    )


def common_forms_block():
    """よく使うHTML書式を、実際の未記入用紙のプレビューと並べる。"""
    groups = []
    for index, category in enumerate(COMMON_CATEGORIES, start=1):
        cards = []
        for form in COMMON_PREVIEWS:
            if form["category"] != category:
                continue
            title = e(form["title"])
            form_href = e(href(form))
            cards.append(
                f'<article class="sh-common-card" data-common-form="{e(form["no"])}">'
                f'<p class="sh-common-no">{e(form["no"])}</p><h4>{title}</h4>'
                '<figure class="sh-common-preview">'
                f'<a class="sh-preview-link" href="{form_href}" '
                f'aria-label="{title}のHTMLを開いて記入・印刷">'
                f'<img src="{e(form["preview"])}" width="840" height="1189" loading="lazy" '
                f'decoding="async" alt="{title}の入力前の用紙（1ページ目）"></a>'
                "<figcaption>入力前の用紙（1ページ目）</figcaption></figure>"
                f'<p class="sh-common-use">{e(form["use"])}</p>'
                f'<a class="qk" href="{form_href}" aria-label="{title}のHTMLを開いて記入・印刷">'
                "HTMLを開いて記入・印刷 →</a></article>"
            )
        groups.append(
            f'<div class="sh-common-group" aria-labelledby="common-group-{index}">'
            f'<h3 id="common-group-{index}">{e(category)}</h3>'
            '<div class="sh-common-grid">' + "".join(cards) + "</div></div>"
        )
    return "".join(groups)


def main_html():
    set_panel = (
        '<div class="sh-set" id="cfg-wrap"><div class="row">'
        '<label>会社名<input id="co-name" placeholder="株式会社○○"></label>'
        '<label>代表者の役職<input id="co-title" placeholder="代表取締役"></label>'
        '<label>代表者氏名<input id="co-rep" placeholder="○○ ○○"></label>'
        '<label>所在地<input id="co-addr" placeholder="富山市○○1-2-3"></label>'
        '<label>電話<input id="co-tel" placeholder="076-000-0000"></label>'
        '<label>担当部署・担当者<input id="co-dept" placeholder="総務部 ○○"></label>'
        '</div><div class="btns"><button type="button" onclick="coExport()">設定をファイルに書き出す</button>'
        '<button type="button" onclick="document.getElementById(\'co-file\').click()">設定ファイルを読み込む</button>'
        '<input type="file" id="co-file" accept=".json" style="display:none" onchange="coImport(this)">'
        '<button type="button" onclick="coClear()">消去</button></div>'
        '<p id="co-status" class="co-status" role="status" hidden></p>'
        '<p class="hint">いま設定されている会社名：<span class="co-name sh-now">【会社名】</span>。入力した内容はこのブラウザの中にだけ保存され、当事務所には送信されません。各書式を開くと宛名・発信者欄に自動で入ります。別のPCで使うときは「書き出す」で保存したファイルを読み込んでください。</p></div>'
    )
    return f"""<main id="main" class="content">

  <nav class="sh-jump" aria-label="書式の種類から移動">
    <a class="qk" href="#common-forms">よく使う基本書式 {len(COMMON_PREVIEWS)}点</a>
    <a class="qk" href="#onboarding-kit">入社書類セット</a>
    <a class="qk" href="#procedure-pdfs">手続き連絡票PDF</a>
    <a class="qk" href="#dependent-forms">扶養の公式書式</a>
    <a class="qk" href="#list">社内書式 {N_FORMS}点の一覧</a>
  </nav>

  <section class="cat" id="common-forms" aria-labelledby="common-forms-title">
    <div class="cat-head">
      <div class="cat-icon kmono" aria-hidden="true">基本</div>
      <h2 class="cat-title" id="common-forms-title">よく使う基本書式</h2>
    </div>
    <p class="cat-desc">入社、勤務・休暇、休職・退職、証明など、日常の労務管理で使う{len(COMMON_PREVIEWS)}点を並べました。用紙の画像をクリックすると、ブラウザで記入・印刷できるHTML書式を開きます。</p>
    <p class="sh-pdf-note">プレビューは入力前の1ページ目です。全文と入力欄は各書式を開いてご確認ください。会社情報をまとめて入れる場合は、<a href="#setting">会社情報の設定</a>をご利用ください。その他の書式は<a href="#list">社内書式{N_FORMS}点の一覧</a>から探せます。</p>
    {common_forms_block()}
  </section>

  <section class="cat rv" id="onboarding-kit" aria-labelledby="onboarding-kit-title">
    <div class="cat-head">
      <div class="cat-icon kmono" aria-hidden="true">入社</div>
      <h2 class="cat-title" id="onboarding-kit-title">入社時に渡す・集める書類セット</h2>
    </div>
    <p class="cat-desc">会社が作成する労働条件通知書と、従業員が記入する4つの書式をまとめました。準備ガイドで、必要な書類と提出先・期限を案内できます。</p>
    <article class="sh-pdf" data-kit-file="onboarding-kit.zip">
      <div><h3>8点をまとめてダウンロード</h3><p>準備ガイド、労働条件通知書、従業員が記入する4書式に、会社から当事務所へ送る入社連絡票・事業所基本情報シートを同梱しています。会社で必要なものを選んで、従業員へお渡しください。</p></div>
      <div class="sh-pdf-action"><a class="qk" href="assets/download/onboarding-kit.zip" download="入社書類セット.zip" aria-label="入社書類セット8点をまとめてダウンロード（PDF7点・Excel1点のZIP）">一式をダウンロード ↓</a><small>PDF7点・Excel1点／ZIP・約40MB</small></div>
    </article>
    <ol class="sh-pdf-guide" aria-label="入社書類を準備する4つの手順">
      <li><strong>会社：</strong>雇用条件を決め、労働条件通知書を作成して本人へ交付します。</li>
      <li><strong>会社：</strong>準備ガイドに提出先・提出期限を入力し、本人が記入する書式と一緒に渡します。</li>
      <li><strong>従業員：</strong>2ページ目の赤字の記入例を参考に、1ページ目へ入力・保存し、必要な資料と会社へ返送します。</li>
      <li><strong>会社：</strong>従業員の回答と労働条件を照合し、社会保険・雇用保険の加入手続きを進めます。当事務所へのご依頼は、下の<a href="#procedure-pdfs">入社連絡票</a>をご利用ください。</li>
    </ol>
    <p class="sh-pdf-note">従業員用PDFは各2ページで、入力欄と赤字の記入例をセットにしています。住所は郵便番号・都道府県・市区町村・町名番地・建物名などに分けて入力できます。番号や口座を確認する資料と、条件に応じて必要な提出書類は準備ガイドをご覧ください。</p>
    {onboarding_kit_block()}
    <article class="sh-pdf sh-pdf-official">
      <div><h3>税の扶養控除等申告書</h3><p>扶養家族がいない方も、主な給与の支払先へ提出する書類です。給与の支給年に合う国税庁の公式様式を選び、会社の給与担当者へ提出してください。</p><p class="sh-pdf-fields">健康保険の扶養届とは別の書類です。健康保険の扶養を申請する方は、下の<a href="#dependent-forms">扶養の公式書式</a>もご確認ください。</p></div>
      <div class="sh-pdf-action"><a class="qk" href="{e(TAX_DECLARATION_URL)}" target="_blank" rel="noopener noreferrer">支給年の公式書式を選ぶ ↗</a><small>国税庁／入力用PDF・記載例</small></div>
    </article>
  </section>

  <section class="cat rv" id="procedure-pdfs" aria-labelledby="procedure-pdfs-title">
    <div class="cat-head">
      <div class="cat-icon kmono" aria-hidden="true">連絡</div>
      <h2 class="cat-title" id="procedure-pdfs-title">当事務所への手続き連絡票</h2>
    </div>
    <p class="cat-desc">事業所情報と入社・退職・休職の情報を会社からご連絡いただく、入力できるPDFです。入力欄は1ページ目、赤字の架空の記入例は2ページ目。住所は郵便番号・都道府県・市区町村などに分けて入力できます。</p>
    <p class="sh-pdf-note">退職届・休職届・年次有給休暇申請書など、会社と従業員の間で使う書式は、<a href="#common-forms">よく使う基本書式のプレビュー</a>から開けます。</p>
    {procedure_pdf_block()}
    <ol class="sh-pdf-guide">
      <li>必要な連絡票をダウンロードします。初回・事業所情報の変更時は、基本情報シートもご用意ください。PDFに入力できるアプリで開きます。</li>
      <li>2ページ目の赤字の記入例を参考に、1ページ目の枠をクリックして入力します。番号の欄には、確認する資料の案内を添えています。</li>
      <li>入力後に保存し、開き直して内容を確認のうえ、ご依頼の担当者へお送りください。</li>
    </ol>
    <p class="sh-pdf-note">申請内容に応じて必要な賃金台帳・勤怠台帳等は、各PDFの下部に記載しています。休職連絡票は産前産後・育児・介護休業の連絡や、傷病手当金の申請書とは別の書式です。手続きの依頼は、<a href="uploads/service-shakai-hoken.html">社会保険・労働保険の手続き代行</a>をご覧ください。</p>
  </section>

  <section class="cat rv" id="dependent-forms" aria-labelledby="dependent-forms-title">
    <div class="cat-head">
      <div class="cat-icon kmono" aria-hidden="true">扶養</div>
      <h2 class="cat-title" id="dependent-forms-title">扶養を追加・変更するときの公式書式</h2>
    </div>
    <p class="cat-desc">会社で協会けんぽに加入中の従業員が、ご家族を健康保険の扶養に追加するときの公式書式です。届書と扶養追加の記入例をこちらから確認できます。</p>
    {dependent_official_block()}
    <p class="sh-pdf-note">必要な添付資料はご家族の状況により異なります。<a href="{e(DEPENDENT_OFFICIAL["guidance_url"])}" target="_blank" rel="noopener noreferrer">添付資料・記入方法の説明（PDF）</a>をご確認ください。扶養の削除・変更の記入例は、<a href="{e(DEPENDENT_OFFICIAL["landing_url"])}" target="_blank" rel="noopener noreferrer">日本年金機構の公式案内</a>に掲載されています。新入社員の扶養も当事務所へ依頼する場合は、入社連絡票の扶養欄に状況をご記入ください。</p>
  </section>

  <section class="cat rv" id="setting">
    <div class="cat-head">
      <div class="cat-icon kmono" aria-hidden="true">社名</div>
      <h2 class="cat-title">社内書式用の会社情報を入れる</h2>
    </div>
    <p class="cat-desc">以下のHTML書式を使う場合は、最初に一度だけ入力してください。社内書式の宛名・発信者欄に入ります。上のPDFには自動入力されません。</p>
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
    <p class="cat-desc">ブラウザで記入・印刷できる書式{N_FORMS}本。用途の欄に、その書式が要る理由を一行で書いています。</p>
    {cat_blocks()}
  </section>

  <section class="cat rv sh-about" id="about">
    <div class="cat-head">
      <div class="cat-icon kmono" aria-hidden="true">注</div>
      <h2 class="cat-title">この書式集について</h2>
    </div>
    <p>書式は一般的な内容で、法令は{e(AS_OF[:7].replace("-", "年"))}月時点の理解に基づいて作っています。法令に反しない範囲で、自社の就業規則・労使協定と実情に合わせて修正してください。解雇・懲戒・労使協定など、書式だけでは判断できない場面は、使う前に専門家にご確認ください。</p>
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
    # nav: 書式・窓口のactiveを外す（このページはナビ項目ではない）
    s = s.replace(
        '<li><a href="portal.html" class="active" aria-current="page">書式・窓口</a></li>',
        '<li><a href="portal.html">書式・窓口</a></li>',
    )
    s = s.replace(
        '<a href="portal.html" onclick="closeNav()" aria-current="page">書式・窓口</a>',
        '<a href="portal.html" onclick="closeNav()">書式・窓口</a>',
    )
    # portal.html 先頭の入口カード（社内書式／公式窓口の2択）はこのページには不要。CSSも fs-portal ごと差し替わるので必ず外す
    s = re.sub(
        r'\n  <!-- 入口：社内書式か公式窓口かを選ぶ -->\n  <section class="hub".*?</section>\n',
        "\n",
        s,
        count=1,
        flags=re.S,
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
        r'<h1 class="page-h(?: [^"]*)?">.*?</h1>',
        '<h1 class="page-h">会社で使う<br><strong>社内書式のひな形</strong></h1>',
        s,
        count=1,
        flags=re.S,
    )
    s = re.sub(
        r'<p class="page-sub">.*?</p>',
        f'<p class="page-sub">よく使う基本書式{len(COMMON_PREVIEWS)}点を、用紙のプレビュー付きで掲載しています。労働条件通知書Excel・入社書類セット・手続き連絡票PDFと、ブラウザで記入・印刷できる社内書式{N_FORMS}本もご利用いただけます。登録は不要です。</p>',
        s,
        count=1,
        flags=re.S,
    )
    s = re.sub(
        r"<b>ご利用にあたって</b>.*?</div>\s*</div>\s*</header>",
        "<b>ご利用にあたって</b>書式は一般的な内容です。法令に反しない範囲で、自社の就業規則・労使協定と実情に合わせて修正してください。HTML書式用に入力した会社情報はブラウザ内にだけ保存され、当事務所には送信されません。\n    </div>\n  </div>\n</header>",
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
    # 書式の相談サービスは掲載しない。donor の窓口向けCTAも引き継がない。
    s = re.sub(
        r"<!-- BOTTOM CTA -->.*?(?=<!-- FOOTER -->)",
        "",
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


def build_dl_page():
    """旧配布URLから来た利用者をHTML版へ案内する。申込・Office配布は行わない。"""
    return f"""<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>社内書式のHTML版をご利用ください</title>
<style>
body{{margin:0;padding:32px 20px 80px;font-family:"Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic",Meiryo,sans-serif;font-size:14.5px;line-height:1.85;color:#1E2721;background:#F9FAF7}}
.wrap{{max-width:680px;margin:0 auto}}
h1{{font-size:22px;margin:0 0 8px;letter-spacing:.03em}}
.lede{{color:#4A554D;margin:0 0 20px}}
.dl{{display:inline-block;padding:14px 26px;background:#1C5842;color:#fff;border-radius:999px;text-decoration:none;font-weight:700;font-size:16px}}
.dl:hover{{background:#2E9E63}}
.meta{{font-size:12.5px;color:#78837B;margin:8px 0 26px}}
h2{{font-size:15px;margin:26px 0 6px}}
ol,ul{{padding-left:1.4em;margin:0}} li{{margin:2px 0}}
details{{margin-top:8px}} summary{{cursor:pointer;color:#1C5842;font-weight:700}}
.list li{{font-size:13px;color:#4A554D}}
.foot{{margin-top:36px;padding-top:14px;border-top:1px solid #DCE3DB;font-size:12.5px;color:#4A554D}}
a{{color:#1C5842}}
</style></head><body><main class="wrap">
<h1>社内書式はブラウザでご利用いただけます</h1>
<p class="lede">Word・Excelファイルの配布は終了しました。現在は、ブラウザで記入・印刷できるHTML書式{N_FORMS}本を公開しています。登録は不要です。</p>
<a class="dl" href="../../../shoshiki.html">社内書式の一覧を開く →</a>
<h2>使い方</h2>
<ol>
<li>一覧ページで会社情報を入力します。各書式の宛名・発信者欄に自動で入ります。</li>
<li>必要な書式を開き、ブラウザ上で記入します。</li>
<li>書式ページの「印刷」ボタンから印刷またはPDFに保存します。</li>
</ol>
<h2>利用条件</h2>
<ul>
<li>自社内での利用と改変は自由です。第三者への再配布・販売はご遠慮ください。</li>
<li>法令は作成時点の理解に基づく一般的な内容です。法令に反しない範囲で、自社の就業規則・労使協定と実情に合わせて修正してください。解雇・懲戒・労使協定などは、使う前に専門家にご確認ください。</li>
</ul>
<p class="foot">作成・提供：みなの社会保険労務士事務所（富山市）</p>
</main></body></html>
"""


def mark_phrases(text):
    """文節の切れ目に <wbr> を置く（scripts/lib/phrase-breaks.mjs と同じ関数を通す）。
    一覧ページだけに使う。書式ページ shoshiki/ は sync-phrase-breaks の SKIP_DIRS で対象外にしてある。"""
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
    office_files = sorted(
        p.relative_to(REPO).as_posix()
        for p in (REPO / "shoshiki").rglob("*")
        if p.suffix.lower() in {".xlsx", ".xls", ".docx", ".doc", ".zip"}
    )
    if office_files:
        print(
            "社内書式の公開対象はHTML版のみです。Office配布ファイルを公開ディレクトリに置かないでください。"
        )
        for name in office_files:
            print("-", name)
        sys.exit(1)
    outputs = {
        REPO / PAGE: mark_phrases(build_index()),
        REPO / DL_PATH / "index.html": build_dl_page(),
    }
    for f in FORMS:
        if f.get("kind") == "xlsx":
            continue
        # 書式ページは印刷用の独立CSS（.t が nowrap）なので文節印は入れない
        outputs[REPO / "shoshiki" / f"{f['no']}.html"] = build_form(f)
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
