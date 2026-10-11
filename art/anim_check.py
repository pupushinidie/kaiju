"""待机动画候选检查：逐帧变化量、坏帧、和静态图的差、首尾接缝；出 GIF 和帧拼图。"""
import pathlib, sys
from PIL import Image, ImageChops
ART = pathlib.Path(__file__).parent; A = ART / "out" / "r2" / "anim"; PREV = ART / "out" / "animpreview"; PREV.mkdir(exist_ok=True)
def bin_(im):
    im = im.convert("RGBA"); px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]; px[x, y] = (r, g, b, 255) if a >= 128 else (0, 0, 0, 0)
    return im
def diff(a, b):
    d = ImageChops.difference(a, b).convert("L").point(lambda v: 255 if v > 24 else 0)
    return sum(1 for v in d.getdata() if v) / (a.width * a.height)
def has_glitch(fr):
    ds = [diff(fr[i], fr[i + 1]) for i in range(len(fr) - 1)]
    med = sorted(ds)[len(ds) // 2] or 1e-6
    for i in range(1, len(fr) - 1):
        if ds[i - 1] >= 4 * med and ds[i] >= 4 * med and diff(fr[i - 1], fr[i + 1]) < med:
            return i
    return None
for d in sorted(A.iterdir()):
    fs = sorted(d.glob(f"{d.name}-*.png"))
    if not fs: print(d.name, "没有帧"); continue
    m = d.name.split("-")[1]
    static = Image.open(ART / "out" / "r2" / f"mon-{m}.png").convert("RGBA")
    fr = [bin_(Image.open(f)) for f in fs]
    ds = [diff(fr[i], fr[i + 1]) for i in range(len(fr) - 1)]
    ds0 = [diff(static, f) for f in fr]
    g = has_glitch(fr[:8] + [fr[0]])
    print(f"{d.name}: {len(fr)} 帧 相邻 {' '.join(f'{x:.1%}' for x in ds)} | 对静态 {' '.join(f'{x:.1%}' for x in ds0)} | 坏帧 {g}")
    big = []
    for f in fr[:8]:
        b = Image.new("RGBA", (128, 128), (45, 41, 113, 255)); b.alpha_composite(f); big.append(b.convert("RGB").resize((256, 256), Image.NEAREST))
    big[0].save(PREV / f"{d.name}.gif", save_all=True, append_images=big[1:], duration=150, loop=0)
    S = Image.new("RGBA", (128 * len(fr), 128), (45, 41, 113, 255))
    for i, f in enumerate(fr): S.alpha_composite(f, (i * 128, 0))
    S.save(PREV / f"{d.name}-strip.png")
