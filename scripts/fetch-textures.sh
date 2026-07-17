#!/usr/bin/env bash
# 从 luanti-org/minetest_game 拉取 16px 体素贴图（媒体资源 CC BY-SA 3.0）
# 用法：bash scripts/fetch-textures.sh
set -euo pipefail

BASE="https://raw.githubusercontent.com/luanti-org/minetest_game/master/mods/default/textures"
OUT="$(cd "$(dirname "$0")/.." && pwd)/public/textures"
mkdir -p "$OUT"

FILES=(
  default_grass.png
  default_grass_side.png
  default_dirt.png
  default_stone.png
  default_cobble.png
  default_sand.png
  default_tree.png
  default_tree_top.png
  default_wood.png
  default_leaves.png
  default_glass.png
  default_brick.png
  default_water.png
)

for f in "${FILES[@]}"; do
  echo "fetch $f"
  curl -fsSL "$BASE/$f" -o "$OUT/$f"
done

cat > "$OUT/CREDITS.md" <<'EOF'
# 贴图署名 / Texture Credits

本目录下的贴图来自 Luanti（原 Minetest）官方基础游戏 **Minetest Game**：

- 来源：https://github.com/luanti-org/minetest_game （`mods/default/textures/`）
- 许可证：媒体资源采用 [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)
- 作者：Various Minetest Game developers（详见上游仓库 `LICENSE.txt`）

草方块侧面贴图为运行时由 `default_dirt.png` 与 `default_grass_side.png` 透明层合成。
EOF

echo "done -> $OUT"
