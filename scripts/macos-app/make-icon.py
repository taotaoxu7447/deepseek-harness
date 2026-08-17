"""Render a light or dark macOS icon from the official whale mark."""

import argparse
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image, ImageDraw

SIZE = 1024
BACKGROUND_INSET = 32
BACKGROUND_RADIUS = 230
MARK_SIZE = 760
SOURCE_SVG = Path(__file__).resolve().parents[2] / "apps/web/public/favicon.svg"
APPEARANCE_COLORS = {
    "light": ((255, 255, 255, 255), (0, 0, 0, 255), (218, 218, 218, 255)),
    "dark": ((0, 0, 0, 255), (255, 255, 255, 255), (48, 48, 48, 255)),
}


def rasterize_mark(destination: Path) -> None:
    """Rasterize the official SVG with the macOS system image converter."""
    subprocess.run(
        [
            "/usr/bin/sips",
            "-s",
            "format",
            "png",
            "-z",
            str(MARK_SIZE),
            str(MARK_SIZE),
            str(SOURCE_SVG),
            "--out",
            str(destination),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", nargs="?", type=Path, default=Path("icon-1024.png"))
    parser.add_argument("--appearance", choices=APPEARANCE_COLORS, default="light")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    background, mark_color, outline = APPEARANCE_COLORS[args.appearance]
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        [BACKGROUND_INSET, BACKGROUND_INSET, SIZE - BACKGROUND_INSET, SIZE - BACKGROUND_INSET],
        radius=BACKGROUND_RADIUS,
        fill=background,
        outline=outline,
        width=2,
    )

    with TemporaryDirectory(prefix="dsh-macos-icon-") as temporary_directory:
        mark_path = Path(temporary_directory) / "official-whale.png"
        rasterize_mark(mark_path)
        with Image.open(mark_path) as mark_source:
            mark_alpha = mark_source.convert("RGBA").getchannel("A")
            mark = Image.new("RGBA", mark_source.size, mark_color)
            mark.putalpha(mark_alpha)
            offset = ((SIZE - MARK_SIZE) // 2, (SIZE - MARK_SIZE) // 2)
            image.alpha_composite(mark, offset)

    image.save(args.output)


if __name__ == "__main__":
    main()
