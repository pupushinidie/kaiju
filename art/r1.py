"""巨兽之城正式美术第 1 轮候选：背景夜/日、6 只怪兽、城心/港湾、61 种卡面插图 ×3、牌背、v2 图标标记、奖杯、特效素材、封面。
一个进程，线程池 10（标准版客户端全站排队）。用法：python r1.py [名字前缀 ...]
"""
import sys, pathlib
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import pixellab as px
from cards_data import CARDS

ART = pathlib.Path(__file__).parent
OUT = ART / "out" / "r1"; OUT.mkdir(parents=True, exist_ok=True)
SAMPLES = ART.parent / "assets"
NEG = "text, letters, numbers, writing, signature, watermark, logo, words, sign with text, frame, border"
NEG_CHAR = NEG + ", realistic, scary, dinosaur, godzilla, gorilla, ape, human, person"


def candy_palette():
    p = OUT / "pal-candy.png"
    if not p.exists():
        a = Image.open(SAMPLES / "style-B-night.png").convert("RGB")
        b = Image.open(SAMPLES / "style-B-day.png").convert("RGB")
        both = Image.new("RGB", (512, 576)); both.paste(a, (0, 0)); both.paste(b, (0, 288))
        both.quantize(40, method=Image.MEDIANCUT).convert("RGB").save(p)
    return p


JOBS = []

# ---- 背景 ----
TABLE = ("a cozy wooden board game table seen from above at a gentle high angle, the warm wooden table top fills most of the picture "
         "and its middle is an empty clear wood surface, at the top edge a window and a shelf, a small potted plant and a desk lamp in the corners, "
         "a few scattered rounded white dice and small pastel game tokens near the edges only, cute cozy toy style, soft rounded shapes, "
         "absolutely no text, no letters, no signs, no people")
for s in (2101, 2102, 2103):
    JOBS.append((f"bg-night-s{s}", "/create-image-pixen", {"description": f"pixel art, {TABLE}, cozy evening, soft indigo night outside the window with stars and warm glowing city windows, warm yellow lamp light pooling on the table, candy colors mint peach lilac lemon", "image_size": {"width": 512, "height": 288}, "seed": s}))
for s in (2201, 2202, 2203):
    JOBS.append((f"bg-day-s{s}", "/create-image-pixen", {"description": f"pixel art, {TABLE}, bright sunny daytime, light blue sky and fluffy clouds outside the window, soft sunlight on the table, cheerful candy colors mint peach lilac lemon", "image_size": {"width": 512, "height": 288}, "seed": s}))

# ---- 怪兽 ----
CHAR = ("cute chibi kawaii monster figure, toy-like, round chubby body, big sparkly eyes, tiny feet, standing, full body, "
        "front three-quarter view, centered, soft rounded shapes, candy colors, 16-bit pixel art, transparent background")
MON = {
    "deer": "a chubby round coral-orange fluffy furball monster with two small brown deer antlers, big sparkly black eyes, rosy cheeks, one tiny white fang, little stubby arms",
    "jelly": "a chubby lilac purple translucent jelly slime monster, wobbly blob shape with a little bubble on top of its head, two big shiny eyes, a happy open mouth, little stubby arms",
    "robot": "a chubby teal cyan tin can toy robot monster, round boxy metal body with rivets, two round porthole eyes, a springy antenna with a ball on its head, a wind-up key on its back, stubby metal arms",
    "cloud": "a chubby lemon yellow puffy thunder cloud monster, fluffy cloud body, two small yellow lightning bolt horns, big happy eyes, tiny cloud feet",
    "moss": "a chubby round grass green mossy stone boulder monster, rock body covered in soft moss, a tiny pink flower and a little mushroom growing on its head, big friendly eyes, little stone arms",
    "crab": "a chubby round royal blue crab monster, one big claw and one small claw raised, two big eyes on short stalks, little legs, cheerful smile",
}
for m, d in MON.items():
    for s in (3101, 3102, 3103, 3104):
        JOBS.append((f"mon-{m}-s{s}", "/create-image-pixflux", {"description": f"pixel art, {d}, {CHAR}", "image_size": {"width": 128, "height": 128}, "no_background": True, "outline": "single color black outline", "shading": "medium shading", "detail": "highly detailed", "negative_description": NEG_CHAR, "seed": s}))

