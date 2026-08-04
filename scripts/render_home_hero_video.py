#!/usr/bin/env python3
"""みなの社労士HPのトップ用15秒イラスト動画を生成する。"""

from __future__ import annotations

import argparse
import math
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


FPS = 24
DURATION_SECONDS = 15
FRAME_COUNT = FPS * DURATION_SECONDS

INK = "#17211D"
GREEN = "#123F30"
GREEN_LIGHT = "#DDE9E1"
BLUE = "#BFD7E5"
YELLOW = "#F4D36B"
PAPER = "#F8F5EE"
WHITE = "#FFFFFF"


@dataclass(frozen=True)
class Layout:
    width: int
    height: int
    art_box: tuple[int, int, int, int]
    mobile: bool = False


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="minano-sr-hp のルート",
    )
    parser.add_argument(
        "--skip-video",
        action="store_true",
        help="ポスターだけを再生成する",
    )
    return parser.parse_args()


def smoothstep(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def remove_white_background(source: Image.Image) -> Image.Image:
    """白背景を透過し、既存の黒線と限定色を保つ。"""
    rgb = np.asarray(source.convert("RGB"), dtype=np.float32)
    distance = np.sqrt(np.sum((255 - rgb) ** 2, axis=2))
    alpha = np.clip((distance - 2.0) * (255.0 / 28.0), 0, 255).astype(np.uint8)
    rgba = np.dstack((rgb.astype(np.uint8), alpha))
    result = Image.fromarray(rgba, "RGBA")
    bbox = result.getbbox()
    return result.crop(bbox) if bbox else result


def load_art(repo: Path) -> list[Image.Image]:
    sources = [
        repo / "assets/illustrations/17_admin_work_female.webp",
        repo / "assets/illustrations/hero-story/workflow-organizing.webp",
        repo / "assets/illustrations/hero-story/consult-documents.webp",
    ]
    missing = [str(path) for path in sources if not path.is_file()]
    if missing:
        raise FileNotFoundError(f"素材が見つかりません: {', '.join(missing)}")
    return [remove_white_background(Image.open(path)) for path in sources]


def scale_to_fit(
    image: Image.Image, box: tuple[int, int, int, int], zoom: float
) -> Image.Image:
    box_width = box[2] - box[0]
    box_height = box[3] - box[1]
    ratio = min(box_width / image.width, box_height / image.height) * zoom
    size = (max(1, round(image.width * ratio)), max(1, round(image.height * ratio)))
    return image.resize(size, Image.Resampling.LANCZOS)


def draw_ridge(draw: ImageDraw.ImageDraw, layout: Layout, phase: float) -> None:
    """稜線ブランドに合わせた薄い背景線を描く。"""
    width, height = layout.width, layout.height
    base_y = int(height * (0.34 if layout.mobile else 0.69))
    amplitude = height * (0.026 if layout.mobile else 0.042)
    points: list[tuple[int, int]] = []
    for x in range(-20, width + 30, 18):
        y = base_y
        y += amplitude * math.sin((x / width) * math.tau * 1.15 + phase)
        y += amplitude * 0.42 * math.sin((x / width) * math.tau * 3.1 - phase * 0.7)
        points.append((x, int(y)))
    line_width = max(2, round(min(width, height) / 420))
    draw.line(points, fill="#D5E1DA", width=line_width)


def draw_background(layout: Layout, t: float) -> Image.Image:
    canvas = Image.new("RGB", (layout.width, layout.height), PAPER)
    draw = ImageDraw.Draw(canvas)
    draw_ridge(draw, layout, 0.12 * math.sin(t * math.tau / DURATION_SECONDS))

    if layout.mobile:
        draw.ellipse(
            (
                layout.width * 0.08,
                layout.height * 0.68,
                layout.width * 0.94,
                layout.height * 1.04,
            ),
            fill="#F2E6B9",
        )
    else:
        draw.ellipse(
            (
                layout.width * 0.64,
                layout.height * 0.08,
                layout.width * 1.08,
                layout.height * 0.94,
            ),
            fill="#F2E6B9",
        )
    return canvas


def paste_centered(
    layer: Image.Image,
    art: Image.Image,
    box: tuple[int, int, int, int],
    zoom: float,
    offset_x: float,
    offset_y: float,
) -> None:
    resized = scale_to_fit(art, box, zoom)
    center_x = (box[0] + box[2]) / 2 + offset_x
    center_y = (box[1] + box[3]) / 2 + offset_y
    position = (
        round(center_x - resized.width / 2),
        round(center_y - resized.height / 2),
    )
    layer.alpha_composite(resized, position)


def draw_card(
    draw: ImageDraw.ImageDraw,
    xy: tuple[float, float],
    size: tuple[float, float],
    accent: str,
    check: bool = False,
) -> None:
    x, y = xy
    width, height = size
    stroke = max(3, round(min(width, height) * 0.075))
    radius = max(5, round(height * 0.14))
    draw.rounded_rectangle(
        (x, y, x + width, y + height),
        radius=radius,
        fill=WHITE,
        outline=INK,
        width=stroke,
    )
    draw.rectangle(
        (x + stroke, y + stroke, x + width * 0.22, y + height - stroke),
        fill=accent,
    )
    line_width = max(2, stroke - 1)
    draw.line(
        (x + width * 0.32, y + height * 0.36, x + width * 0.82, y + height * 0.36),
        fill=INK,
        width=line_width,
    )
    draw.line(
        (x + width * 0.32, y + height * 0.64, x + width * 0.72, y + height * 0.64),
        fill=INK,
        width=line_width,
    )
    if check:
        draw.line(
            (
                x + width * 0.70,
                y + height * 0.55,
                x + width * 0.78,
                y + height * 0.68,
                x + width * 0.93,
                y + height * 0.39,
            ),
            fill=GREEN,
            width=stroke,
            joint="curve",
        )


def draw_clock(
    draw: ImageDraw.ImageDraw, center: tuple[float, float], radius: float, phase: float
) -> None:
    x, y = center
    stroke = max(3, round(radius * 0.12))
    draw.ellipse(
        (x - radius, y - radius, x + radius, y + radius),
        fill=WHITE,
        outline=INK,
        width=stroke,
    )
    angle = -math.pi / 2 + phase
    draw.line(
        (
            x,
            y,
            x + math.cos(angle) * radius * 0.57,
            y + math.sin(angle) * radius * 0.57,
        ),
        fill=INK,
        width=stroke,
    )
    draw.line((x, y, x + radius * 0.36, y + radius * 0.12), fill=INK, width=stroke)


def draw_check_badge(
    draw: ImageDraw.ImageDraw, center: tuple[float, float], radius: float, pulse: float
) -> None:
    x, y = center
    scale = 1.0 + pulse * 0.08
    radius *= scale
    stroke = max(3, round(radius * 0.11))
    draw.ellipse(
        (x - radius, y - radius, x + radius, y + radius),
        fill=GREEN,
        outline=INK,
        width=stroke,
    )
    draw.line(
        (
            x - radius * 0.46,
            y,
            x - radius * 0.12,
            y + radius * 0.34,
            x + radius * 0.52,
            y - radius * 0.38,
        ),
        fill=WHITE,
        width=stroke,
        joint="curve",
    )


def render_problem_scene(layout: Layout, art: Image.Image, t: float) -> Image.Image:
    layer = Image.new("RGBA", (layout.width, layout.height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    box = layout.art_box
    unit = min(layout.width / 1280, layout.height / 720)
    bob = math.sin(t * 1.7) * 4 * unit
    paste_centered(layer, art, box, 1.02, 10 * unit, bob)

    if layout.mobile:
        card_positions = [(70, 960), (500, 980), (80, 1160)]
        clock = (585, 1200, 54)
    else:
        card_positions = [(790, 130), (1090, 105), (1100, 510)]
        clock = (800, 545, 50)
    for index, (x, y) in enumerate(card_positions):
        float_y = math.sin(t * 2.0 + index * 1.7) * 8 * unit
        draw_card(
            draw,
            (
                x * layout.width / (720 if layout.mobile else 1280),
                y * layout.height / (1280 if layout.mobile else 720) + float_y,
            ),
            (126 * unit, 76 * unit),
            [YELLOW, BLUE, GREEN_LIGHT][index],
        )
    clock_x = clock[0] * layout.width / (720 if layout.mobile else 1280)
    clock_y = clock[1] * layout.height / (1280 if layout.mobile else 720)
    draw_clock(draw, (clock_x, clock_y), clock[2] * unit, t * 0.85)
    return layer


def render_workflow_scene(layout: Layout, art: Image.Image, t: float) -> Image.Image:
    layer = Image.new("RGBA", (layout.width, layout.height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    box = layout.art_box
    unit = min(layout.width / 1280, layout.height / 720)
    drift = math.sin(t * 1.2) * 5 * unit
    paste_centered(layer, art, box, 1.04, drift, 0)

    if layout.mobile:
        positions = [(65, 950), (480, 930), (500, 1160)]
        connector = [(140, 1020), (530, 1005), (565, 1170)]
    else:
        positions = [(780, 110), (1080, 140), (1110, 515)]
        connector = [(850, 175), (1135, 205), (1175, 535)]
    normalized_width = 720 if layout.mobile else 1280
    normalized_height = 1280 if layout.mobile else 720
    points = [
        (x * layout.width / normalized_width, y * layout.height / normalized_height)
        for x, y in connector
    ]
    line_width = max(3, round(5 * unit))
    draw.line(points, fill=GREEN, width=line_width, joint="curve")
    progress = smoothstep(min(1.0, max(0.0, (t % 2.4) / 1.5)))
    for index, (x, y) in enumerate(positions):
        float_y = math.sin(t * 1.6 + index) * 5 * unit
        draw_card(
            draw,
            (
                x * layout.width / normalized_width,
                y * layout.height / normalized_height + float_y,
            ),
            (132 * unit, 78 * unit),
            [GREEN_LIGHT, BLUE, YELLOW][index],
            check=progress > 0.25 + index * 0.22,
        )
    return layer


def render_consult_scene(layout: Layout, art: Image.Image, t: float) -> Image.Image:
    layer = Image.new("RGBA", (layout.width, layout.height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    box = layout.art_box
    unit = min(layout.width / 1280, layout.height / 720)
    settle = math.sin(t * 1.35) * 3 * unit
    paste_centered(layer, art, box, 1.05, 4 * unit, settle)

    normalized_width = 720 if layout.mobile else 1280
    normalized_height = 1280 if layout.mobile else 720
    if layout.mobile:
        badge = (565, 950, 70)
        cards = [(70, 1100), (500, 1180)]
    else:
        badge = (1140, 145, 63)
        cards = [(790, 485), (1100, 505)]
    pulse = (math.sin(t * 2.5) + 1.0) / 2.0
    draw_check_badge(
        draw,
        (
            badge[0] * layout.width / normalized_width,
            badge[1] * layout.height / normalized_height,
        ),
        badge[2] * unit,
        pulse,
    )
    for index, (x, y) in enumerate(cards):
        draw_card(
            draw,
            (
                x * layout.width / normalized_width,
                y * layout.height / normalized_height
                + math.sin(t * 1.8 + index) * 5 * unit,
            ),
            (138 * unit, 82 * unit),
            [BLUE, YELLOW][index],
            check=True,
        )
    return layer


def scene_mix(t: float) -> tuple[int, int | None, float, float, float]:
    """場面番号、次場面、混合率、各場面のローカル時刻を返す。"""
    if t < 4.4:
        return 0, None, 0.0, t, 0.0
    if t < 5.4:
        progress = smoothstep((t - 4.4) / 1.0)
        return 0, 1, progress, t, t - 5.0
    if t < 9.2:
        return 1, None, 0.0, t - 5.0, 0.0
    if t < 10.2:
        progress = smoothstep((t - 9.2) / 1.0)
        return 1, 2, progress, t - 5.0, t - 10.0
    if t < 14.0:
        return 2, None, 0.0, t - 10.0, 0.0
    progress = smoothstep((t - 14.0) / 1.0)
    return 2, 0, progress, t - 10.0, t - 15.0


def scale_alpha(channel: Image.Image, opacity: float) -> Image.Image:
    lookup = [round(value * opacity) for value in range(256)]
    return channel.point(lookup)


def render_frame(layout: Layout, art: list[Image.Image], t: float) -> Image.Image:
    background = draw_background(layout, t).convert("RGBA")
    renderers = [render_problem_scene, render_workflow_scene, render_consult_scene]
    current, following, progress, current_t, following_t = scene_mix(t)
    current_layer = renderers[current](layout, art[current], current_t)
    if following is None:
        background.alpha_composite(current_layer)
    else:
        next_layer = renderers[following](layout, art[following], following_t)
        current_opacity = 1.0 - smoothstep(progress / 0.65)
        next_opacity = smoothstep((progress - 0.35) / 0.65)
        current_alpha = scale_alpha(current_layer.getchannel("A"), current_opacity)
        next_alpha = scale_alpha(next_layer.getchannel("A"), next_opacity)
        current_layer.putalpha(current_alpha)
        next_layer.putalpha(next_alpha)
        background.alpha_composite(current_layer)
        background.alpha_composite(next_layer)
    return background.convert("RGB")


def run_ffmpeg(layout: Layout, art: list[Image.Image], output_base: Path) -> None:
    output_base.parent.mkdir(parents=True, exist_ok=True)
    mp4_path = output_base.with_suffix(".mp4")
    webm_path = output_base.with_suffix(".webm")
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "warning",
        "-y",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-s",
        f"{layout.width}x{layout.height}",
        "-r",
        str(FPS),
        "-i",
        "pipe:0",
        "-an",
        "-map",
        "0:v:0",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "24",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        str(mp4_path),
        "-map",
        "0:v:0",
        "-c:v",
        "libvpx-vp9",
        "-crf",
        "34",
        "-b:v",
        "0",
        "-deadline",
        "good",
        "-cpu-used",
        "4",
        "-row-mt",
        "1",
        "-pix_fmt",
        "yuv420p",
        str(webm_path),
    ]
    process = subprocess.Popen(command, stdin=subprocess.PIPE)
    if process.stdin is None:
        raise RuntimeError("ffmpeg の標準入力を開けませんでした")
    try:
        for frame_number in range(FRAME_COUNT):
            t = frame_number / FPS
            process.stdin.write(render_frame(layout, art, t).tobytes())
    finally:
        process.stdin.close()
    return_code = process.wait()
    if return_code != 0:
        raise subprocess.CalledProcessError(return_code, command)


def save_posters(
    layout: Layout, art: list[Image.Image], output_dir: Path, name: str
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    poster = render_frame(layout, art, 1.2)
    widths = (720, 480) if layout.mobile else (1280, 800)
    for width in widths:
        height = round(layout.height * width / layout.width)
        resized = poster.resize((width, height), Image.Resampling.LANCZOS)
        resized.save(output_dir / f"{name}-{width}.webp", "WEBP", quality=82, method=6)
        resized.save(output_dir / f"{name}-{width}.avif", "AVIF", quality=53, speed=6)


def main() -> None:
    args = parse_args()
    repo = args.repo.resolve()
    art = load_art(repo)
    layouts = {
        "desktop": Layout(1280, 720, (760, 55, 1360, 690)),
        "mobile": Layout(720, 1280, (100, 970, 620, 1270), mobile=True),
    }
    poster_dir = repo / "assets/photos/home-labor-story"
    for name, layout in layouts.items():
        save_posters(layout, art, poster_dir, f"home-labor-story-{name}")
        if not args.skip_video:
            run_ffmpeg(layout, art, repo / "assets/video" / f"home-labor-story-{name}")


if __name__ == "__main__":
    main()
