"""卡图候选总览：python cardsheet.py <输出前缀> <id ...>（每张卡 3 个候选一组，一行两组）"""
import sys, pathlib
from PIL import Image, ImageDraw
from cards_data import CARDS
import os; R1 = pathlib.Path(__file__).parent / "out" / os.environ.get("ROUND", "r1")
pref, ids = sys.argv[1], sys.argv[2:]
cn = {c[0]: c[1] for c in CARDS}
per_sheet = 16
for n in range(0, len(ids), per_sheet):
    chunk = ids[n:n + per_sheet]
    rows = (len(chunk) + 1) // 2
    S = Image.new("RGBA", (2 * (3 * 88 + 12) + 4, rows * 74 + 4), (60, 55, 90, 255))
    d = ImageDraw.Draw(S)
    for k, cid in enumerate(chunk):
        x0, y0 = 4 + (k % 2) * (3 * 88 + 12), 4 + (k // 2) * 74
        for j, s in enumerate((5111, 5112, 5113) if os.environ.get("ROUND") == "r3" else (5101, 5102, 5103)):
            p = R1 / f"card-{cid}-s{s}.png"
            if p.exists():
                S.alpha_composite(Image.open(p).convert("RGBA"), (x0 + j * 88, y0))
        d.text((x0, y0 + 61), f"{cid[:26]}", fill=(255, 255, 255, 255))
    S = S.resize((S.width * 2, S.height * 2), Image.NEAREST)
    S.save(f"{pref}-{n // per_sheet}.png"); print(f"{pref}-{n // per_sheet}.png")
