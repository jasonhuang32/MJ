"""Build clean layered v2 artwork from sample/sample_better.mp4 reference frames.

This is a deterministic local reconstruction: it does not call an image API.
The supplied video has a light neutral background, so saturated character
colours and dark outlines can be isolated without retaining the page UI that
polluted the v1 assets.
"""

from __future__ import annotations

from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
REFERENCE_DIR = ROOT / "design" / "references"
OUTPUT_DIR = ROOT / "extension" / "assets-v2"
PREVIEW_DIR = ROOT / "design" / "previews"
CANVAS_SIZE = 2048


ASSETS = {
    "head-character": {
        "file": "head-reference.png",
        "crop": (145, 165, 570, 680),
        "max_size": (1740, 1900),
        "eye_boxes": ((35, 130, 225, 370), (195, 130, 405, 370)),
        "face_ellipse": (43, 128, 382, 463),
    },
    "body-character": {
        "file": "body-reference.png",
        "crop": (90, 175, 565, 690),
        "max_size": (1700, 1840),
        "eye_boxes": ((35, 75, 245, 325), (195, 80, 380, 325)),
    },
}

BODY_POSES = tuple(
    REFERENCE_DIR / "body-poses" / f"pose-{index}.png" for index in range(1, 6)
)

# Inset circles for the round mask in each source frame. Keeping the exact
# source pixels inside the mask preserves both white lenses and their black
# rims, even where a lens is connected to the light video background after
# compression.
BODY_FACE_ELLIPSES = (
    (390, -112, 674, 166),
    (100, 274, 365, 516),
    (154, 314, 418, 568),
    (178, 252, 466, 522),
    (85, 115, 350, 374),
)


def largest_component(mask: np.ndarray) -> np.ndarray:
    """Keep the character while discarding detached hearts and video marks."""
    height, width = mask.shape
    visited = np.zeros_like(mask, dtype=bool)
    largest: list[tuple[int, int]] = []

    for start_y, start_x in zip(*np.nonzero(mask & ~visited)):
        if visited[start_y, start_x]:
            continue
        queue: deque[tuple[int, int]] = deque([(int(start_y), int(start_x))])
        visited[start_y, start_x] = True
        component: list[tuple[int, int]] = []
        while queue:
            y, x = queue.popleft()
            component.append((y, x))
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if (
                    0 <= ny < height
                    and 0 <= nx < width
                    and mask[ny, nx]
                    and not visited[ny, nx]
                ):
                    visited[ny, nx] = True
                    queue.append((ny, nx))
        if len(component) > len(largest):
            largest = component

    result = np.zeros_like(mask, dtype=bool)
    if largest:
        ys, xs = zip(*largest)
        result[np.asarray(ys), np.asarray(xs)] = True
    return result


