"""gen-icons.py — sinh icon launcher + splash cho ZGO POS (Pillow).

Chạy:  python scripts/gen-icons.py
Ra:    app/src/main/res/mipmap-*/ic_launcher.png, ic_launcher_round.png,
       ic_launcher_foreground.png, drawable-*/splash.png
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, "..", "app", "src", "main", "res")

BLUE = (37, 99, 235, 255)        # #2563EB
BLUE_DARK = (30, 64, 175, 255)   # #1E40AF
WHITE = (255, 255, 255, 255)

LEGACY = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
FOREGROUND = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}


def font(size):
    for name in ("seguisb.ttf", "segoeuib.ttf", "arialbd.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return ImageFont.load_default()


def draw_z(draw, size, text="Z", color=WHITE, offset=(0, 0), scale=0.62):
    f = font(int(size * scale))
    bbox = draw.textbbox((0, 0), text, font=f)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (size - w) / 2 - bbox[0] + offset[0]
    y = (size - h) / 2 - bbox[1] + offset[1]
    draw.text((x, y), text, font=f, fill=color)


def rounded_icon(size, radius_ratio=0.22):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(size * radius_ratio)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=BLUE)
    # dải sáng chéo nhẹ
    overlay = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.polygon([(0, size * 0.62), (size, size * 0.18), (size, size), (0, size)],
               fill=(255, 255, 255, 18))
    img = Image.alpha_composite(img, overlay)
    d = ImageDraw.Draw(img)
    draw_z(d, size)
    return img


def round_icon(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([0, 0, size - 1, size - 1], fill=BLUE)
    draw_z(d, size)
    return img


def foreground(size):
    """Adaptive icon foreground: nền trong suốt, chữ Z nằm trong safe zone 66%."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # vòng tròn mờ để icon có khối khi đặt trên nền xanh
    pad = int(size * 0.17)
    d.ellipse([pad, pad, size - pad, size - pad], fill=(255, 255, 255, 26))
    draw_z(d, size, scale=0.44)
    return img


def splash(w, h):
    img = Image.new("RGBA", (w, h), BLUE)
    d = ImageDraw.Draw(img)
    logo = rounded_icon(int(min(w, h) * 0.30), radius_ratio=0.24)
    img.alpha_composite(logo, ((w - logo.width) // 2, int(h * 0.34)))
    f = font(int(min(w, h) * 0.062))
    text = "ZGO POS"
    bbox = d.textbbox((0, 0), text, font=f)
    tw = bbox[2] - bbox[0]
    d.text(((w - tw) / 2 - bbox[0], int(h * 0.34) + logo.height + int(h * 0.035)),
           text, font=f, fill=WHITE)
    return img


def main():
    for density, px in LEGACY.items():
        out = os.path.join(RES, f"mipmap-{density}")
        os.makedirs(out, exist_ok=True)
        rounded_icon(px).save(os.path.join(out, "ic_launcher.png"))
        round_icon(px).save(os.path.join(out, "ic_launcher_round.png"))
        print("legacy", density, px)

    for density, px in FOREGROUND.items():
        out = os.path.join(RES, f"mipmap-{density}")
        os.makedirs(out, exist_ok=True)
        foreground(px).save(os.path.join(out, "ic_launcher_foreground.png"))
        print("foreground", density, px)

    # Splash cho các màn hình phổ biến (drawable-port-*)
    for density, (w, h) in {
        "mdpi": (320, 480), "hdpi": (480, 800),
        "xhdpi": (720, 1280), "xxhdpi": (1080, 1920),
    }.items():
        out = os.path.join(RES, f"drawable-{density}")
        os.makedirs(out, exist_ok=True)
        splash(w, h).save(os.path.join(out, "splash.png"))
        print("splash", density, w, h)

    print("DONE")


if __name__ == "__main__":
    main()
