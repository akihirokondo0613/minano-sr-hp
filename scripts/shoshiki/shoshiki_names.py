# 配布物のファイル名（build_shoshiki.py と build_zip.py の両方が使う）。
# ここは標準ライブラリしか使わない。CI の preflight は build_shoshiki.py --check を python3 で回すが、
# runner には openpyxl / python-docx が無いので、build_shoshiki.py から build_zip.py（openpyxl 依存）を import してはいけない。
import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent.parent
AS_OF = json.loads(
    (REPO / "data" / "shoshiki" / "forms.json").read_text(encoding="utf-8")
)["meta"]["as_of"]
VER = AS_OF[:7].replace("-", "")  # 例 202609
ZIP_NAME = f"shanai-shoshiki-word-{VER}.zip"
XLSX_FILES = {  # 番号 → サイトに置く ASCII 名（表示名は forms.json の title）
    "D-31": "D-31_shukkinbo.xlsx",
    "D-32": "D-32_nenkyu-kanribo.xlsx",
}
