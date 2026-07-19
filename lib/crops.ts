// 小麦作物生长：随机刻推进 8 阶段（与树苗同节奏，登记驱动、限量，不阻塞主线程）

import { BLOCK_BY_KEY, WHEAT_CROP_0, type BlockId } from './blocks';
import type { World } from './world';

const WHEAT_CROP_7 = WHEAT_CROP_0 + 7;

/** 小麦作物判定（wheat_crop_0..7 连续 id） */
export function isWheatCropId(id: BlockId): boolean {
  return id >= WHEAT_CROP_0 && id <= WHEAT_CROP_7;
}

const crops = new Set<string>();
const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;

/** world.setBlock 钩子：登记/注销作物（生成过程直接写 data 不走这里） */
export function notifyCropBlockSet(x: number, y: number, z: number, newId: BlockId): void {
  const k = key(x, y, z);
  if (isWheatCropId(newId)) crops.add(k);
  else crops.delete(k);
}

let growAcc = 0;
let rngState = 0x85ebca6b;
function rand(): number {
  rngState = (rngState * 1103515245 + 12345) | 0;
  return ((rngState >>> 9) & 0x7fffffff) / 0x7fffffff;
}

/**
 * 每 ~2s 调用：每株 1/12 概率长一阶段（平均 ~24s 成熟）；
 * 下方耕地没了的作物直接消失（玩家破坏耕地时 actions 已负责弹种子）
 */
export function tickCrops(world: World, dt: number): void {
  growAcc += dt;
  if (growAcc < 2) return;
  growAcc = 0;
  const farmland = BLOCK_BY_KEY.farmland.id;
  for (const k of [...crops]) {
    const [x, y, z] = k.split(',').map(Number);
    if (!world.chunks.has(`${x >> 4},${z >> 4}`)) continue; // 未加载的不管
    const id = world.getBlock(x, y, z);
    if (!isWheatCropId(id) || id >= WHEAT_CROP_7) {
      crops.delete(k); // 已成熟或被移除，停止追踪
      continue;
    }
    if (world.getBlock(x, y - 1, z) !== farmland) {
      world.setBlock(x, y, z, 0);
      crops.delete(k);
      continue;
    }
    if (rand() < 1 / 12) world.setBlock(x, y, z, id + 1);
  }
}
