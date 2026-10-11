"""代码画的部分共用：调色板、圆角矩形、像素数字。"""
from PIL import Image, ImageDraw


def hx(h, a=255):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (a,)


P = {
    "ink": "#2a1d33",
    "cream": "#fbefd0", "parch": "#fdf6e3", "parch2": "#efe2c4",
    "mint": "#5fbfa6", "mint_l": "#a8e6cf", "mint_d": "#3e8f7d",
    "coral": "#e17455", "coral_l": "#f4a98b", "coral_d": "#a8483a",
    "en": "#5ccf6b", "en_l": "#b8f28a", "en_d": "#2e7d4a",
    "ivory": "#fbf3e4", "ivory_l": "#ffffff", "ivory_d": "#e0cfb5", "ivory_side": "#c9b394",
    "green": "#6cc76a", "green_l": "#a6e88e", "green_d": "#3f9a50", "green_side": "#2e7d4a",
    "gold": "#ffc83d", "gold_d": "#c98a1c",
}
C = {k: hx(v) for k, v in P.items()}


def rounded_mask(w, h, r):
    """像素风圆角：返回 w×h 的布尔表（True 在形状内）。"""
    m = [[True] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            for cx, cy in ((r - 0.5, r - 0.5), (w - r - 0.5, r - 0.5), (r - 0.5, h - r - 0.5), (w - r - 0.5, h - r - 0.5)):
                inx = (x < r and cx == r - 0.5) or (x >= w - r and cx == w - r - 0.5)
                iny = (y < r and cy == r - 0.5) or (y >= h - r and cy == h - r - 0.5)
                if inx and iny and (x - cx) ** 2 + (y - cy) ** 2 > (r) ** 2 - 0.5:
                    m[y][x] = False
    return m


def fill_mask(im, ox, oy, m, col):
    px = im.load()
    for y, row in enumerate(m):
        for x, v in enumerate(row):
            if v:
                px[ox + x, oy + y] = col


def outline_of(m):
    """形状内、但四邻有形状外的点。"""
    h, w = len(m), len(m[0])
    out = []
    for y in range(h):
        for x in range(w):
            if not m[y][x]:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if not (0 <= nx < w and 0 <= ny < h) or not m[ny][nx]:
                    out.append((x, y)); break
    return out


def rrect(im, x, y, w, h, r, fill, outline=None, hi=None, lo=None):
    """圆角矩形：outline 1px，hi 左上内沿高光，lo 右下内沿暗边。"""
    m = rounded_mask(w, h, r)
    fill_mask(im, x, y, m, fill)
    px = im.load()
    if hi or lo:
        edge = set(outline_of(m))
        inner = [[m[j][i] and (i, j) not in edge for i in range(w)] for j in range(h)]
        for (i, j) in outline_of(inner):
            bottom_right = j >= h - r - 1 or i >= w - r - 1
            top_left = j <= r or i <= r
            if lo and bottom_right and not (top_left and (j < h // 2 and i < w // 2)):
                px[x + i, y + j] = lo
            elif hi and top_left and not bottom_right:
                px[x + i, y + j] = hi
    if outline:
        for (i, j) in outline_of(m):
            px[x + i, y + j] = outline
    return m


# 5×8 像素数字（再放大 2 倍画到骰子上）
DIGITS = {
    "1": ["..##..", ".###..", "####..", "..##..", "..##..", "..##..", "..##..", "..##..", "######", "######"],
    "2": [".####.", "##..##", "....##", "....##", "...##.", "..##..", ".##...", "##....", "######", "######"],
    "3": [".####.", "##..##", "....##", "....##", "..###.", "..###.", "....##", "##..##", "##..##", ".####."],
}


def draw_digit(im, ch, x, y, scale, col, outline=None, shadow=None):
    g = DIGITS[ch]
    px = im.load()
    pts = set()
    for j, row in enumerate(g):
        for i, c in enumerate(row):
            if c == "#":
                for a in range(scale):
                    for b in range(scale):
                        pts.add((x + i * scale + a, y + j * scale + b))
    if outline:
        for (u, v) in pts:
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    q = (u + dx, v + dy)
                    if q not in pts:
                        px[q] = outline
    if shadow:
        for (u, v) in pts:
            q = (u + 1, v + 1)
            if q not in pts:
                px[q] = shadow
    for q in pts:
        px[q] = col
