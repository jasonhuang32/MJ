"""Build transparent MJ effect assets from the two user-provided sample videos.

The script deliberately keeps every intermediate under the repository's .work
directory and produces only browser-ready files under extension/assets.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
from collections import deque
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
SAMPLE_DIR = ROOT / "sample"
ASSET_DIR = ROOT / "extension" / "assets"
ICON_DIR = ROOT / "extension" / "icons"
WORK_DIR = ROOT / ".work" / "asset-build"


@dataclass(frozen=True)
class Variant:
    slug: str
    source: str
    background_at: float
    starts_at: float
    ends_at: float
    canvas_height: int = 480

    @property
    def duration_ms(self) -> int:
        return round((self.ends_at - self.starts_at) * 1000)


VARIANTS = (
    Variant(
        slug="head",
        source="455c91bac92e9529392dae1c040d961f.mp4",
        background_at=4.20,
        starts_at=4.27,
        ends_at=6.80,
    ),
    Variant(
        slug="body",
        source="6d74a0c7968496267fb90ee39e7b8975.mp4",
        background_at=2.30,
        starts_at=2.37,
        ends_at=5.40,
    ),
)


def run(command: list[str]) -> None:
    subprocess.run(command, check=True)


def extract_frame(ffmpeg: str, source: Path, at: float, output: Path) -> None:
    run(
        [
            ffmpeg,
            "-loglevel",
            "error",
            "-y",
            "-ss",
            f"{at:.3f}",
            "-i",
            str(source),
            "-frames:v",
            "1",
            "-update",
            "1",
            str(output),
        ]
    )


def extract_sequence(
    ffmpeg: str, source: Path, starts_at: float, ends_at: float, output: Path
) -> None:
    output.mkdir(parents=True, exist_ok=True)
    run(
        [
            ffmpeg,
            "-loglevel",
            "error",
            "-y",
            "-ss",
            f"{starts_at:.3f}",
            "-t",
            f"{ends_at - starts_at:.3f}",
            "-i",
            str(source),
            "-vf",
            "fps=30",
            str(output / "%04d.png"),
        ]
    )


def extract_audio(
    ffmpeg: str, source: Path, starts_at: float, ends_at: float, output: Path
) -> None:
    run(
        [
            ffmpeg,
            "-loglevel",
            "error",
            "-y",
            "-ss",
            f"{starts_at:.3f}",
            "-t",
            f"{ends_at - starts_at:.3f}",
            "-i",
            str(source),
            "-vn",
            "-c:a",
            "aac",
            "-b:a",
            "96k",
            str(output),
        ]
    )


def fill_enclosed_holes(mask: np.ndarray) -> np.ndarray:
    """Fill transparent islands enclosed by the detected sticker outline.

    This restores the white mask eyes even when they appeared over a white page.
    """

    height, width = mask.shape
    outside = np.zeros_like(mask, dtype=bool)
    queue: deque[tuple[int, int]] = deque()

    for x in range(width):
        if not mask[0, x]:
            outside[0, x] = True
            queue.append((0, x))
        if not mask[height - 1, x] and not outside[height - 1, x]:
            outside[height - 1, x] = True
            queue.append((height - 1, x))
    for y in range(height):
        if not mask[y, 0] and not outside[y, 0]:
            outside[y, 0] = True
            queue.append((y, 0))
        if not mask[y, width - 1] and not outside[y, width - 1]:
            outside[y, width - 1] = True
            queue.append((y, width - 1))

    while queue:
        y, x = queue.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if (
                0 <= ny < height
                and 0 <= nx < width
                and not mask[ny, nx]
                and not outside[ny, nx]
            ):
                outside[ny, nx] = True
                queue.append((ny, nx))

    holes = ~mask & ~outside
    return mask | holes


def keep_sticker_components(mask: np.ndarray, current: np.ndarray) -> np.ndarray:
    """Keep sizeable components containing the sticker's saturated colours.

    Compression makes stationary page text differ by a few pixels from the
    reference frame. The supplied stickers, by contrast, contain substantial
    red/blue/pink regions. Component filtering removes the page while retaining
    the character, heart and any web line attached to the character.
    """

    height, width = mask.shape
    visited = np.zeros_like(mask, dtype=bool)
    kept = np.zeros_like(mask, dtype=bool)
    red = current[..., 0]
    green = current[..., 1]
    blue = current[..., 2]
    colour_seed = (
        (red > 105)
        & ((red - green) > 28)
        & ((red - blue) > 15)
    ) | (
        (blue > 75)
        & ((blue - red) > 10)
        & ((blue - green) > 5)
    )

    for start_y in range(height):
        for start_x in range(width):
            if not mask[start_y, start_x] or visited[start_y, start_x]:
                continue
            queue: deque[tuple[int, int]] = deque([(start_y, start_x)])
            visited[start_y, start_x] = True
            component: list[tuple[int, int]] = []
            seed_count = 0

            while queue:
                y, x = queue.popleft()
                component.append((y, x))
                if colour_seed[y, x]:
                    seed_count += 1
                for ny, nx in (
                    (y - 1, x),
                    (y + 1, x),
                    (y, x - 1),
                    (y, x + 1),
                    (y - 1, x - 1),
                    (y - 1, x + 1),
                    (y + 1, x - 1),
                    (y + 1, x + 1),
                ):
                    if (
                        0 <= ny < height
                        and 0 <= nx < width
                        and mask[ny, nx]
                        and not visited[ny, nx]
                    ):
                        visited[ny, nx] = True
                        queue.append((ny, nx))

            if len(component) >= 260 and seed_count >= 24:
                ys, xs = zip(*component)
                kept[np.asarray(ys), np.asarray(xs)] = True

    return kept


def remove_background(frame: Image.Image, background: Image.Image) -> Image.Image:
    current = np.asarray(frame.convert("RGB"), dtype=np.float32)
    base = np.asarray(background.convert("RGB"), dtype=np.float32)
    difference = np.max(np.abs(current - base), axis=2)

    # A soft matte retains antialiased lines. A tiny morphological close joins
    # the black eye outlines before the enclosed white regions are restored.
    soft_alpha = np.clip((difference - 10.0) / 52.0, 0.0, 1.0)
    initial = Image.fromarray((difference > 19.0).astype(np.uint8) * 255)
    closed = initial.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    sticker = keep_sticker_components(np.asarray(closed) > 0, current)
    solid = fill_enclosed_holes(sticker)
    enclosed_holes = solid & ~sticker

    support = np.asarray(
        Image.fromarray(sticker.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(5))
    ) > 0
    alpha = np.maximum(soft_alpha * support, solid.astype(np.float32))
    alpha[alpha < 0.055] = 0.0

    # Reverse the normal alpha composite equation to recover edge colours.
    safe_alpha = np.maximum(alpha[..., None], 0.12)
    foreground = (current - (1.0 - alpha[..., None]) * base) / safe_alpha
    foreground = np.clip(foreground, 0, 255).astype(np.uint8)
    # The sample's large white mask eyes can sit over arbitrary page content.
    # Enclosed regions are part of the opaque sticker, so restore them to the
    # near-white used by the artwork instead of baking the chat UI into them.
    foreground[enclosed_holes] = (248, 248, 246)
    rgba = np.dstack((foreground, np.rint(alpha * 255).astype(np.uint8)))
    return Image.fromarray(rgba, "RGBA")


def save_apng(frames: list[Image.Image], output: Path) -> None:
    if not frames:
        raise RuntimeError("No animation frames were generated")
    output.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        output,
        format="PNG",
        save_all=True,
        append_images=frames[1:],
        duration=1000 / 30,
        loop=1,
        disposal=1,
        blend=0,
        optimize=True,
    )


def make_icons(frame: Image.Image) -> None:
    alpha = frame.getchannel("A")
    bounds = alpha.getbbox()
    if not bounds:
        raise RuntimeError("Selected icon frame is empty")
    sticker = frame.crop(bounds)
    ICON_DIR.mkdir(parents=True, exist_ok=True)

    for size in (16, 32, 48, 128):
        margin = max(1, round(size * 0.08))
        available = size - margin * 2
        scale = min(available / sticker.width, available / sticker.height)
        resized = sticker.resize(
            (max(1, round(sticker.width * scale)), max(1, round(sticker.height * scale))),
            Image.Resampling.LANCZOS,
        )
        canvas = Image.new("RGBA", (size, size))
        canvas.alpha_composite(
            resized, ((size - resized.width) // 2, (size - resized.height) // 2)
        )
        canvas.save(ICON_DIR / f"icon-{size}.png", optimize=True)


def process_variant(ffmpeg: str, variant: Variant) -> list[Image.Image]:
    source = SAMPLE_DIR / variant.source
    if not source.exists():
        raise FileNotFoundError(source)

    variant_work = WORK_DIR / variant.slug
    source_frames = variant_work / "source"
    background_path = variant_work / "background.png"
    variant_work.mkdir(parents=True, exist_ok=True)

    extract_frame(ffmpeg, source, variant.background_at, background_path)
    extract_sequence(ffmpeg, source, variant.starts_at, variant.ends_at, source_frames)
    extract_audio(
        ffmpeg,
        source,
        variant.starts_at,
        variant.ends_at,
        ASSET_DIR / f"{variant.slug}.m4a",
    )

    background = Image.open(background_path).crop(
        (0, 0, 576, variant.canvas_height)
    )
    frames: list[Image.Image] = []
    for path in sorted(source_frames.glob("*.png")):
        source_frame = Image.open(path).crop((0, 0, 576, variant.canvas_height))
        frames.append(remove_background(source_frame, background))

    save_apng(frames, ASSET_DIR / f"{variant.slug}.png")
    return frames


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ffmpeg", required=True, help="Absolute path to ffmpeg.exe")
    args = parser.parse_args()

    ffmpeg = str(Path(args.ffmpeg).resolve())
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    if WORK_DIR.exists():
        shutil.rmtree(WORK_DIR)
    WORK_DIR.mkdir(parents=True)

    built: dict[str, list[Image.Image]] = {}
    for variant in VARIANTS:
        built[variant.slug] = process_variant(ffmpeg, variant)

    # A clear, centered frame from the full-body animation becomes the toolbar
    # icon, ensuring the icon is sourced from exactly the same supplied sample.
    body_frames = built["body"]
    make_icons(body_frames[min(24, len(body_frames) - 1)])

    print("Built assets:")
    for path in sorted(ASSET_DIR.glob("*")):
        print(f"  {path.relative_to(ROOT)} ({path.stat().st_size:,} bytes)")
    for path in sorted(ICON_DIR.glob("*")):
        print(f"  {path.relative_to(ROOT)} ({path.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
