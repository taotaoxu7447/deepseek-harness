"""Render the app icon source: a deep-blue rounded square with a light whale
mark — approximating the DeepSeek brand without shipping trademarked art."""

import sys

from PIL import Image, ImageDraw

SIZE = 1024


def main() -> None:
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    radius = 230
    draw.rounded_rectangle(
        [32, 32, SIZE - 32, SIZE - 32],
        radius=radius,
        fill=(16, 42, 84, 255),
    )

    # Highlight arc for depth.
    draw.arc([140, 120, SIZE - 140, SIZE - 160], start=200, end=340, fill=(70, 120, 200, 160), width=36)

    # Stylized whale: body arc + tail + eye + waterline spout.
    cx, cy = SIZE // 2, 560
    draw.ellipse([cx - 300, cy - 150, cx + 240, cy + 190], fill=(240, 246, 252, 255))
    draw.polygon(
        [(cx + 170, cy - 60), (cx + 360, cy - 190), (cx + 330, cy + 40), (cx + 170, cy + 60)],
        fill=(240, 246, 252, 255),
    )
    draw.ellipse([cx - 190, cy - 60, cx - 130, cy], fill=(16, 42, 84, 255))
    # Belly shade.
    draw.chord([cx - 300, cy - 150, cx + 240, cy + 190], start=20, end=160, fill=(196, 214, 236, 255))
    # Spout.
    draw.rounded_rectangle([cx - 260, cy - 320, cx - 170, cy - 230], radius=45, fill=(240, 246, 252, 255))

    image.save(sys.argv[1] if len(sys.argv) > 1 else "icon-1024.png")


if __name__ == "__main__":
    main()
