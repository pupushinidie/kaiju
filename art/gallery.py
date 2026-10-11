"""写不阻塞的画廊拍板 JSON：~/projects/pipeline/games/kingoftokyo/assets/gallery-decision.json。
小图先放大成预览（左夜色底、右白底）放在 out/gallery/。推荐项 = picks.py 里的定稿。
"""
import json, pathlib
from PIL import Image
import picks
from cards_data import CARDS
from cards import frame, compose

ART = pathlib.Path(__file__).parent
OUT = ART / "out"
G = OUT / "gallery"; G.mkdir(parents=True, exist_ok=True)
DEST = ART.parent / "assets" / "gallery-decision.json"
NIGHT, DAY = (45, 41, 113, 255), (250, 248, 240, 255)


def split(srcs, name, k):
    ims = [Image.open(OUT / s if not str(s).startswith("/") else s).convert("RGBA") for s in srcs]
    w = sum(i.width for i in ims) + 4 * (len(ims) + 1); h = max(i.height for i in ims) + 8
    S = Image.new("RGBA", (w * 2, h), NIGHT); S.paste(DAY, (w, 0, w * 2, h))
    for half in (0, 1):
        x = half * w + 4
        for im in ims:
            S.alpha_composite(im, (x, 4)); x += im.width + 4
    S = S.resize((S.width * k, S.height * k), Image.NEAREST)
    p = G / f"{name}.png"; S.save(p); return str(p)


def big(src, name, k):
    im = Image.open(OUT / src).convert("RGB")
    p = G / f"{name}.png"; im.resize((im.width * k, im.height * k), Image.NEAREST).save(p); return str(p)


def opt(value, label, images, desc="", rec=False):
    o = {"value": value, "label": label, "images": images, "description": desc}
    if rec:
        o["recommended"] = True
    return o


Q = []


def q(qid, question, options, help_=""):
    d = {"id": qid, "type": "choice", "question": question, "options": options, "allowOther": True, "required": False}
    if help_:
        d["help"] = help_
    Q.append(d)


# 牌桌示意
q("overview", "整体效果（示意拼图，不是界面设计）", [
    opt("ok", "整套就这样", [str(OUT / "mock-night.png"), str(OUT / "mock-day.png")], "用定稿素材按桌面 2 倍拼的牌桌示意：左边 6 个玩家（最下面是出局的灰色头像），中间城心（团团鹿）和港湾（钳钳蟹），骰子一排，右边市场 3 张卡和牌堆。上夜间、下白天", True)],
  "想整体换风格或者某样不满意，选「其他」写备注；单样素材在下面各题里换")

# 背景
DESC_BG = {"r1/bg-night-s2103.png": "推荐：桌面中间空出一块大托盘，台灯暖光、窗外夜景，界面放上去不挡主体；没有字",
           "r1/bg-night-s2101.png": "托盘上有格线，界面叠上去会显得乱",
           "r1/bg-night-s2102.png": "托盘四周摆了一圈彩色棋子，有点挤",
           "r1/bg-day-s2202.png": "推荐：同样空出中间托盘，阳光、窗外蓝天，干净",
           "r1/bg-day-s2201.png": "桌面摆满棋子，太挤",
           "r1/bg-day-s2203.png": "左上角有两个像字的白色图形（乱码），不用"}
for k, title in (("night", "夜间背景（默认主题）"), ("day", "白天背景")):
    rec, alts = picks.BG[k]
    q(f"bg-{k}", title, [opt(s.split("/")[-1][:-4], s.split("/")[-1][3:-4], [str(OUT / s)], DESC_BG.get(s, ""), s == rec) for s in [rec] + alts])

# 城市板
bopts = []
for s in [picks.BOARD_SEED] + picks.BOARD_ALT:
    img = split([f"r1/board-heart-{s}.png", f"r1/board-harbor-{s}.png"], f"board-{s}", 2)
    d = {"s4103": "推荐：六角底座，绿地上一圈糖果色小楼，中间奶油色大广场正好站怪兽；港湾同一批，灯塔、码头、小船，两块一看就是一套",
         "s4101": "八角形浅色底座，楼少，广场是一圈灰色环形路",
         "s4102": "方形底座、楼偏蓝白，港湾和城心不太像一套",
         "s4104": "灰紫色石头城，颜色偏冷，不够糖果感"}[s]
    bopts.append(opt(s, s, [img], d, s == picks.BOARD_SEED))
q("board", "城市板：城心 + 港湾（一套，不混搭）", bopts, "左边城心、右边港湾；每张图左半夜色底、右半白底")