# ---- 城市板 ----
BOARD = ("a cute toy diorama on a raised hexagon shaped wooden base with thick sides, seen from a high three-quarter angle, "
         "rounded pastel toy buildings, tiny round trees, soft rounded shapes, candy colors, 16-bit pixel art, transparent background")
for s in (4101, 4102, 4103, 4104):
    JOBS.append((f"board-heart-s{s}", "/create-image-pixflux", {"description": f"pixel art, {BOARD}, a little city center: a ring of small pastel houses and towers around the edge of the base, a large flat empty round stone plaza in the middle with nothing on it", "image_size": {"width": 160, "height": 128}, "no_background": True, "outline": "single color black outline", "detail": "highly detailed", "view": "high top-down", "negative_description": NEG, "seed": s}))
    JOBS.append((f"board-harbor-s{s}", "/create-image-pixflux", {"description": f"pixel art, {BOARD}, a little harbor: half of the base is blue sea water with a tiny lighthouse and two small boats, a wooden pier, a few pastel warehouses, a large flat empty round stone plaza on the shore with nothing on it", "image_size": {"width": 160, "height": 128}, "no_background": True, "outline": "single color black outline", "detail": "highly detailed", "view": "high top-down", "negative_description": NEG, "seed": s}))

# ---- 卡面插图 ----
CARD_STYLE = "cute cozy toy-like style, soft rounded shapes, candy colors, simple soft pastel background, 16-bit pixel art illustration, centered subject"
for cid, cn, t, cost, n, d in CARDS:
    for s in (5101, 5102, 5103):
        JOBS.append((f"card-{cid}-s{s}", "/create-image-pixflux", {"description": f"pixel art, {d}, {CARD_STYLE}", "image_size": {"width": 84, "height": 60}, "outline": "selective outline", "detail": "highly detailed", "negative_description": NEG + ", realistic, scary, gore, human face", "seed": s, "color_image": "PAL"}))

# ---- 牌背 ----
for s in (5201, 5202, 5203):
    JOBS.append((f"back-s{s}", "/create-image-pixflux", {"description": "pixel art playing card back design, deep indigo purple with a pattern of tiny cream stars, in the center a big round mint green emblem with a cute three-toed monster paw print, warm cream outer border, perfectly symmetrical, cute candy colors, no text", "image_size": {"width": 96, "height": 136}, "negative_description": NEG, "seed": s}))

# ---- 奖杯 ----
for s in (5301, 5302, 5303):
    JOBS.append((f"trophy-s{s}", "/create-image-pixflux", {"description": "pixel art, a shiny golden trophy cup with a little crown on top and a tiny pastel toy city skyline on its base, sparkles, cute candy style, transparent background", "image_size": {"width": 64, "height": 64}, "no_background": True, "outline": "single color black outline", "negative_description": NEG, "seed": s}))

# ---- 特效素材（代码再做成帧） ----
for s in (5401, 5402, 5403):
    JOBS.append((f"poof-s{s}", "/create-image-pixflux", {"description": "pixel art, a big round cartoon puff of white and light grey dust smoke clouds, poof explosion of cotton-like puffs, soft shading, transparent background", "image_size": {"width": 96, "height": 64}, "no_background": True, "outline": "single color outline", "negative_description": NEG, "seed": s}))

