"""候选总览图：python sheet.py <输出> <每行个数> <放大> <png ...>  透明图左半夜色底、右半白底不需要；统一用中灰暖底+编号。"""
import sys, pathlib
from PIL import Image, ImageDraw
out, per, sc = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
files = sys.argv[4:]
ims = [Image.open(f).convert("RGBA") for f in files]
w = max(i.width for i in ims); h = max(i.height for i in ims)
rows = (len(ims) + per - 1) // per
S = Image.new("RGBA", (per * (w + 6) + 6, rows * (h + 16) + 6), (190, 175, 160, 255))
d = ImageDraw.Draw(S)
for k, (f, im) in enumerate(zip(files, ims)):
    x, y = 6 + (k % per) * (w + 6), 6 + (k // per) * (h + 16)
    if k % 2: S.paste((70, 62, 120, 255), (x, y, x + w, y + h))
    S.alpha_composite(im, (x, y))
    d.text((x, y + h + 1), pathlib.Path(f).stem[-22:], fill=(0, 0, 0, 255))
S = S.resize((S.width * sc, S.height * sc), Image.NEAREST)
S.save(out); print(out, S.size)
