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
    // 动画条带（32x1024）只取首帧正方形
    execFileSync('python', [
      '-c',
      'import sys; from PIL import Image; im = Image.open(sys.argv[1]); im.crop((0, 0, im.width, im.width)).save(sys.argv[2])',
      src,
      `${OUT}/${i}.png`,
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
