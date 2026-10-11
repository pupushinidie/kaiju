"""v2 小图候选的挑选：每组 3 个，左夜色底、右白底，4 倍放大。"""
import sys, pathlib
from PIL import Image
R1 = pathlib.Path(__file__).parent / "out" / "r1"
PICKS = {"ic-energy": [0, 19, 10], "ic-heart": [3, 17, 9], "ic-star": [0, 20, 4], "ic-claw": [9, 61, 0],
         "ic-crown": [0, 4, 16], "tok-poison": [2, 41, 17], "tok-shrink": [7, 14, 23], "tok-smoke": [0, 13, 8], "tok-mimic": [2, 6, 18]}
def path(k, i): return R1 / k / (f"{k}.png" if i == 0 else f"{k}-{i}.png")
if __name__ == "__main__":
    S = Image.new("RGBA", (3 * 2 * 40 + 20, len(PICKS) * 40), (0, 0, 0, 255))
    for r, (k, idx) in enumerate(PICKS.items()):
        for c, i in enumerate(idx):
            im = Image.open(path(k, i)).convert("RGBA")
            for b, bg in enumerate([(45, 41, 113, 255), (250, 248, 240, 255)]):
                x = c * 86 + b * 40; y = r * 40
                S.paste(bg, (x, y, x + 40, y + 40)); S.alpha_composite(im, (x + 4, y + 4))
    S.resize((S.width * 4, S.height * 4), Image.NEAREST).save(R1.parent / "review-iconpick.png")