# ---- v2 小图（一次 64 个候选） ----
V2 = {
    "ic-energy": "pixel art game icon, a glowing bright green crystal cube with a yellow lightning bolt inside, shiny highlights, bold dark outline, simple, readable, fills the canvas",
    "ic-heart": "pixel art game icon, a chubby glossy pink red heart with a white shine highlight, bold dark outline, simple, readable, fills the canvas",
    "ic-star": "pixel art game icon, a chubby golden yellow five pointed star with a white shine highlight, bold dark outline, simple, readable, fills the canvas",
    "ic-claw": "pixel art game icon, a cute chubby monster paw with three sharp white claws, purple paw, bold dark outline, simple, readable, fills the canvas",
    "ic-crown": "pixel art game icon, a small golden royal crown with three points and pink gems, bold dark outline, simple, readable, fills the canvas",
    "tok-poison": "pixel art game token, a round green poison drop with bubbles and a tiny purple skull-free toxic swirl, bold dark outline, simple, readable, fills the canvas",
    "tok-shrink": "pixel art game token, a round light blue coin with a tiny monster silhouette and two arrows pointing inward to shrink it, bold dark outline, simple, readable, fills the canvas",
    "tok-smoke": "pixel art game token, a puffy round grey smoke cloud puff, bold dark outline, simple, readable, fills the canvas",
    "tok-mimic": "pixel art game token, a round hand mirror with a pink frame and a sparkle on the glass, bold dark outline, simple, readable, fills the canvas",
}
for i, (k, d) in enumerate(V2.items()):
    JOBS.append((k, "/generate-image-v2", {"description": d, "image_size": {"width": 32, "height": 32}, "no_background": True, "seed": 5500 + i}))

# ---- 封面 ----
COVER = "cozy 16-bit pixel art game cover illustration, rich warm colors, soft lighting, crisp clean pixels, no text, no letters, no logo, no people"
for s, scene in ((5601, "three chubby cute toy monsters, a coral orange fluffy one with deer antlers, a lilac jelly slime and a blue crab, playfully squabbling on top of a little pastel toy city diorama on a wooden table, big white dice flying around"),
                 (5602, "a chubby coral orange fluffy monster with small deer antlers proudly standing on top of a pastel toy city diorama with a tiny golden crown, other cute monsters (yellow cloud, teal tin robot, green mossy stone) climbing up to challenge it, dice and glowing green energy crystals"),
                 (5603, "a cute toy city diorama at night on a cozy wooden table, six chubby cute monsters of different colors surrounding it, a glowing card and white dice in the foreground, warm lamp light"),
                 (5604, "a big tumble of white dice and glowing green energy crystals over a pastel toy city, a cute chubby lilac jelly monster and a royal blue crab monster hugging a tower, bright cheerful daylight")):
    JOBS.append((f"cover-s{s}", "/create-image-pixflux", {"description": f"{scene}, {COVER}", "image_size": {"width": 384, "height": 192}, "negative_description": NEG + ", people, person", "seed": s}))


def run(job):
    name, ep, body = job
    body = dict(body)
    if body.get("color_image") == "PAL":
        body["color_image"] = px.b64_image(candy_palette())
    try:
        if ep == "/generate-image-v2":
            if (OUT / name / f"{name}.png").exists():
                return name, "skip"
            return name, len(px.generate_async(name, body, OUT / name, endpoint=ep))
        if (OUT / f"{name}.png").exists():
            return name, "skip"
        if ep == "/create-image-pixen":
            body["detail"] = "highly detailed"
        px.generate_image(name, body, OUT, endpoint=ep)
        return name, "ok"
    except Exception as e:
        return name, f"失败 {e}"


if __name__ == "__main__":
    pref = sys.argv[1:]
    jobs = [j for j in JOBS if not pref or any(j[0].startswith(p) for p in pref)]
    candy_palette()
    print("任务数", len(jobs), flush=True)
    done = 0
    with ThreadPoolExecutor(max_workers=10) as ex:
        for name, r in ex.map(run, jobs):
            done += 1
            print(f"[{done}/{len(jobs)}] {name} {r}", flush=True)
