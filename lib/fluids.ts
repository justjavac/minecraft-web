// 流体传播（水源 + 流水 1-7 级）：队列驱动、每 tick 限量。v1 只传播不消退

import { AIR, BLOCK_BY_KEY, BLOCKS, isLavaId, isWaterId, WATER, WATER_FLOW_1, type BlockId } from './blocks';
import type { World } from './world';

const FLOW_BASE = WATER_FLOW_1;
const FLOW_MAX = FLOW_BASE + 6; // WATER_FLOW_7

/** 水位等级：源 0，流水 1-7；非水返回 -1 */
export function waterLevel(id: BlockId): number {
  if (id === WATER) return 0;
  if (id >= FLOW_BASE && id <= FLOW_MAX) return id - FLOW_BASE + 1;
  return -1;
}

const pending = new Set<string>();

/** 方块变动时把自身与邻居加入流体检查队列（world.setBlock 统一调用） */
export function enqueueFluid(x: number, y: number, z: number): void {
  pending.add(`${x},${y},${z}`);
  pending.add(`${x + 1},${y},${z}`);
  pending.add(`${x - 1},${y},${z}`);
  pending.add(`${x},${y},${z + 1}`);
  pending.add(`${x},${y},${z - 1}`);
  pending.add(`${x},${y - 1},${z}`);
}

export function fluidQueueSize(): number {
  return pending.size;
}

/**
 * 每 ~0.4s 调用一次：从队列取最多 budget 个水系格子尝试传播。
 * 规则（对齐 MC 观感）：下方为空则流下（源产生 1 级流、流水等级不变——瀑布水柱）；
 * 落地后向四方扩散（等级 +1，至多 7 级）
 */
export function tickFluids(world: World, budget = 128): void {
  if (pending.size === 0) return;
  let drained = 0;
  for (const key of pending) {
    if (drained >= budget) break;
    pending.delete(key);
    drained++;
    const [x, y, z] = key.split(',').map(Number);
    const id = world.getBlock(x, y, z);
    const level = waterLevel(id);
    if (level < 0) continue;
    // 水与岩浆源接触：岩浆变黑曜石（MC 规则；本游戏岩浆只有源头）
    const obsidian = BLOCK_BY_KEY.obsidian.id;
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
      if (isLavaId(world.getBlock(x + dx, y + dy, z + dz))) {
        world.setBlock(x + dx, y + dy, z + dz, obsidian);
      }
    }
    // 消退（仅流水）：上方供水 或 同级上游（level-1）邻居，缺失则退化为空气（MC 规则）
    if (level > 0 && !isWaterId(world.getBlock(x, y + 1, z))) {
      const parentLevel = level - 1;
      const hasParent = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(
        ([dx, dz]) => waterLevel(world.getBlock(x + dx, y, z + dz)) === parentLevel,
      );
      if (!hasParent) {
        world.setBlock(x, y, z, AIR);
        continue;
      }
    }
    // 无限水源（MC 规则）：水平两侧都是水源 且 下方是水源或实心方块 → 本格成源
    if (level > 0) {
      const sources = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(
        ([dx, dz]) => world.getBlock(x + dx, y, z + dz) === WATER,
      ).length;
      if (sources >= 2) {
        const below = world.getBlock(x, y - 1, z);
        if (below === WATER || BLOCKS[below]?.opaque) {
          world.setBlock(x, y, z, WATER);
          continue;
        }
      }
    }
    if (world.getBlock(x, y - 1, z) === AIR) {
      world.setBlock(x, y - 1, z, level === 0 ? FLOW_BASE : FLOW_BASE + level - 1);
      pending.add(`${x},${y - 1},${z}`);
      continue;
    }
    if (level < 7) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (world.getBlock(x + dx, y, z + dz) === AIR) {
          world.setBlock(x + dx, y, z + dz, FLOW_BASE + level);
          pending.add(`${x + dx},${y},${z + dz}`);
        }
      }
    }
  }
}
