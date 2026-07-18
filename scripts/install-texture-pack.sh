#!/usr/bin/env bash
# 把现代 MC 贴图包（如 Faithful 32x）安装为本地默认贴图。
# 贴图复制到 public/textures/pack/（该目录已被 .gitignore 忽略，不会提交入库），
# 仓库只包含本脚本与加载逻辑——第三方贴图不分发，用户对自己合法获得的贴图行使私人使用权。
# 用法：bash scripts/install-texture-pack.sh <贴图包目录>（需包含 assets/minecraft/textures/block/）
set -euo pipefail

SRC="${1:?用法: bash scripts/install-texture-pack.sh <贴图包目录>}"
BLOCK="$SRC/assets/minecraft/textures/block"
if [ ! -d "$BLOCK" ]; then
  echo "错误：找不到 $BLOCK（需要现代 MC 贴图包结构）" >&2
  exit 1
fi

OUT="$(cd "$(dirname "$0")/.." && pwd)/public/textures/pack"
mkdir -p "$OUT"

# tile 索引:文件名（与 lib/texturepack.ts 的映射一致）
MAP=(
  0:grass_block_top 1:grass_block_side 2:dirt 3:stone 4:cobblestone
  5:sand 6:oak_log 7:oak_log_top 8:oak_planks 9:oak_leaves
  10:glass 11:bricks 12:water_still
)

for pair in "${MAP[@]}"; do
  i="${pair%%:*}"
  name="${pair#*:}"
  if [ ! -f "$BLOCK/$name.png" ]; then
    echo "错误：缺少 $BLOCK/$name.png" >&2
    exit 1
  fi
  if [ "$name" = "water_still" ]; then
    # 动画条带（32x1024）只取首帧正方形
    python - "$BLOCK/$name.png" "$OUT/$i.png" <<'EOF'
import sys
from PIL import Image
im = Image.open(sys.argv[1])
im.crop((0, 0, im.width, im.width)).save(sys.argv[2])
EOF
  else
    cp "$BLOCK/$name.png" "$OUT/$i.png"
  fi
done

echo "done -> $OUT（已 gitignore，不会入库；刷新页面生效）"
