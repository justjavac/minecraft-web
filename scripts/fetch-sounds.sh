#!/usr/bin/env bash
# 从 luanti-org/minetest_game 拉取音效（媒体资源 CC BY-SA 3.0）
# 用法：bash scripts/fetch-sounds.sh
set -euo pipefail

BASE="https://raw.githubusercontent.com/luanti-org/minetest_game/master/mods/default/sounds"
OUT="$(cd "$(dirname "$0")/.." && pwd)/public/sounds"
mkdir -p "$OUT"

FILES=(
  # 挖掘
  default_dig_cracky.1.ogg default_dig_cracky.2.ogg default_dig_cracky.3.ogg
  default_dig_choppy.1.ogg default_dig_choppy.2.ogg default_dig_choppy.3.ogg
  default_break_glass.1.ogg default_break_glass.2.ogg default_break_glass.3.ogg
  default_dug_node.1.ogg default_dug_node.2.ogg
  # 放置
  default_place_node.1.ogg default_place_node.2.ogg default_place_node.3.ogg
  default_place_node_hard.1.ogg default_place_node_hard.2.ogg
  # 脚步
  default_grass_footstep.1.ogg default_grass_footstep.2.ogg default_grass_footstep.3.ogg
  default_dirt_footstep.1.ogg default_dirt_footstep.2.ogg
  default_sand_footstep.1.ogg default_sand_footstep.2.ogg default_sand_footstep.3.ogg
  default_hard_footstep.1.ogg default_hard_footstep.2.ogg default_hard_footstep.3.ogg
  default_wood_footstep.1.ogg default_wood_footstep.2.ogg
)

for f in "${FILES[@]}"; do
  echo "fetch $f"
  curl -fsSL "$BASE/$f" -o "$OUT/$f"
done

cat > "$OUT/CREDITS.md" <<'EOF'
# 音效署名 / Sound Credits

本目录下的音效来自 Luanti（原 Minetest）官方基础游戏 **Minetest Game**：

- 来源：https://github.com/luanti-org/minetest_game （`mods/default/sounds/`）
- 许可证：媒体资源采用 [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)
- 作者：Various Minetest Game developers（详见上游仓库 `LICENSE.txt`）
EOF

echo "done -> $OUT"
