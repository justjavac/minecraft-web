// 从本地现代 MC 贴图包提取全部已注册贴图到 public/textures/pack/
// 数据源：lib/blocks.ts 的 TILE_STEMS（atlas 格号 ↔ 文件名一一对应）
// 用法：pnpm tsx scripts/build-pack.ts <贴图包目录>（需包含 assets/minecraft/textures/block/）
// 注意：water_still 动画条带由 python+PIL 裁首帧（与方块动画一致处理）

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TILE_STEMS } from '../lib/blocks';

const SRC = process.argv[2];
if (!SRC) {
  console.error('用法: pnpm tsx scripts/build-pack.ts <贴图包目录>');
  process.exit(1);
}
const BLOCK = `${SRC}/assets/minecraft/textures/block`;
if (!existsSync(BLOCK)) {
  console.error(`错误：找不到 ${BLOCK}（需要现代 MC 贴图包结构）`);
  process.exit(1);
}

const OUT = fileURLToPath(new URL('../public/textures/pack/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const missing: string[] = [];
for (const [i, stem] of TILE_STEMS.entries()) {
  const src = `${BLOCK}/${stem}.png`;
  if (!existsSync(src)) {
    missing.push(stem);
    continue;
  }
  if (stem === 'water_still') {
    // 动画条带（32x1024）只取首帧正方形；完整条带另存为 water_still.png 供水面动画用
    execFileSync('python', [
      '-c',
      'import sys; from PIL import Image; im = Image.open(sys.argv[1]); im.crop((0, 0, im.width, im.width)).save(sys.argv[2]); im.save(sys.argv[3])',
      src,
      `${OUT}/${i}.png`,
      `${OUT}/../water_still.png`,
    ]);
  } else {
    copyFileSync(src, `${OUT}/${i}.png`);
  }
}

console.log(`tiles: ${TILE_STEMS.length}, copied: ${TILE_STEMS.length - missing.length}, missing: ${missing.length}`);
if (missing.length > 0) {
  console.error(`缺失文件：\n  ${missing.join('\n  ')}`);
  process.exit(1);
}

// 合成单文件 atlas（8 列网格，运行时一次请求替代逐 tile 请求）
execFileSync('python', [
  '-c',
  `import sys
from PIL import Image
COLS, PX, N = 8, 32, int(sys.argv[1])
rows = (N + COLS - 1) // COLS
atlas = Image.new('RGBA', (COLS * PX, rows * PX))
for i in range(N):
    im = Image.open(f'{sys.argv[2]}/{i}.png')
    atlas.paste(im, ((i % COLS) * PX, (i // COLS) * PX))
atlas.save(sys.argv[3])`,
  String(TILE_STEMS.length),
  OUT,
  `${OUT}/../atlas.png`,
]);
console.log(`atlas: ${OUT}/../atlas.png`);