# 怪兽
MDESC = {
    "deer": {"s3101": "推荐：和开工样张那只一致，长毛、鹿角、小尖牙", "s3102": "偏浅橙，耳朵像狐狸", "s3103": "像伊布/狐狸，有像知名角色的风险，不用", "s3104": "颜色接近推荐那张，脸更平"},
    "jelly": {"s3101": "颜色像百变怪，不用", "s3102": "嘴太大，表情夸张", "s3103": "推荐：头顶小泡泡、大眼睛、亮紫色，最好认", "s3104": "淡紫偏灰"},
    "robot": {"s3101": "深青色圆筒，和苔石墩的绿靠得近", "s3102": "细长罐子，脸像屏幕", "s3103": "罐头造型好，但颜色偏暗", "s3104": "推荐：最亮的青色、圆舷窗眼和两根天线，和其他五只差别最大"},
    "cloud": {"s3101": "闪电角不明显，轮廓不像云", "s3102": "云朵形不错，少了闪电", "s3103": "像小鸡", "s3104": "推荐：胖云朵 + 两只闪电角 + 头顶电火花，一看就是雷云"},
    "moss": {"s3101": "推荐：深绿苔藓石头墩、头顶小蘑菇，深绿和其他颜色最分得开", "s3102": "亮绿史莱姆坐在石头上，不像石头", "s3103": "头顶石头和蘑菇，偏暗", "s3104": "头顶粉花，比较像仙人掌"},
    "crab": {"s3101": "推荐：圆滚滚、白肚皮、钳子清楚", "s3102": "浅蓝，钳子小", "s3103": "深蓝，表情凶一点", "s3104": "眼柄和钳子都不错，脸偏小"},
}
for m in picks.MON:
    opts = []
    for s in (3101, 3102, 3103, 3104):
        tag = f"s{s}"
        imgs = [split([f"r1/mon-{m}-{tag}.png"], f"mon-{m}-{tag}", 2)]
        rec = tag == picks.MON[m]
        if rec:
            src_dir = picks.IDLE[m][0]
            gif = OUT / "animpreview" / f"{pathlib.Path(src_dir).name}.gif"
            imgs += [str(gif), split([f"r2/mini64-{m}-s6101.png", f"r2/mini32-{m}-s6101.png"], f"mini-{m}", 3)]
        opts.append(opt(tag, tag, imgs, MDESC[m][tag] + ("（第 2 张是待机动画，第 3 张是 64/32 小头像）" if rec else ""), rec))
    q(f"monster-{m}", f"怪兽 {picks.MON_NAME[m]}（{m}，队伍色 {picks.MON_COLOR[m]}）", opts, "名字是建议，可以改；外观都是原创，查过不像哥斯拉、金刚、原版怪兽、宝可梦")

# 卡框
fopts = []
art = Image.open(OUT / "r1" / "card-skyscraper-s5103.png")
for st, d in ((1, "推荐：纯色边框，最干净，文字区大"), (2, "边框上一圈小铆钉"), (3, "糖果斜纹边框，花一点")):
    S = Image.new("RGBA", (96 * 2 + 12, 136 + 8), NIGHT)
    S.alpha_composite(compose(frame("K", st), art), (4, 4)); S.alpha_composite(compose(frame("D", st), art), (104, 4))
    p = G / f"frame-v{st}.png"; S.resize((S.width * 3, S.height * 3), Image.NEAREST).save(p)
    fopts.append(opt(f"v{st}", f"样式 {st}", [str(p)], d + "。左 KEEP（薄荷）右 DISCARD（珊瑚）；左上绿徽章写费用，名字条和效果区由界面写字", st == picks.FRAME_STYLE))
q("card-frame", "超能力卡卡框（代码画）", fopts)

# 图标和标记
INAME = {"icons/energy": "能量块", "icons/heart": "生命", "icons/star": "胜利分", "icons/claw": "爪（攻击）", "icons/crown": "城心之主",
         "tokens/poison": "中毒标记", "tokens/shrink": "缩小标记", "tokens/smoke": "烟雾标记", "tokens/mimic": "模仿标记"}
for rel, (grp, i0, alts) in picks.ICONS.items():
    opts = []
    for i in [i0] + alts:
        src = pathlib.Path(grp) / (f"{grp}.png" if i == 0 else f"{grp}-{i}.png")
        img = split([pathlib.Path("r1") / src], f"{grp}-{i}", 4)
        opts.append(opt(f"{grp}-{i}", f"#{i}", [img], "推荐" if i == i0 else "", i == i0))
    q(rel.replace("/", "-"), f"{INAME[rel]}图标（32×32，64 个候选里挑的 3 个）", opts)

