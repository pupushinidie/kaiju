"""第 3 轮：自查不合格的 11 种卡图重画（像哥斯拉/小火龙/蘑菇云/看不懂的），带角色的卡改用我们自己的 6 只怪兽；
封面用定稿素材拼图作 init 再出 4 张；同时把拼图本身也当候选。
python r3.py [名字前缀 ...]
"""
import sys, pathlib
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import pixellab as px
from r1 import MON, NEG, CARD_STYLE, candy_palette, COVER

ART = pathlib.Path(__file__).parent
R1 = ART / "out" / "r1"; R2 = ART / "out" / "r2"
OUT = ART / "out" / "r3"; OUT.mkdir(parents=True, exist_ok=True)
NEG_CARD = NEG + ", realistic, scary, gore, human face, dinosaur, lizard, reptile, godzilla, charmander, mushroom cloud, nuclear explosion"

REDO = {
    "vast-storm": "a big swirling dark blue storm cloud spiral with heavy rain and bright yellow lightning bolts, strong wind swirl lines blowing over tiny pastel houses",
    "frenzy": f"{MON['crab']}, spinning furiously in a red whirlwind with steam puffs and angry eyebrows",
    "burrowing": "a big purple monster paw with white claws bursting up through a cracked city street, flying rubble and dirt clods, only the paw is visible",
    "even-bigger": f"{MON['deer']}, grown gigantic, standing among tiny pastel houses that only reach its feet, sparkles and upward arrows of light",
    "fire-breathing": f"{MON['robot']}, spraying a long stream of orange fire from its mouth to the side",
    "alien-metabolism": f"{MON['jelly']}, happily swallowing glowing green energy crystals that are visible inside its translucent belly",
    "herd-culler": "a big fluffy coral orange monster paw flicking a row of small white dice with black dots off a wooden table",
    "spiked-tail": f"{MON['moss']}, swinging a short stone tail with a big spiky mace ball on its tip, motion lines",
    "stretchy": f"{MON['jelly']}, stretching one arm extremely long like rubber in a curvy line to grab a white die",
    "urbavore": f"{MON['crab']}, taking a big bite out of the corner of a little pastel building, crumbs flying",
    "it-has-a-child": "a big cracked spotted egg with a tiny baby chubby coral orange fluffy monster with tiny deer antlers peeking out, sparkles",
    "metamorph": f"a glowing cocoon cracking open with rainbow sparkles, {MON['jelly']} popping out of it",
    "alpha-monster": f"{MON['deer']}, wearing a little golden crown, proudly flexing its tiny arms",
    "background-dweller": f"{MON['robot']}, shyly peeking out from behind a pastel building, only half of it visible",
    "herbivore": f"{MON['moss']}, happily munching a bunch of green leaves and pink flowers",
    "were-only-making-it-stronger": f"{MON['cloud']}, with a white bandage plaster on its head, flexing its tiny arms, glowing power sparkles around it",
}

JOBS = []
for cid, d in REDO.items():
    for s in (5111, 5112, 5113):
        JOBS.append((f"card-{cid}-s{s}", {"description": f"pixel art, {d}, {CARD_STYLE}", "image_size": {"width": 84, "height": 60},
                                         "outline": "selective outline", "detail": "highly detailed", "negative_description": NEG_CARD,
                                         "seed": s, "color_image": "PAL"}))


def cover_init(kind):
    """bg（缩到 384 宽）+ 城心 + 6 只怪兽（64 小立绘）+ 几颗骰子。"""
    p = OUT / f"cover-init-{kind}.png"
    if p.exists():
        return p
    bg = Image.open(R1 / ("bg-night-s2103.png" if kind == "night" else "bg-day-s2202.png")).convert("RGBA")
    bg = bg.resize((384, 216), Image.NEAREST).crop((0, 12, 384, 204))
    board = Image.open(R1 / "board-heart-s4103.png").convert("RGBA")
    bg.alpha_composite(board, (112, 60))
    deer = Image.open(R2 / "mon-deer.png").convert("RGBA")
    bg.alpha_composite(deer, (128, 4))
    xs = [(18, 112), (66, 124), (262, 120), (312, 110)]
    for (x, y), m in zip(xs, ["crab", "jelly", "robot", "cloud"]):
        mini = Image.open(R2 / f"init-{m}-64.png").convert("RGBA")
        bg.alpha_composite(mini, (x, y))
    moss = Image.open(R2 / "init-moss-64.png").convert("RGBA")
    bg.alpha_composite(moss, (300, 52))
    bg.convert("RGB").save(p)
    return p


for kind in ("night", "day"):
    for s, st in ((5701, 380), (5702, 560)):
        JOBS.append((f"cover-{kind}-s{s}", {"description": f"a group of chubby cute toy monsters, a coral orange fluffy one with deer antlers standing proudly on top of a little pastel toy city diorama on a cozy wooden table, a blue crab, a lilac jelly slime, a teal tin robot, a yellow thunder cloud and a green mossy stone monster gathering around to challenge it, {COVER}",
                                                "image_size": {"width": 384, "height": 192}, "negative_description": NEG + ", people, person",
                                                "init_image": ("INIT", kind), "init_image_strength": st, "seed": s}))


def run(job):
    name, body = job
    body = dict(body)
    if body.get("color_image") == "PAL":
        body["color_image"] = px.b64_image(candy_palette())
    if isinstance(body.get("init_image"), tuple):
        body["init_image"] = px.b64_image(cover_init(body["init_image"][1]))
    if (OUT / f"{name}.png").exists():
        return name, "skip"
    try:
        px.generate_image(name, body, OUT)
        return name, "ok"
    except Exception as e:
        return name, f"失败 {e}"


if __name__ == "__main__":
    pref = sys.argv[1:]
    cover_init("night"); cover_init("day")
    jobs = [j for j in JOBS if not pref or any(j[0].startswith(p) for p in pref)]
    print("任务数", len(jobs), flush=True)
    with ThreadPoolExecutor(max_workers=10) as ex:
        for i, (name, r) in enumerate(ex.map(run, jobs)):
            print(f"[{i + 1}/{len(jobs)}] {name} {r}", flush=True)