def fill_holes(mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    height, width = mask.shape
    outside = np.zeros_like(mask, dtype=bool)
    queue: deque[tuple[int, int]] = deque()

    for x in range(width):
        for y in (0, height - 1):
            if not mask[y, x] and not outside[y, x]:
                outside[y, x] = True
                queue.append((y, x))
    for y in range(height):
        for x in (0, width - 1):
            if not mask[y, x] and not outside[y, x]:
                outside[y, x] = True
                queue.append((y, x))

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
    return mask | holes, holes


def enclosed_bright_regions(
    pixels: np.ndarray, boxes: tuple[tuple[int, int, int, int], ...]
) -> np.ndarray:
    height, width, _ = pixels.shape
    maximum = pixels.max(axis=2)
    minimum = pixels.min(axis=2)
    luminance = (
        pixels[..., 0] * 0.2126
        + pixels[..., 1] * 0.7152
        + pixels[..., 2] * 0.0722
    )
    bright = (luminance > 160) & ((maximum - minimum) < 30)
    restored = np.zeros((height, width), dtype=bool)

    for left, top, right, bottom in boxes:
        left, top = max(0, left), max(0, top)
        right, bottom = min(width, right), min(height, bottom)
        region = bright[top:bottom, left:right]
        region_height, region_width = region.shape
        outside = np.zeros_like(region, dtype=bool)
        queue: deque[tuple[int, int]] = deque()

        for x in range(region_width):
            for y in (0, region_height - 1):
                if region[y, x] and not outside[y, x]:
                    outside[y, x] = True
                    queue.append((y, x))
        for y in range(region_height):
            for x in (0, region_width - 1):
                if region[y, x] and not outside[y, x]:
                    outside[y, x] = True
                    queue.append((y, x))

        while queue:
            y, x = queue.popleft()
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if (
                    0 <= ny < region_height
                    and 0 <= nx < region_width
                    and region[ny, nx]
                    and not outside[ny, nx]
                ):
                    outside[ny, nx] = True
                    queue.append((ny, nx))

        enclosed = region & ~outside
        restored[top:bottom, left:right] |= enclosed

    return restored


def isolate_character(
    source: Image.Image,
    crop: tuple[int, int, int, int],
    eye_boxes: tuple[tuple[int, int, int, int], ...] = (),
    face_ellipse: tuple[int, int, int, int] | None = None,
    keep_largest: bool = False,
) -> Image.Image:
    image = source.convert("RGB").crop(crop)
    pixels = np.asarray(image, dtype=np.float32)
    maximum = pixels.max(axis=2)
    minimum = pixels.min(axis=2)
    saturation = maximum - minimum
    luminance = (
        pixels[..., 0] * 0.2126
        + pixels[..., 1] * 0.7152
        + pixels[..., 2] * 0.0722
    )

    # Saturated red/blue is the character core. Growing only a short distance
    # from that core retains its black outlines while dropping the long thin
    # suspension line and the neutral background.
    colour_core = (saturation > 34) & (maximum > 72)
    core_image = Image.fromarray(colour_core.astype(np.uint8) * 255)
    support = np.asarray(core_image.filter(ImageFilter.MaxFilter(31))) > 0
    dark_outline = luminance < 145
    coloured_edge = saturation > 15
    initial = support & (dark_outline | coloured_edge)

    if keep_largest:
        initial = largest_component(initial)

    closed = Image.fromarray(initial.astype(np.uint8) * 255)
    closed = closed.filter(ImageFilter.MaxFilter(17)).filter(ImageFilter.MinFilter(17))
    solid, holes = fill_holes(np.asarray(closed) > 0)

    # Build a soft two-pixel matte at the original resolution before 2K
    # enlargement. This avoids both jagged edges and the old coloured halo.
    matte = Image.fromarray(solid.astype(np.uint8) * 255).filter(
        ImageFilter.GaussianBlur(0.65)
    )
    alpha = np.asarray(matte, dtype=np.uint8).copy()
    alpha[holes] = 255

    if face_ellipse:
        # Preserve the exact source pixels across the whole mask interior. The
        # eyes and their black rims therefore remain registered to the mask,
        # instead of being reconstructed as independent white shapes.
        face_mask = Image.new("L", image.size)
        ImageDraw.Draw(face_mask).ellipse(face_ellipse, fill=255)
        alpha = np.maximum(alpha, np.asarray(face_mask, dtype=np.uint8))
    else:
        if eye_boxes:
            alpha[enclosed_bright_regions(pixels, eye_boxes)] = 255

    rgba = np.dstack((pixels.astype(np.uint8), alpha))
    cutout = Image.fromarray(rgba, "RGBA")
    bounds = cutout.getchannel("A").getbbox()
    if not bounds:
        raise RuntimeError("No character pixels detected")
    return cutout.crop(bounds)


def fit_to_canvas(image: Image.Image, max_size: tuple[int, int]) -> Image.Image:
    scale = min(max_size[0] / image.width, max_size[1] / image.height)
    resized = image.resize(
        (round(image.width * scale), round(image.height * scale)),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE))
    canvas.alpha_composite(
        resized,
        ((CANVAS_SIZE - resized.width) // 2, (CANVAS_SIZE - resized.height) // 2),
    )
    return canvas


def composite_preview(image: Image.Image, output: Path) -> None:
    background = Image.new("RGBA", image.size, (28, 34, 52, 255))
    background.alpha_composite(image)
    background.convert("RGB").resize((640, 640), Image.Resampling.LANCZOS).save(
        output, quality=94
    )


def write_heart_svg() -> None:
    svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 236">
  <defs>
    <linearGradient id="heartFill" x1="0.28" y1="0.04" x2="0.68" y2="0.95">
      <stop offset="0" stop-color="#ffb9dc"/>
      <stop offset="0.34" stop-color="#ff72b4"/>
      <stop offset="0.72" stop-color="#f5368c"/>
      <stop offset="1" stop-color="#d91667"/>
    </linearGradient>
    <radialGradient id="shine" cx="0.32" cy="0.2" r="0.48">
      <stop offset="0" stop-color="#fff" stop-opacity="0.82"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <path d="M128 220C105 198 26 142 18 82 11 32 49 8 84 17c22 6 36 22 44 39 8-17 22-33 44-39 35-9 73 15 66 65-8 60-87 116-110 138Z" fill="url(#heartFill)" stroke="#3a152d" stroke-width="9" stroke-linejoin="round"/>
  <path d="M46 72c4-27 24-39 43-34 13 3 22 13 28 25-25-11-48-7-71 9Z" fill="url(#shine)"/>
</svg>
"""
    (OUTPUT_DIR / "heart.svg").write_text(svg, encoding="utf-8")


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

    for name, config in ASSETS.items():
        reference = Image.open(REFERENCE_DIR / config["file"])
        isolated = isolate_character(
            reference,
            config["crop"],
            config["eye_boxes"],
            face_ellipse=config.get("face_ellipse"),
        )
        result = fit_to_canvas(isolated, config["max_size"])
        output = OUTPUT_DIR / f"{name}.png"
        result.save(output, optimize=True)
        composite_preview(result, PREVIEW_DIR / f"{name}.jpg")
        print(f"{output.relative_to(ROOT)}: {output.stat().st_size:,} bytes")

    for index, reference_path in enumerate(BODY_POSES, start=1):
        reference = Image.open(reference_path)
        isolated = isolate_character(
            reference,
            (0, 0, reference.width, reference.height),
            face_ellipse=BODY_FACE_ELLIPSES[index - 1],
            keep_largest=True,
        )
        result = fit_to_canvas(isolated, (1680, 1820))
        output = OUTPUT_DIR / f"body-pose-{index}.png"
        result.save(output, optimize=True)
        composite_preview(result, PREVIEW_DIR / f"body-pose-{index}.jpg")
        print(f"{output.relative_to(ROOT)}: {output.stat().st_size:,} bytes")

    write_heart_svg()
    print(f"{(OUTPUT_DIR / 'heart.svg').relative_to(ROOT)}")


if __name__ == "__main__":
    main()
