"""核对 out/final 和 spec：每一项都在、尺寸对、透明图没有半透明像素。"""
import pathlib, sys
from PIL import Image
from cards_data import CARDS
F = pathlib.Path(__file__).parent / "out" / "final"
M = ["deer", "jelly", "robot", "cloud", "moss", "crab"]
want = {"bg/night.png": (512, 288), "bg/day.png": (512, 288), "bg/night@3x.png": (1536, 864), "bg/day@3x.png": (1536, 864),
        "board/heart.png": (160, 128), "board/harbor.png": (160, 128), "board/glow-heart.png": (160, 128), "board/glow-harbor.png": (160, 128),
        "cards/frame-keep.png": (96, 136), "cards/frame-discard.png": (96, 136), "cards/back.png": (96, 136), "ui/trophy.png": (64, 64),
        "fx/claw.png": (448, 64), "fx/enter.png": (1280, 64), "fx/ko.png": (864, 96)}
for m in M:
    want |= {f"monsters/{m}.png": (128, 128), f"monsters/{m}-idle.png": (1024, 128), f"monsters/{m}-mini.png": (64, 64),
             f"monsters/{m}-mini-ko.png": (64, 64), f"monsters/{m}-icon.png": (32, 32)}
for k in ("w", "g"):
    for f in ("1", "2", "3", "energy", "heart", "claw", "blank"):
        want[f"dice/{k}-{f}.png"] = (44, 44)
for n in ("energy", "heart", "star", "claw", "crown"):
    want[f"icons/{n}.png"] = (32, 32)
for n in ("poison", "shrink", "smoke", "mimic"):
    want[f"tokens/{n}.png"] = (32, 32)
for c in CARDS:
    want |= {f"cards/art/{c[0]}.png": (84, 60), f"cards/full/{c[0]}.png": (96, 136), f"cards/thumb/{c[0]}.png": (42, 30)}
bad = 0
for rel, sz in want.items():
    p = F / rel
    if not p.exists():
        print("缺", rel); bad += 1; continue
    im = Image.open(p)
    if im.size != sz:
        print("尺寸不对", rel, im.size, sz); bad += 1
    if im.mode == "RGBA":
        semi = sum(1 for a in im.getchannel("A").getdata() if 0 < a < 255)
        if semi and not rel.startswith("board/glow"):
            print("半透明像素", rel, semi); bad += 1
extra = {str(p.relative_to(F)) for p in F.rglob("*.png")} - set(want)
print("应有", len(want), "实有", sum(1 for _ in F.rglob("*.png")), "多出", sorted(extra), "问题", bad)
sys.exit(1 if bad else 0)
