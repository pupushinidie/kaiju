"""第 2 轮：挑定的 6 只怪兽 → 规整成 128×128（脚底 y=120、横向居中）；
64×64 小立绘（头像）和 32×32 小图标各 3 个候选（pixflux，用缩小的立绘作 init）；待机动画 8 帧各 2 个种子。
python r2.py [名字前缀 ...]
"""
import sys, pathlib
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import pixellab as px
from r1 import MON, CHAR, NEG_CHAR

ART = pathlib.Path(__file__).parent
R1 = ART / "out" / "r1"
OUT = ART / "out" / "r2"; OUT.mkdir(parents=True, exist_ok=True)
PICK = {"deer": "s3101", "jelly": "s3103", "robot": "s3104", "cloud": "s3104", "moss": "s3101", "crab": "s3101"}
FOOT = 120


def norm(m):
    p = OUT / f"mon-{m}.png"
    if not p.exists():
        im = Image.open(R1 / f"mon-{m}-{PICK[m]}.png").convert("RGBA")
        # 半透明边缘：alpha < 128 的去掉，其余设成不透明
        px_ = im.load()
        for y in range(im.height):
            for x in range(im.width):
                r, g, b, a = px_[x, y]
                px_[x, y] = (r, g, b, 255) if a >= 128 else (0, 0, 0, 0)
        im = im.crop(im.getbbox())
        c = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
        c.alpha_composite(im, ((128 - im.width) // 2, FOOT - im.height))
        c.save(p)
    return p


def small_init(m, size):
    p = OUT / f"init-{m}-{size}.png"
    if not p.exists():
        im = Image.open(norm(m)).convert("RGBA")
        im = im.crop(im.getbbox())
        k = (size - 2) / max(im.size)
        im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
        c = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        c.alpha_composite(im, ((size - im.width) // 2, size - 1 - im.height))
        c.save(p)
    return p


JOBS = []
for m in PICK:
    for size in (64, 32):
        for s in (6101, 6102, 6103):
            JOBS.append((f"mini{size}-{m}-s{s}", "pixflux", m, size, s))
    for s in (6201, 6202):
        JOBS.append((f"idle-{m}-s{s}", "anim", m, 128, s))


def run(job):
    name, kind, m, size, s = job
    try:
        if kind == "pixflux":
            if (OUT / f"{name}.png").exists():
                return name, "skip"
            px.generate_image(name, {
                "description": f"pixel art, {MON[m]}, {CHAR}, tiny game avatar sprite, very simple readable shapes",
                "image_size": {"width": size, "height": size}, "no_background": True,
                "outline": "single color black outline", "shading": "basic shading", "detail": "medium detail" if size == 32 else "highly detailed",
                "init_image": px.b64_image(small_init(m, size)), "init_image_strength": 450,
                "negative_description": NEG_CHAR, "seed": s}, OUT)
            return name, "ok"
        d = OUT / "anim" / name
        if (d / f"{name}.json").exists():
            return name, "skip"
        st = px.b64_image(norm(m))
        px.animate(name, {"first_frame": st, "last_frame": st,
                          "action": "the cute monster gently bobs up and down in place and blinks its eyes, idle breathing",
                          "frame_count": 8, "no_background": True, "seed": s}, d)
        return name, "ok"
    except Exception as e:
        return name, f"失败 {e}"


if __name__ == "__main__":
    pref = sys.argv[1:]
    for m in PICK:
        norm(m); small_init(m, 64); small_init(m, 32)
    jobs = [j for j in JOBS if not pref or any(j[0].startswith(p) for p in pref)]
    print("任务数", len(jobs), flush=True)
    with ThreadPoolExecutor(max_workers=10) as ex:
        for i, (name, r) in enumerate(ex.map(run, jobs)):
            print(f"[{i + 1}/{len(jobs)}] {name} {r}", flush=True)
