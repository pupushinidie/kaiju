"""特效横排精灵图（一次性播放，末帧空）+ GIF 预览。
claw  64×64 ×7：三道爪痕依次划过、碎星飞出、淡出。
enter 160×64 ×8：落地尘土向两边扩散 + 金星往上飘。
ko    96×96 ×9：PixelLab 烟团「噗」一下冒出（遮罩从中心扩开）+ 转圈星星，再从外往里消散。
python fx.py <ko 烟团 png> <输出目录>
"""
import math, pathlib, random, sys
from PIL import Image, ImageDraw
from drawlib import C, hx

PREV_BG = [(45, 41, 113), (240, 236, 226)]


def strip(frames):
    w, h = frames[0].size
    s = Image.new("RGBA", (w * len(frames), h), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        s.alpha_composite(f, (i * w, 0))
    return s


def gif(frames, path, ms, scale=3):
    out = []
    for f in frames:
        b = Image.new("RGBA", (f.width * 2, f.height), PREV_BG[0] + (255,))
        b.paste(PREV_BG[1] + (255,), (f.width, 0, f.width * 2, f.height))
        b.alpha_composite(f, (0, 0)); b.alpha_composite(f, (f.width, 0))
        out.append(b.convert("RGB").resize((b.width * scale, b.height * scale), Image.NEAREST))
    out += [out[-1]] * 4
    out[0].save(path, save_all=True, append_images=out[1:], duration=ms, loop=0, disposal=2)


def star4(d, x, y, r, col, core=None):
    x, y = round(x), round(y)
    for k in range(-r, r + 1):
        d.point((x + k, y), fill=col); d.point((x, y + k), fill=col)
    if r >= 2:
        for dx, dy in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
            d.point((x + dx, y + dy), fill=col)
    if core:
        d.point((x, y), fill=core)


def dither_fade(im, t, seed=1):
    """t 0..1：按固定随机顺序抹掉 t 比例的像素（像素风淡出）。"""
    rnd = random.Random(seed)
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            if rnd.random() < t:
                px[x, y] = (0, 0, 0, 0)
    return im


def claw():
    W = 64
    frames = []
    lines = [((44, 6), (14, 50)), ((52, 12), (22, 58)), ((58, 22), (32, 62))]
    lines = [((a[0] - 4, a[1] - 2), (b[0] - 4, b[1] - 6)) for a, b in lines]
    white, pink, ink = hx("#ffffff"), hx("#ff8fa3"), C["ink"]
    rnd = random.Random(7)
    sparks = [(rnd.uniform(0, 2 * math.pi), rnd.uniform(14, 26)) for _ in range(7)]
    for f in range(7):
        im = Image.new("RGBA", (W, W), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
        for i, (a, b) in enumerate(lines):
            prog = min(1.0, max(0.0, (f + 1 - i * 0.7) / 1.6))
            if prog <= 0 or f >= 5:
                continue
            ex, ey = a[0] + (b[0] - a[0]) * prog, a[1] + (b[1] - a[1]) * prog
            d.line((a, (ex, ey)), fill=ink, width=7)
            d.line((a, (ex, ey)), fill=pink, width=5)
            d.line(((a[0] + 1, a[1]), (ex + 1, ey)), fill=white, width=2)
        if 3 <= f <= 5:
            t = (f - 2) / 3
            for ang, dist in sparks:
                r = dist * t
                star4(d, 32 + math.cos(ang) * r, 32 + math.sin(ang) * r, 2 if f < 5 else 1, C["gold"], white)
        if f == 4:
            for i, (a, b) in enumerate(lines):
                d.line((a, b), fill=ink, width=7); d.line((a, b), fill=pink, width=5)
            im = dither_fade(im, 0.35, 3)
        frames.append(im)
    return frames


def puff(d, x, y, r, base, hi, ink):
    d.ellipse((x - r - 1, y - r - 1, x + r + 1, y + r + 1), fill=ink)
    d.ellipse((x - r, y - r, x + r, y + r), fill=base)
    if r >= 3:
        d.ellipse((x - r + 1, y - r + 1, x + r // 2, y + r // 3), fill=hi)


def enter():
    W, H = 160, 64
    frames = []
    base, hi, ink = hx("#e8dccb"), hx("#ffffff"), hx("#8a7a8f")
    rnd = random.Random(11)
    stars = [(rnd.uniform(30, 130), rnd.uniform(-0.6, 0.6)) for _ in range(6)]
    for f in range(8):
        im = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
        t = f / 7
        if f < 7:
            for side in (-1, 1):
                for k in range(4):
                    spread = 10 + 60 * min(1, t * 1.25) * (0.35 + 0.22 * k)
                    r = max(2, round((11 - 2 * k) * (1 - t * 0.7)))
                    x = 80 + side * spread
                    y = 54 - (k % 2) * 4 - t * 5
                    puff(d, x, y, r, base, hi, ink)
            for i, (sx, vx) in enumerate(stars):
                if f >= 1:
                    yy = 50 - (f - 1) * 6 - i % 3 * 3
                    star4(d, sx + vx * f * 4, yy, 3 if f < 4 else 2 if f < 6 else 1, C["gold"], hx("#ffffff"))
        if f == 6:
            im = dither_fade(im, 0.5, 5)
        frames.append(im)
    return frames


def ko(poof_path):
    S = 96
    poof = Image.open(poof_path).convert("RGBA")
    poof = poof.crop(poof.getbbox())
    if poof.width > 90 or poof.height > 90:
        k = max(poof.width, poof.height) / 90
        poof = poof.resize((round(poof.width / k), round(poof.height / k)), Image.NEAREST)
    frames = []
    reveal = [0.25, 0.55, 0.85, 1.0, 1.0, 1.0, 1.0, 1.0, None]
    fade = [0, 0, 0, 0, 0, 0.2, 0.45, 0.75, 1]
    for f in range(9):
        im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        if reveal[f]:
            p = poof.copy()
            cx, cy = p.width / 2, p.height / 2
            rmax = math.hypot(cx, cy) * reveal[f]
            px = p.load()
            for y in range(p.height):
                for x in range(p.width):
                    if math.hypot(x - cx, y - cy) > rmax:
                        px[x, y] = (0, 0, 0, 0)
            if fade[f]:
                p = dither_fade(p, fade[f], 9)
            im.alpha_composite(p, ((S - p.width) // 2, (S - p.height) // 2 + 6))
        d = ImageDraw.Draw(im)
        if 2 <= f <= 7:
            for k in range(3):
                ang = f * 0.9 + k * 2 * math.pi / 3
                star4(d, 48 + math.cos(ang) * 22, 22 + math.sin(ang) * 6, 2, C["gold"], hx("#ffffff"))
        frames.append(im)
    return frames


if __name__ == "__main__":
    poof, out = sys.argv[1], pathlib.Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    prev = pathlib.Path(__file__).parent / "out" / "fxpreview"; prev.mkdir(parents=True, exist_ok=True)
    for name, frs, ms in (("claw", claw(), 70), ("enter", enter(), 80), ("ko", ko(poof), 90)):
        strip(frs).save(out / f"{name}.png")
        gif(frs, prev / f"{name}.gif", ms)
        print(name, len(frs))
