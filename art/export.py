"""按 spec 把挑定的图导出到 out/final/（目录结构 = apps/web/public/art/），并写 selection.json。
python export.py
"""
import json, math, pathlib, shutil, subprocess, sys
from PIL import Image, ImageDraw
import picks
from cards_data import CARDS
from cards import frame, compose
from drawlib import C, hx

ART = pathlib.Path(__file__).parent
OUT = ART / "out"
FINAL = OUT / "final"
PY = sys.executable


def clean_alpha(im):
    """半透明边缘二值化（像素图只要全透明或不透明）。"""
    im = im.convert("RGBA")
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            px[x, y] = (r, g, b, 255) if a >= 128 else (0, 0, 0, 0)
    return im


def save(im, rel):
    p = FINAL / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    im.save(p, optimize=True)
    return p


def icon_path(group, i):
    return OUT / "r1" / group / (f"{group}.png" if i == 0 else f"{group}-{i}.png")


def center32(im):
    im = clean_alpha(im)
    bb = im.getbbox()
    im = im.crop(bb)
    c = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    c.alpha_composite(im, ((32 - im.width) // 2, (32 - im.height) // 2))
    return c


def glow(board, ellipse):
    im = Image.new("RGBA", (160, 128), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    x0, y0, x1, y1 = ellipse
    d.ellipse((x0 - 3, y0 - 3, x1 + 3, y1 + 3), outline=hx("#fff2a8", 255), width=1)
    d.ellipse((x0 - 2, y0 - 2, x1 + 2, y1 + 2), outline=C["gold"], width=2)
    d.ellipse((x0, y0, x1, y1), fill=hx("#ffe680", 70))
    # 四个小星
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    for ang in (0.6, 2.4, 3.8, 5.5):
        sx, sy = round(cx + math.cos(ang) * (x1 - x0) / 2 * 1.05), round(cy + math.sin(ang) * (y1 - y0) / 2 * 1.1)
        for k in (-2, -1, 0, 1, 2):
            d.point((sx + k, sy), fill=hx("#ffffff")); d.point((sx, sy + k), fill=hx("#ffffff"))
    return im


def ko_version(im):
    im = im.convert("RGBA")
    g = im.convert("LA").convert("RGBA")
    px, src = g.load(), im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, gg, b, a = px[x, y]
            if a:
                v = int(r * 0.6 + 70)
                px[x, y] = (v, v, min(255, v + 12), a)
    return g


def main():
    if FINAL.exists():
        shutil.rmtree(FINAL)
    sel = {"style": "B · Q 版桌面沙盘", "items": {}}

    def rec(rel, src, alts=(), note=""):
        sel["items"][rel] = {"source": str(src), "candidates": [str(a) for a in alts], "note": note}

    # 背景
    for k, (src, alts) in picks.BG.items():
        im = Image.open(OUT / src).convert("RGB")
        save(im, f"bg/{k}.png")
        save(im.resize((1536, 864), Image.NEAREST), f"bg/{k}@3x.png")
        rec(f"bg/{k}.png", src, alts)
    # 城市板
    ell = {"heart": (53, 50, 115, 80), "harbor": (46, 60, 122, 92)}
    for b in ("heart", "harbor"):
        src = f"r1/board-{b}-{picks.BOARD_SEED}.png"
        save(clean_alpha(Image.open(OUT / src)), f"board/{b}.png")
        save(glow(b, ell[b]), f"board/glow-{b}.png")
        rec(f"board/{b}.png", src, [f"r1/board-{b}-{s}.png" for s in picks.BOARD_ALT], f"怪兽脚底落点 {picks.ANCHOR[b]}")
    sel["anchor"] = picks.ANCHOR
    # 怪兽
    sel["monsters"] = {}
    for m in picks.MON:
        src = OUT / "r2" / f"mon-{m}.png"
        save(Image.open(src).convert("RGBA"), f"monsters/{m}.png")
        rec(f"monsters/{m}.png", f"r1/mon-{m}-{picks.MON[m]}.png", [f"r1/mon-{m}-s{s}.png" for s in (3101, 3102, 3103, 3104) if f"s{s}" != picks.MON[m]])
        sel["monsters"][m] = {"name": picks.MON_NAME[m], "color": picks.MON_COLOR[m]}
        for size, key in ((64, "mini"), (32, "icon")):
            ch = picks.MINI.get(f"{key}-{m}")
            if ch is None:
                continue
            im = clean_alpha(Image.open(OUT / ch))
            bb = im.getbbox(); im = im.crop(bb)
            c = Image.new("RGBA", (size, size), (0, 0, 0, 0))
            c.alpha_composite(im, ((size - im.width) // 2, size - im.height))
            save(c, f"monsters/{m}-{key}.png")
            if key == "mini":
                save(ko_version(c), f"monsters/{m}-mini-ko.png")
            rec(f"monsters/{m}-{key}.png", ch)
        idle = picks.IDLE.get(m)
        if idle:
            src_dir, order = idle
            frames = [clean_alpha(Image.open(OUT / src_dir / f"{pathlib.Path(src_dir).name}-{i:02d}.png")) for i in order]
            frames[0] = Image.open(src).convert("RGBA")  # 首帧用静态图
            strip = Image.new("RGBA", (128 * len(frames), 128), (0, 0, 0, 0))
            for i, f in enumerate(frames):
                strip.alpha_composite(f, (i * 128, 0))
            save(strip, f"monsters/{m}-idle.png")
            rec(f"monsters/{m}-idle.png", src_dir, note=f"帧序 {order}")
    # 图标、标记
    for rel, (g, i, alts) in picks.ICONS.items():
        save(center32(Image.open(icon_path(g, i))), f"{rel}.png")
        rec(f"{rel}.png", icon_path(g, i).relative_to(OUT), [icon_path(g, a).relative_to(OUT) for a in alts])
    # 骰子
    subprocess.run([PY, str(ART / "dice.py"), str(FINAL / "icons/energy.png"), str(FINAL / "icons/heart.png"), str(FINAL / "icons/claw.png"), str(FINAL / "dice")], check=True, cwd=ART)
    (FINAL / "dice-preview.png").rename(OUT / "dice-preview.png")
    # 卡
    for kind, name in (("K", "keep"), ("D", "discard")):
        save(frame(kind, picks.FRAME_STYLE), f"cards/frame-{name}.png")
    for cid, cn, t, cost, n, d in CARDS:
        rnd, seed = picks.CARD[cid].split("/")
        src = OUT / rnd / f"card-{cid}-{seed}.png"
        art = Image.open(src).convert("RGBA")
        save(art.convert("RGB"), f"cards/art/{cid}.png")
        fr = Image.open(FINAL / f"cards/frame-{'keep' if t == 'K' else 'discard'}.png")
        save(compose(fr, art), f"cards/full/{cid}.png")
        save(art.crop((21, 15, 63, 45)).convert("RGB"), f"cards/thumb/{cid}.png")
        alts = [f"{r}/card-{cid}-s{s}.png" for r, ss in (("r1", (5101, 5102, 5103)), ("r3", (5111, 5112, 5113))) for s in ss
                if (OUT / r / f"card-{cid}-s{s}.png").exists() and f"{r}/s{s}" != picks.CARD[cid]]
        rec(f"cards/art/{cid}.png", src.relative_to(OUT), alts, f"{cn}（{'保留' if t == 'K' else '一次性'}，{cost} 能量，{n} 张）")
    b, alts = picks.BACK
    save(clean_alpha(Image.open(OUT / b)), "cards/back.png"); rec("cards/back.png", b, alts)
    t, alts = picks.TROPHY
    im = clean_alpha(Image.open(OUT / t)); im = im.crop(im.getbbox())
    c = Image.new("RGBA", (64, 64), (0, 0, 0, 0)); c.alpha_composite(im, ((64 - im.width) // 2, 64 - im.height))
    save(c, "ui/trophy.png"); rec("ui/trophy.png", t, alts)
    # 特效
    subprocess.run([PY, str(ART / "fx.py"), str(OUT / picks.POOF), str(FINAL / "fx")], check=True, cwd=ART)
    shutil.rmtree(FINAL / "fxpreview", ignore_errors=True)
    (ART / "selection.json").write_text(json.dumps(sel, ensure_ascii=False, indent=1, default=str))
    n = sum(1 for _ in FINAL.rglob("*.png"))
    print("导出", n, "个文件 →", FINAL)


if __name__ == "__main__":
    main()
