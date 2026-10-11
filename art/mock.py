"""牌桌示意拼图（不是界面设计，只为自查：倍数、可读性、白天/夜间、队伍色）。1440×790，桌面 2×。
python mock.py → out/mock-night.png, out/mock-day.png
"""
import pathlib
from PIL import Image, ImageDraw
import picks

ART = pathlib.Path(__file__).parent
F = ART / "out" / "final"


def L(rel):
    return Image.open(F / rel).convert("RGBA")


def up(im, k):
    return im.resize((im.width * k, im.height * k), Image.NEAREST)


def frame0(strip, w):
    return strip.crop((0, 0, w, strip.height))


def mock(theme):
    W, H = 1440, 790
    bg = L(f"bg/{theme}@3x.png").crop((48, 37, 48 + W, 37 + H))
    shade = Image.new("RGBA", (W, H), (0, 0, 0, 77) if theme == "night" else (255, 255, 255, 38))
    bg.alpha_composite(shade)
    # 城心 + 港湾
    for b, x0, m in (("heart", 360, "deer"), ("harbor", 720, "crab")):
        board = up(L(f"board/{b}.png"), 2)
        y0 = 170
        bg.alpha_composite(board, (x0, y0))
        ax, ay = picks.ANCHOR[b]
        mon = up(L(f"monsters/{m}.png"), 2)
        bg.alpha_composite(mon, (x0 + ax * 2 - 128, y0 + ay * 2 - 240))
    bg.alpha_composite(up(L("icons/crown.png"), 2), (560, 60))
    # 骰子
    faces = ["w-3", "w-3", "w-claw", "w-energy", "w-heart", "w-1", "g-2", "g-claw"]
    for i, f in enumerate(faces):
        bg.alpha_composite(up(L(f"dice/{f}.png"), 2), (330 + i * 100, 480))
    # 市场 3 张
    for i, cid in enumerate(["skyscraper", "fire-breathing", "rapid-healing"]):
        bg.alpha_composite(up(L(f"cards/full/{cid}.png"), 2), (1010 + (i % 2) * 210, 40 + (i // 2) * 290))
    bg.alpha_composite(up(L("cards/back.png"), 2), (1220, 330))
    # 左侧 6 个玩家面板
    d = ImageDraw.Draw(bg)
    for i, m in enumerate(picks.MON):
        y = 20 + i * 126
        col = tuple(int(picks.MON_COLOR[m][k:k + 2], 16) for k in (1, 3, 5))
        panel = (40, 30, 60, 220) if theme == "night" else (255, 252, 244, 235)
        d.rounded_rectangle((16, y, 296, y + 116), 10, fill=panel, outline=col + (255,), width=4)
        mini = L(f"monsters/{m}-mini{'-ko' if i == 5 else ''}.png")
        bg.alpha_composite(up(mini, 2) if True else mini, (22, y - 12))
        for j, ic in enumerate(["icons/heart", "icons/star", "icons/energy"]):
            bg.alpha_composite(L(f"{ic}.png"), (160, y + 8 + j * 34))
        bg.alpha_composite(L("tokens/poison.png"), (240, y + 8))
        bg.alpha_composite(L(f"cards/thumb/{['giant-brain', 'wings', 'extra-head', 'jets', 'armor-plating', 'mimic'][i]}.png"), (240, y + 48))
    # 特效一帧
    bg.alpha_composite(up(L("fx/claw.png").crop((192, 0, 256, 64)), 2), (420, 230))
    bg.alpha_composite(up(L("ui/trophy.png"), 2), (40 * 0 + 860, 600))
    out = ART / "out" / f"mock-{theme}.png"
    bg.convert("RGB").save(out)
    return out


if __name__ == "__main__":
    for t in ("night", "day"):
        print(mock(t))
