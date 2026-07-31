// 小麦作物生长与耕地维护：随机刻推进 8 阶段；耕地水润湿加速、干旱退化、生长需光照

import { AIR, BLOCK_BY_KEY, BLOCKS, isWaterId, WHEAT_CROP_0, type BlockId } from './blocks';
import { dayFactorAt, worldClock } from './game';
import { WORLD_HEIGHT } from './grid';
import type { World } from './world';
import { registerWorldScope } from './worldScope';

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

/** 每 tick 最多处理的耕地数（湿润检查每块要扫 9×9×2，限量避免大农场卡顿） */
const FARMLAND_BATCH = 64;

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

/** 清空作物/耕地登记（切换世界时调用） */
export function clearCrops(): void {
  crops.clear();
  farmlands.clear();
}

/**
 * chunk 首次进入世界（新生成/读档恢复）或数据被存档整体替换时重扫登记：
 * 世界生成与存档恢复都直写 chunk data，不走 world.setBlock 钩子，登记只能事后补扫。
 * 幂等（重复扫描只是重复 add）；数据替换留下的失效登记由 tickCrops 自检除名，无需在此对账。
 */
export function rescanCropsChunk(world: World, cx: number, cz: number): void {
  const c = world.chunks.get(`${cx},${cz}`);
  if (!c) return;
  const bx = cx << 4;
  const bz = cz << 4;
  // localIndex 公式与 world.ts 一致（此处内联避免运行时循环依赖）
  for (let y = 0; y < WORLD_HEIGHT; y++) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const id = c.data[(y * 16 + z) * 16 + x];
        if (isWheatCropId(id)) crops.add(key(bx + x, y, bz + z));
        else if (isFarmlandId(id)) farmlands.add(key(bx + x, y, bz + z));
      }
    }
  }
}

/**
 * 每 ~2s 调用：
 * - 耕地：4 格内有水变湿润（作物 2 倍速），干旱且空着的缓慢退化回泥土；
 *   每 tick 限量处理 FARMLAND_BATCH 块（大农场分摊到多个 tick，避免主线程卡顿），
 *   处理完仍有效的重新加到 Set 尾部，天然形成轮转游标
 * - 作物：光照 ≥9 才生长（白天靠天光，夜里靠火把），下方耕地没了则消失
 */
export function tickCrops(world: World, dt: number): void {
  growAcc += dt;
  if (growAcc < 2) return;
  growAcc = 0;
  const dryId = BLOCK_BY_KEY.farmland.id;
  const moistId = BLOCK_BY_KEY.farmland_moist.id;
  const dirtId = BLOCK_BY_KEY.dirt.id;

  const batch: string[] = [];
  for (const k of farmlands) {
    if (batch.length >= FARMLAND_BATCH) break;
    batch.push(k);
  }
  for (const k of batch) {
    farmlands.delete(k);
    const [x, y, z] = k.split(',').map(Number);
    if (!world.chunks.has(`${x >> 4},${z >> 4}`)) {
      farmlands.add(k); // 未加载的保留登记（移到队尾），本轮不算湿润
      continue;
    }
    const id = world.getBlock(x, y, z);
    if (!isFarmlandId(id)) continue; // 已除名（delete 后不重新加入）
    const moist = hasWaterNear(world, x, y, z);
    if (moist && id === dryId) world.setBlock(x, y, z, moistId);
    else if (!moist && id === moistId) world.setBlock(x, y, z, dryId);
    if (!moist && !isWheatCropId(world.getBlock(x, y + 1, z)) && rand() < 1 / 30) {
      world.setBlock(x, y, z, dirtId); // setBlock 钩子会把 k 从 farmlands 移除
      continue;
    }
    farmlands.add(k); // 仍是耕地：重新入队尾（setBlock 湿润互换也会 add，幂等）
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

// 世界作用域自注册（lib/worldScope.ts）：作物/耕地登记随世界清理
registerWorldScope({ name: 'crops', clear: clearCrops });
