"""挑定结果（export.py 和 gallery.py 共用）。每样：推荐（定稿）+ 其他候选，路径相对 art/out/。"""

BG = {
    "night": ("r1/bg-night-s2103.png", ["r1/bg-night-s2101.png", "r1/bg-night-s2102.png"]),
    "day": ("r1/bg-day-s2202.png", ["r1/bg-day-s2201.png", "r1/bg-day-s2203.png"]),
}
BOARD_SEED = "s4103"
BOARD_ALT = ["s4101", "s4102", "s4104"]
# 怪兽脚底落点（城市板原图坐标，像素）
ANCHOR = {"heart": (84, 68), "harbor": (84, 80)}

MON = {"deer": "s3101", "jelly": "s3103", "robot": "s3104", "cloud": "s3104", "moss": "s3101", "crab": "s3101"}
MON_NAME = {"deer": "团团鹿", "jelly": "啵啵冻", "robot": "铁罐丁", "cloud": "轰隆云", "moss": "苔石墩", "crab": "钳钳蟹"}
MON_COLOR = {"deer": "#e8704f", "jelly": "#a57fdc", "robot": "#36b9c4", "cloud": "#f2c63a", "moss": "#78c257", "crab": "#4a7fe0"}

# v2 小图：(组, 定稿序号, 备选序号)
ICONS = {
    "icons/energy": ("ic-energy", 0, [19, 10]),
    "icons/heart": ("ic-heart", 17, [3, 9]),
    "icons/star": ("ic-star", 0, [20, 4]),
    "icons/claw": ("ic-claw", 61, [9, 0]),
    "icons/crown": ("ic-crown", 4, [0, 16]),
    "tokens/poison": ("tok-poison", 41, [2, 17]),
    "tokens/shrink": ("tok-shrink", 7, [14, 23]),
    "tokens/smoke": ("tok-smoke", 0, [13, 8]),
    "tokens/mimic": ("tok-mimic", 2, [6, 18]),
}

# 卡图：id → 定稿（r1 用 s51xx；r3 重画的 s511x）
CARD = {
    "apartment-building": "r1/s5102", "commuter-train": "r1/s5102", "corner-store": "r1/s5102",
    "drop-from-high-altitude": "r1/s5102", "energize": "r1/s5102", "evacuation-orders": "r1/s5101",
    "fire-blast": "r1/s5101", "gas-refinery": "r1/s5102", "heal": "r1/s5102",
    "high-altitude-bombing": "r1/s5102", "jet-fighters": "r1/s5103", "national-guard": "r1/s5101",
    "nuclear-power-plant": "r1/s5102", "skyscraper": "r1/s5103", "tanks": "r1/s5101",
    "acid-attack": "r1/s5101", "armor-plating": "r1/s5103", "camouflage": "r1/s5103", "complete-destruction": "r1/s5101",
    "dedicated-news-team": "r1/s5103", "eater-of-the-dead": "r1/s5103", "energy-hoarder": "r1/s5101",
    "extra-head": "r1/s5101", "freeze-time": "r1/s5102", "friend-of-children": "r1/s5102",
    "giant-brain": "r1/s5102", "gourmet": "r1/s5101", "jets": "r1/s5102", "made-in-a-lab": "r1/s5103", "mimic": "r1/s5103", "monster-batteries": "r1/s5101",
    "nova-breath": "r1/s5101", "omnivore": "r1/s5102", "parasitic-tentacles": "r1/s5102",
    "plot-twist": "r1/s5101", "poison-quills": "r1/s5102", "poison-spit": "r1/s5101",
    "rapid-healing": "r1/s5103", "regeneration": "r1/s5101", "rooting-for-the-underdog": "r1/s5103",
    "shrink-ray": "r1/s5102", "smoke-cloud": "r1/s5102", "solar-powered": "r1/s5102",
    "telepath": "r1/s5101", "wings": "r1/s5103",
    # 第 3 轮重画（r1 三张都不合格）
    "vast-storm": "r3/s5113", "frenzy": "r3/s5111", "burrowing": "r3/s5113", "even-bigger": "r3/s5113",
    "fire-breathing": "r3/s5111", "alien-metabolism": "r3/s5113", "herd-culler": "r3/s5113",
    "spiked-tail": "r3/s5111", "stretchy": "r3/s5111", "urbavore": "r3/s5112",
    "were-only-making-it-stronger": "r3/s5112", "it-has-a-child": "r3/s5112", "metamorph": "r1/s5103",
    "alpha-monster": "r3/s5111", "background-dweller": "r3/s5113", "herbivore": "r3/s5112",
}
FRAME_STYLE = 1
BACK = ("r1/back-s5202.png", ["r1/back-s5203.png", "r1/back-s5201.png"])
TROPHY = ("r1/trophy-s5301.png", ["r1/trophy-s5303.png", "r1/trophy-s5302.png"])
POOF = "r1/poof-s5402.png"

# 小立绘（64）和小图标（32）：pixflux 用缩小立绘作 init 重画，第一个种子都合格
MINI = {f"{k}-{m}": f"r2/{'mini64' if k == 'mini' else 'mini32'}-{m}-s6101.png" for m in MON for k in ("mini", "icon")}
# 待机动画：(帧目录, 帧序) —— 第 8 帧和首帧一样，去掉，0..7 循环
IDLE = {m: (f"r2/anim/idle-{m}-{s}", list(range(8))) for m, s in
        {"deer": "s6202", "jelly": "s6202", "robot": "s6201", "cloud": "s6202", "moss": "s6201", "crab": "s6201"}.items()}

COVERS = ["r3/cover-night-s5702.png", "r3/cover-day-s5702.png", "r1/cover-s5602.png", "r1/cover-s5601.png"]
