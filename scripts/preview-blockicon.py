#!/usr/bin/env python3
"""一次性预览脚本：镜像 lib/blockIcon3d.ts 的等轴 3D 投影数学，
从 public/textures/atlas.png 直接渲染代表性方块的 3D 图标供人工检查。
用法：python3 scripts/preview-blockicon.py  →  /tmp/blockicon3d-preview.png
上行 = 平面 side tile（现状），下行 = 等轴 3D 图标（新）。"""

import json
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = '/tmp/blockicon3d-preview.png'

# 文件 atlas：8 列、32px 格、无挤出，格顺序 = atlas.json stem 清单（见 textures.ts drawTile）
COLS, N = 8, 32
stems = json.load(open(os.path.join(ROOT, 'public/textures/atlas.json')))
atlas = Image.open(os.path.join(ROOT, 'public/textures/atlas.png')).convert('RGBA')
px = atlas.load()

S = N * 2  # 输出图标边长（同 blockIcon3d.ts：S = tilePx * 2）
s = S // 2

def tile_src(stem):
    i = stems.index(stem)
    return (i % COLS) * N, (i // COLS) * N

def render(top_stem, side_stem):
    """与 blockIcon3d.ts 相同的三面变换（逆映射采样，nearest）；光照 顶1.0/左0.8/右0.6"""
    tx, ty = tile_src(top_stem)
    fx, fy = tile_src(side_stem)
    out = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = out.load()

    def shade(src_x, src_y, u, v, bright, dx, dy):
        r, g, b, a = px[src_x + u, src_y + v]
        if a == 0:
            return
        d[dx, dy] = (int(r * bright), int(g * bright), int(b * bright), a)

    for dy in range(S):
        for dx in range(S):
            # 左面：dx=x, dy=0.5x+y+S/4 → x=dx, y=dy-0.5dx-S/4
            x, y = dx, dy - 0.5 * dx - S / 4
            if 0 <= x < s and 0 <= y < s:
                shade(fx, fy, int(x * N / s), int(y * N / s), 0.8, dx, dy)
            # 右面：dx=x+s, dy=-0.5x+y+S/2 → x=dx-s, y=dy+0.5(dx-s)-S/2
            x = dx - s
            y = dy + 0.5 * x - S / 2
            if 0 <= x < s and 0 <= y < s:
                shade(fx, fy, int(x * N / s), int(y * N / s), 0.6, dx, dy)
            # 顶面：dx=x+y, dy=-0.5x+0.5y+S/4 → y=(dx+2dy-S/2)/2, x=dx-y
            y = (dx + 2 * dy - S / 2) / 2
            x = dx - y
            if 0 <= x < s and 0 <= y < s:
                shade(tx, ty, int(x * N / s), int(y * N / s), 1.0, dx, dy)
    return out

# 代表性方块：草方块（top/side 不同色）、石头、南瓜（side/top 不同）、玻璃（镂空）
BLOCKS = [
    ('grass_block_top', 'grass_block_side'),
    ('stone', 'stone'),
    ('pumpkin_top', 'pumpkin_side'),
    ('glass', 'glass'),
]

GAP = 16
W = len(BLOCKS) * (S + GAP) + GAP
H = 2 * (S + GAP) + GAP
sheet = Image.new('RGBA', (W, H), (43, 43, 43, 255))
for i, (top, side) in enumerate(BLOCKS):
    ox = GAP + i * (S + GAP)
    flat = atlas.crop((tile_src(side)[0], tile_src(side)[1], tile_src(side)[0] + N, tile_src(side)[1] + N)).resize((S, S), Image.NEAREST)
    sheet.paste(flat, (ox, GAP), flat)
    sheet.paste(render(top, side), (ox, GAP + S + GAP), render(top, side))
sheet = sheet.resize((W * 2, H * 2), Image.NEAREST)
sheet.save(OUT)
print(OUT)
