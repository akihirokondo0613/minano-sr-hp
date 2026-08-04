#!/usr/bin/env python3
"""VOICEVOXで15秒CMのナレーションを再生成する。

事前にローカルのVOICEVOX Engineを起動してから実行する。
既定話者は、個人・法人を問わず商用利用できる冥鳴ひまり（style id 14）。
公開時は「VOICEVOX:冥鳴ひまり」のクレジットを必ず併記する。
"""

from __future__ import annotations

import json
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


ENGINE_URL = "http://127.0.0.1:50021"
SPEAKER_ID = 14
OUTPUT_DIR = Path(__file__).resolve().parents[1] / "public" / "minano" / "audio"
LINES = (
    ("vo-01-services.mp3", "手続き、給与計算、就業規則。"),
    ("vo-02-question.mp3", "その労務、積んでませんか？"),
    ("vo-03-support.mp3", "みなの社労士が、整理して支えます。"),
    ("vo-04-brand.mp3", "複雑な労務を、シンプルに。"),
    ("vo-05-cta.mp3", "まずは、ご相談ください。"),
)


def post_json(path: str, payload: dict | None = None) -> bytes:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        f"{ENGINE_URL}{path}",
        data=data,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.read()
    except urllib.error.URLError as error:
        raise RuntimeError(
            "VOICEVOX Engineへ接続できません。127.0.0.1:50021で起動してください。"
        ) from error


def audio_query(text: str) -> dict:
    encoded = urllib.parse.quote(text, safe="")
    raw = post_json(f"/audio_query?text={encoded}&speaker={SPEAKER_ID}")
    query = json.loads(raw)
    query.update(
        {
            "speedScale": 1.12,
            "pitchScale": -0.02,
            "intonationScale": 0.96,
            "volumeScale": 1.0,
            "prePhonemeLength": 0.08,
            "postPhonemeLength": 0.1,
            "outputSamplingRate": 48_000,
            "outputStereo": True,
        }
    )
    return query


def synthesize(text: str, destination: Path) -> None:
    query = audio_query(text)
    wav = post_json(f"/synthesis?speaker={SPEAKER_ID}", query)
    with tempfile.NamedTemporaryFile(suffix=".wav") as temporary:
        temporary.write(wav)
        temporary.flush()
        subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                temporary.name,
                "-af",
                "loudnorm=I=-18:TP=-3:LRA=7",
                "-codec:a",
                "libmp3lame",
                "-b:a",
                "128k",
                str(destination),
            ],
            check=True,
        )


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for filename, text in LINES:
        destination = OUTPUT_DIR / filename
        synthesize(text, destination)
        print(f"生成: {destination.name} — {text}")


if __name__ == "__main__":
    main()
