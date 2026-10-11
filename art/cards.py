"""卡框（代码画）：96×136，插图窗 (6,6,84,60) 透明，费用徽章 (2,2,24,24)，名字条 (5,69,86,15)，效果区 (5,86,86,44)。
python cards.py frames     → out/frames/ 三种样式 × KEEP/DISCARD 候选 + 合成预览
"""
import pathlib, sys
from PIL import Image, ImageDraw
from drawlib import C, rrect, hx

ART = pathlib.Path(__file__).parent
W, H = 96, 136
ART_BOX = (6, 6, 84, 60)
COST_C = (14, 14)

# 类型角标 10×10（K=小图钉，D=小闪电）
PIN = ["...####...", "..#oooo#..", "..#oooo#..", "...#oo#...", "..######..", ".#oooooo#.", "..######..", "....##....", "....##....", ".....#...."]
BOLT = ["....####..", "...#oo#...", "..#oo#....", ".#oooo###.", ".####oo#..", "....#o#...", "...#o#....", "..#o#.....", "..##......", ".#........"]


def glyph(im, rows, x, y, fill):
    px = im.load()
    for j, row in enumerate(rows):
        for i, c in enumerate(row):
            if c == "#":
                px[x + i, y + j] = C["ink"]
            elif c == "o":
                px[x + i, y + j] = fill


def frame(kind, style=1):
    band, band_l, band_d = (C["mint"], C["mint_l"], C["mint_d"]) if kind == "K" else (C["coral"], C["coral_l"], C["coral_d"])
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    rrect(im, 0, 0, W, H, 5, band, outline=C["ink"], hi=band_l, lo=band_d)
    d = ImageDraw.Draw(im)
    if style == 2:  # 边框上一圈小铆钉
        for x in range(10, W - 6, 8):
            for y in (2, H - 3):
                d.point((x, y), fill=band_l)
        for y in range(12, H - 6, 8):
            for x in (2, W - 3):
                d.point((x, y), fill=band_l)
    if style == 3:  # 边框斜纹（糖果条纹）
        for y in range(1, H - 1):
            for x in range(1, W - 1):
                if (x + y) % 8 < 3 and im.getpixel((x, y)) == band:
                    im.putpixel((x, y), band_l[:3] + (255,))
    # 插图窗：外面 1px 深描边，里面透明
    x, y, w, h = ART_BOX
    d.rectangle((x - 1, y - 1, x + w, y + h), outline=C["ink"])
    d.rectangle((x, y, x + w - 1, y + h - 1), fill=(0, 0, 0, 0))
    # 名字条
    rrect(im, 5, 69, 86, 15, 2, C["cream"], outline=C["ink"], lo=C["parch2"])
    # 效果区
    rrect(im, 5, 86, 86, 44, 2, C["parch"], outline=C["ink"], lo=C["parch2"])
    # 费用徽章（中间留空给数字）
    r = 11
    cx, cy = COST_C
    for yy in range(cy - r - 1, cy + r + 2):
        for xx in range(cx - r - 1, cx + r + 2):
            dd = (xx - cx + 0.5) ** 2 + (yy - cy + 0.5) ** 2
            if dd <= (r + 1) ** 2:
                im.putpixel((xx, yy), C["ink"])
            if dd <= r ** 2:
                im.putpixel((xx, yy), C["en"])
            if (r - 1.6) ** 2 < dd <= r ** 2:
                ang_tl = (xx - cx) + (yy - cy) < -2
                ang_br = (xx - cx) + (yy - cy) > 2
                if ang_tl:
                    im.putpixel((xx, yy), C["en_l"])
                elif ang_br:
                    im.putpixel((xx, yy), C["en_d"])
    # 类型角标
    if kind == "K":
        glyph(im, PIN, 81, 122, band_l)
    else:
        glyph(im, BOLT, 81, 122, C["gold"])
    return im


def compose(fr, art):
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    a = art.convert("RGBA")
    im.alpha_composite(a, ART_BOX[:2])
    im.alpha_composite(fr)
    return im


if __name__ == "__main__":
    out = ART / "out" / "frames"; out.mkdir(parents=True, exist_ok=True)
    sample = sorted((ART / "out" / "r1").glob("card-*.png"))[:1]
    art = Image.open(sample[0]) if sample else Image.new("RGBA", (84, 60), hx("#9fd6e8"))
    sheet = Image.new("RGBA", (6 * (W + 8) + 8, H + 16), hx("#3a3a7c"))
    i = 0
    for style in (1, 2, 3):
        for kind in "KD":
            fr = frame(kind, style)
            fr.save(out / f"frame-{kind}-v{style}.png")
            sheet.alpha_composite(compose(fr, art), (8 + i * (W + 8), 8)); i += 1
    sheet.resize((sheet.width * 3, sheet.height * 3), Image.NEAREST).save(out / "frames-preview.png")
    print("ok")