# 骰子（只有一版，给他看）
q("dice", "骰子（代码画，数字准确，只有一版）", [opt("ok", "就用这套", [str(OUT / "dice-preview.png")], "上排基础骰（象牙白），下排额外骰（绿）；1/2/3 是代码像素字，能量/心/爪用上面挑的图标；最后一格是掷骰动画用的空骰身", True)])

# 牌背、奖杯、封面
q("card-back", "牌堆背面", [opt(s.split("/")[-1][:-4], s.split("/")[-1][:-4], [big(s, s.split("/")[-1][:-4], 3)],
                              {"r1/back-s5202.png": "推荐：深紫底、薄荷绿爪印徽章，干净", "r1/back-s5203.png": "四角绿点，爪印小一点", "r1/back-s5201.png": "两个角上有像扑克牌角标的「Q」形，算乱码字，不用"}[s], s == picks.BACK[0])
                          for s in [picks.BACK[0]] + picks.BACK[1]])
q("trophy", "结算奖杯", [opt(s.split("/")[-1][:-4], s.split("/")[-1][:-4], [split([s], s.split("/")[-1][:-4], 4)],
                          {"r1/trophy-s5301.png": "推荐：底座上有一圈小城市", "r1/trophy-s5303.png": "底座有粉色小楼和星光", "r1/trophy-s5302.png": "最简单"}[s], s == picks.TROPHY[0])
                      for s in [picks.TROPHY[0]] + picks.TROPHY[1]])
q("fx", "特效动画（代码画 + PixelLab 烟团，只有一版）", [opt("ok", "就用这套", [str(OUT / "fxpreview" / f"{n}.gif") for n in ("claw", "enter", "ko")],
                                                       "爪击（三道爪痕）、进城（落地尘土 + 金星）、出局（「噗」一团烟 + 转圈星星）；左半夜色底、右半白底", True)])
CDESC = {"r3/cover-night-s5702.png": "推荐：用定稿素材拼图再重画——团团鹿站在城心上，另外五只围着，夜里台灯下；怪兽和游戏里一模一样",
         "r3/cover-day-s5702.png": "同一构图的白天版",
         "r1/cover-s5602.png": "戴王冠的鹿怪站在山头，三只怪兽来挑战（怪兽和游戏里的不完全一样）",
         "r1/cover-s5601.png": "三只怪兽站在城市木台上（怪兽和游戏里的不完全一样）"}
q("cover", "大厅封面（384×192，没有字、没有人）", [opt(c.split("/")[-1][:-4], c.split("/")[-1][:-4], [str(OUT / "covers" / c.split("/")[-1])], CDESC[c], i == 0)
                                               for i, c in enumerate(picks.COVERS)])

# 卡面插图：每种一题
for cid, cn, t, cost, n, d in CARDS:
    rec = picks.CARD[cid]
    cands = []
    for r, ss in (("r1", (5101, 5102, 5103)), ("r3", (5111, 5112, 5113))):
        for s in ss:
            p = OUT / r / f"card-{cid}-s{s}.png"
            if p.exists() and Image.open(p).convert("RGB").getextrema() != ((0, 0), (0, 0), (0, 0)):
                cands.append(f"{r}/s{s}")
    opts = []
    for c in cands:
        r, s = c.split("/")
        img = big(f"{r}/card-{cid}-{s}.png", f"card-{cid}-{s}", 3)
        note = ""
        if c == rec:
            note = "推荐"
        elif r == "r1" and any(x.startswith("r3") for x in cands):
            note = "第一版，自查不合格（像知名角色/看不懂），已重画"
        opts.append(opt(c.replace("/", "-"), c, [img], note, c == rec))
    q(f"card-{cid}", f"卡面插图：{cn}（{'保留' if t == 'K' else '一次性'}，{cost} 能量{'，两张同图' if n == 2 else ''}）", opts)

doc = {
    "id": "art-gallery", "title": "巨兽之城：正式美术画廊", "stage": "art", "blocking": False,
    "intro": ("巨兽之城正式美术（方向 B · Q 版桌面沙盘）的候选，每样一题。标「推荐」的是美术自查后挑定、已经导出到 "
              "~/projects/pipeline/games/kingoftokyo/art/out/final 的那张，不选就按推荐上线；想换哪张随时来换，都不满意选「其他」写备注，美术重画。\n\n"
              "图里一律没有字：卡名、费用、效果、骰子数字、生命分数能量都由界面写。骰子、卡框、特效是代码画的，只有一版。"
              "小图预览左半夜色底、右半白底。第一题是用定稿拼的牌桌示意（不是界面设计）。61 种超能力卡各一题，排在最后。"),
    "questions": Q,
}
DEST.write_text(json.dumps(doc, ensure_ascii=False, indent=1))
print(DEST, len(Q), "题")
