// 小麦作物生长与耕地维护：随机刻推进 8 阶段；耕地水润湿加速、干旱退化、生长需光照

import { AIR, BLOCK_BY_KEY, BLOCKS, isWaterId, WHEAT_CROP_0, type BlockId } from './blocks';
import { dayFactorAt, worldClock } from './game';
import type { World } from './world';

const WHEAT_CROP_7 = WHEAT_CROP_0 + 7;

/** 小麦作物判定（wheat_crop_0..7 连续 id） */
export function isWheatCropId(id: BlockId): boolean {
  return id >= WHEAT_CROP_0 && id <= WHEAT_CROP_7;
}

/** 耕地判定（干/湿两种） */
export function isFarmlandId(id: BlockId): boolean {
  const k = BLOCKS[id]?.key;
  return k === 'farmland' || k === 'farmland_moist';
}

const crops = new Set<string>();
const farmlands = new Set<string>();
const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;

/** world.setBlock 钩子：登记/注销作物与耕地（生成过程直接写 data 不走这里） */
export function notifyCropBlockSet(x: number, y: number, z: number, newId: BlockId): void {
  const k = key(x, y, z);
  if (isWheatCropId(newId)) crops.add(k);
  else crops.delete(k);
  if (isFarmlandId(newId)) farmlands.add(k);
  else farmlands.delete(k);
}

let growAcc = 0;
let rngState = 0x85ebca6b;
function rand(): number {
  rngState = (rngState * 1103515245 + 12345) | 0;
  return ((rngState >>> 9) & 0x7fffffff) / 0x7fffffff;
}

/** MC 规则：水平 4 格内（同层或高 1 层）有水则耕地湿润 */
function hasWaterNear(world: World, x: number, y: number, z: number): boolean {
  for (let dx = -4; dx <= 4; dx++) {
    for (let dz = -4; dz <= 4; dz++) {
      for (let dy = 0; dy <= 1; dy++) {
        if (isWaterId(world.getBlock(x + dx, y + dy, z + dz))) return true;
      }
    }
  }
  return false;
}

/** 作物所在格的有效光照：方块光与（白天时的）天空光取大者 */
function lightAt(world: World, x: number, y: number, z: number, day: boolean): number {
  const c = world.chunks.get(`${x >> 4},${z >> 4}`);
  if (!c) return 0;
  // localIndex 公式与 world.ts 一致（此处内联避免运行时循环依赖）
  const i = (y * 16 + (z & 15)) * 16 + (x & 15);
  return Math.max(c.light[i], day ? c.sky[i] : 0);
}

/**
 * 每 ~2s 调用：
 * - 耕地：4 格内有水变湿润（作物 2 倍速），干旱且空着的缓慢退化回泥土
 * - 作物：光照 ≥9 才生长（白天靠天光，夜里靠火把），下方耕地没了则消失
 */
export function tickCrops(world: World, dt: number): void {
  growAcc += dt;
  if (growAcc < 2) return;
  growAcc = 0;
  const dryId = BLOCK_BY_KEY.farmland.id;
  const moistId = BLOCK_BY_KEY.farmland_moist.id;
  const dirtId = BLOCK_BY_KEY.dirt.id;

  for (const k of [...farmlands]) {
    const [x, y, z] = k.split(',').map(Number);
    if (!world.chunks.has(`${x >> 4},${z >> 4}`)) continue; // 未加载的不管
    const id = world.getBlock(x, y, z);
    if (!isFarmlandId(id)) {
      farmlands.delete(k);
      continue;
    }
    const moist = hasWaterNear(world, x, y, z);
    if (moist && id === dryId) world.setBlock(x, y, z, moistId);
    else if (!moist && id === moistId) world.setBlock(x, y, z, dryId);
    if (!moist && !isWheatCropId(world.getBlock(x, y + 1, z)) && rand() < 1 / 30) {
      world.setBlock(x, y, z, dirtId);
      farmlands.delete(k);
    }
  }

  const day = dayFactorAt(worldClock.t) > 0.4;
  for (const k of [...crops]) {
    const [x, y, z] = k.split(',').map(Number);
    if (!world.chunks.has(`${x >> 4},${z >> 4}`)) continue;
    const id = world.getBlock(x, y, z);
    if (!isWheatCropId(id) || id >= WHEAT_CROP_7) {
      crops.delete(k); // 已成熟或被移除，停止追踪
      continue;
    }
    const below = world.getBlock(x, y - 1, z);
    if (!isFarmlandId(below)) {
      world.setBlock(x, y, z, AIR);
      crops.delete(k);
      continue;
    }
    if (lightAt(world, x, y, z, day) < 9) continue;
    const chance = below === moistId ? 1 / 6 : 1 / 12;
    if (rand() < chance) world.setBlock(x, y, z, id + 1);
  }
}
