// 树苗生长与树叶凋零：树苗计时成树（MC 随机刻观感），原木断供的树叶逐级枯萎并概率掉树苗

import { AIR, BLOCKS, BLOCK_BY_KEY, isWaterId, type BlockId } from './blocks';
import type { World } from './world';

/** 原木（含去皮）判定：叶子的供养来源 */
export function isLogId(id: BlockId): boolean {
  const k = BLOCKS[id]?.key;
  return k === 'log' || k?.endsWith('_log') === true;
}

/** 树叶判定 */
export function isLeavesId(id: BlockId): boolean {
  const k = BLOCKS[id]?.key;
  return k === 'leaves' || k?.endsWith('_leaves') === true;
}

/** 树叶 → 对应树苗（凋零掉落用） */
const LEAF_TO_SAPLING: Record<string, string> = {
  leaves: 'oak_sapling',
  spruce_leaves: 'spruce_sapling',
  birch_leaves: 'birch_sapling',
  jungle_leaves: 'jungle_sapling',
  acacia_leaves: 'acacia_sapling',
  dark_oak_leaves: 'dark_oak_sapling',
  mangrove_leaves: 'mangrove_sapling',
  cherry_leaves: 'cherry_sapling',
};

/** 树苗 wood key → [log, leaves] 方块 key */
const WOOD_PARTS: Record<string, [string, string]> = {
  oak: ['log', 'leaves'],
  spruce: ['spruce_log', 'spruce_leaves'],
  birch: ['birch_log', 'birch_leaves'],
  jungle: ['jungle_log', 'jungle_leaves'],
  acacia: ['acacia_log', 'acacia_leaves'],
  dark_oak: ['dark_oak_log', 'dark_oak_leaves'],
  mangrove: ['mangrove_log', 'mangrove_leaves'],
  cherry: ['cherry_log', 'cherry_leaves'],
};

// ——— 树苗追踪与生长 ———

const saplings = new Set<string>();
const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;

/** setBlock 钩子：树苗登记/注销 + 原木破坏时登记树叶检查（world.setBlock 统一调用） */
export function notifyBlockSet(world: World, x: number, y: number, z: number, oldId: BlockId, newId: BlockId): void {
  const k = key(x, y, z);
  if (BLOCKS[newId]?.treeWood) saplings.add(k);
  else saplings.delete(k);
  if (isLogId(oldId) && !isLogId(newId)) {
    // 原木没了：5 格内的树叶进入凋零检查队列
    for (let dx = -5; dx <= 5; dx++) {
      for (let dy = -5; dy <= 5; dy++) {
        for (let dz = -5; dz <= 5; dz++) {
          if (isLeavesId(world.getBlock(x + dx, y + dy, z + dz))) {
            leafQueue.push({ x: x + dx, y: y + dy, z: z + dz });
          }
        }
      }
    }
  }
}

/** 树苗长成一棵树（与世界生成同形：4 高干 + 两层叶 + 顶叶） */
function growTree(world: World, x: number, y: number, z: number, wood: string): void {
  const [logKey, leavesKey] = WOOD_PARTS[wood];
  const log = BLOCK_BY_KEY[logKey].id;
  const leaves = BLOCK_BY_KEY[leavesKey].id;
  for (let dy = 0; dy < 4; dy++) world.setBlock(x, y + dy, z, log);
  for (const ly of [y + 2, y + 3]) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        const id = world.getBlock(x + dx, ly, z + dz);
        if (id === AIR || isWaterId(id)) world.setBlock(x + dx, ly, z + dz, leaves);
      }
    }
  }
  world.setBlock(x, y + 4, z, leaves);
}

let growAcc = 0;
let rngState = 0x9e3779b9;
function rand(): number {
  rngState = (rngState * 1103515245 + 12345) | 0;
  return ((rngState >>> 9) & 0x7fffffff) / 0x7fffffff;
}

// ——— 树叶凋零队列 ———

interface LeafCheck {
  x: number;
  y: number;
  z: number;
}
const leafQueue: LeafCheck[] = [];

function hasLogWithin(world: World, x: number, y: number, z: number, r: number): boolean {
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        if (isLogId(world.getBlock(x + dx, y + dy, z + dz))) return true;
      }
    }
  }
  return false;
}

/**
 * 每 ~2s 调用：树苗按 1/25 概率成树（平均 ~50s）；凋零队列逐个检查，
 * 4 格内无原木的树叶枯萎（5% 掉对应树苗），并级联检查邻居
 */
export function tickSaplings(world: World, dt: number): void {
  growAcc += dt;
  if (growAcc < 2) return;
  growAcc = 0;

  for (const k of [...saplings]) {
    const [x, y, z] = k.split(',').map(Number);
    if (!world.chunks.has(`${x >> 4},${z >> 4}`)) continue; // 未加载的不管
    if (rand() < 1 / 25) {
      const def = BLOCKS[world.getBlock(x, y, z)];
      if (def?.treeWood) growTree(world, x, y, z, def.treeWood);
      saplings.delete(k);
    }
  }

  let budget = 64;
  while (budget-- > 0 && leafQueue.length > 0) {
    const c = leafQueue.shift()!;
    const id = world.getBlock(c.x, c.y, c.z);
    if (!isLeavesId(id)) continue;
    if (hasLogWithin(world, c.x, c.y, c.z, 4)) continue;
    world.setBlock(c.x, c.y, c.z, AIR);
    // MC 约 5%：枯萎时掉对应树苗（掉在原地，由调用方转掉落物）
    if (rand() < 0.05) {
      const saplingKey = LEAF_TO_SAPLING[BLOCKS[id].key];
      if (saplingKey) onSaplingDrop?.(BLOCK_BY_KEY[saplingKey].id, c.x + 0.5, c.y + 0.3, c.z + 0.5);
    }
    // 级联：邻居树叶继续检查（浮空树叶由内向外逐级消失）
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
      if (isLeavesId(world.getBlock(c.x + dx, c.y + dy, c.z + dz))) {
        leafQueue.push({ x: c.x + dx, y: c.y + dy, z: c.z + dz });
      }
    }
  }
}

/** 树苗掉落回调（actions 注入，避免循环依赖） */
let onSaplingDrop: ((id: BlockId, x: number, y: number, z: number) => void) | null = null;
export function setSaplingDropHandler(fn: typeof onSaplingDrop): void {
  onSaplingDrop = fn;
}
