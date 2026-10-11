"""骰子 44×44（代码画骰身和数字，能量/心/爪面贴 2.5 的 32×32 图标）。
python dice.py <energy.png> <heart.png> <claw.png> <输出目录>
"""
import pathlib, sys
from PIL import Image
from drawlib import C, rrect, draw_digit

S = 44
SIDE = 4  # 底部厚度


def body(kind):
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    if kind == "w":
        top, hi, lo, side = C["ivory"], C["ivory_l"], C["ivory_d"], C["ivory_side"]
    else:
        top, hi, lo, side = C["green"], C["green_l"], C["green_d"], C["green_side"]
    rrect(im, 0, 0, S, S, 7, side, outline=C["ink"])              # 整块（底部露出的是侧面）
    rrect(im, 1, 1, S - 2, S - 2 - SIDE, 6, top, hi=hi, lo=lo)    # 顶面
    return im


def face(kind, f, icons):
    im = body(kind)
    fx, fy, fw, fh = 1, 1, S - 2, S - 2 - SIDE
    if f in ("1", "2", "3"):
        col = C["ink"] if kind == "w" else C["ivory_l"]
        out = None if kind == "w" else C["ink"]
        shadow = C["ivory_d"] if kind == "w" else None
        scale = 2
        gw, gh = 6 * scale, 10 * scale
        draw_digit(im, f, fx + (fw - gw) // 2, fy + (fh - gh) // 2, scale, col, outline=out, shadow=shadow)
    elif f != "blank":
        ic = icons[f].convert("RGBA")
        bb = ic.getbbox()
        ic = ic.crop(bb)
        im.alpha_composite(ic, (fx + (fw - ic.width) // 2, fy + (fh - ic.height) // 2))
    return im


FACES = ["1", "2", "3", "energy", "heart", "claw", "blank"]

if __name__ == "__main__":
    e, h, c, out = sys.argv[1:5]
    icons = {"energy": Image.open(e), "heart": Image.open(h), "claw": Image.open(c)}
    out = pathlib.Path(out); out.mkdir(parents=True, exist_ok=True)
    sheet = Image.new("RGBA", (len(FACES) * 48 + 4, 2 * 48 + 4), (58, 58, 124, 255))
    for r, kind in enumerate("wg"):
        for i, f in enumerate(FACES):
            im = face(kind, f, icons)
            im.save(out / f"{kind}-{f}.png")
            sheet.alpha_composite(im, (4 + i * 48, 4 + r * 48))
    sheet.resize((sheet.width * 3, sheet.height * 3), Image.NEAREST).save(out.parent / f"{out.name}-preview.png")
    print("ok", out)
