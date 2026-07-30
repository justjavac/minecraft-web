// 树苗生长与树叶凋零：树苗计时成树（MC 随机刻观感），原木断供的树叶逐级枯萎并概率掉树苗

import { AIR, BLOCKS, BLOCK_BY_KEY, isWaterId, type BlockId } from './blocks';
import { mulberry32, type TreeKind } from './noise';
import { TREE_MAX_H, writeTree } from './trees';
import { type World } from './world';
import { WORLD_HEIGHT } from './grid';

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
export const LEAF_TO_SAPLING: Record<string, string> = {
  leaves: 'oak_sapling',
  spruce_leaves: 'spruce_sapling',
  birch_leaves: 'birch_sapling',
  jungle_leaves: 'jungle_sapling',
  acacia_leaves: 'acacia_sapling',
  dark_oak_leaves: 'dark_oak_sapling',
  mangrove_leaves: 'mangrove_sapling',
  cherry_leaves: 'cherry_sapling',
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
            leafQueue.add(key(x + dx, y + dy, z + dz));
          }
        }
      }
    }
  }
}

/** 树苗长成一棵树（与世界生成同形，共用 lib/trees.ts 树形库；y 为树苗格，地表即 y-1） */
function growTree(world: World, x: number, y: number, z: number, wood: string): void {
  const kind = wood as TreeKind;
  if (y + TREE_MAX_H[kind] >= WORLD_HEIGHT) return; // 顶到世界放不下，保留树苗
  const rand = mulberry32((Math.imul(x, 374761393) ^ Math.imul(y, 2246822519) ^ Math.imul(z, 668265263)) | 0);
  const put = (px: number, py: number, pz: number, id: BlockId, onlyAir: boolean) => {
    const cur = world.getBlock(px, py, pz);
    // 树干替换空气/水/树叶/十字花草（含树苗自身），树叶只占空气/水，其他占用（箱子、屋顶等）跳过
    const ok = onlyAir
      ? cur === AIR || isWaterId(cur)
      : cur === AIR || isWaterId(cur) || isLeavesId(cur) || BLOCKS[cur]?.shape === 'cross';
    if (ok) world.setBlock(px, py, pz, id);
  };
  writeTree(put, kind, x, y - 1, z, rand);
}

let growAcc = 0;
const rand = mulberry32(0x9e3779b9);

// ——— 树叶凋零队列 ———

// Set 去重（key 格式同 saplings）：同一树叶被多根原木扫到只入队一次
const leafQueue = new Set<string>();

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
  while (budget-- > 0 && leafQueue.size > 0) {
    const k = leafQueue.values().next().value!;
    leafQueue.delete(k);
    const [x, y, z] = k.split(',').map(Number);
    const id = world.getBlock(x, y, z);
    if (!isLeavesId(id)) continue;
    if (hasLogWithin(world, x, y, z, 4)) continue;
    world.setBlock(x, y, z, AIR);
    // MC 约 5%：枯萎时掉对应树苗（掉在原地，由调用方转掉落物）
    if (rand() < 0.05) {
      const saplingKey = LEAF_TO_SAPLING[BLOCKS[id].key];
      if (saplingKey) onSaplingDrop?.(BLOCK_BY_KEY[saplingKey].id, x + 0.5, y + 0.3, z + 0.5);
    }
    // 级联：邻居树叶继续检查（浮空树叶由内向外逐级消失）
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
      if (isLeavesId(world.getBlock(x + dx, y + dy, z + dz))) {
        leafQueue.add(key(x + dx, y + dy, z + dz));
      }
    }
  }
}

/** 树苗掉落回调（actions 注入，避免循环依赖） */
let onSaplingDrop: ((id: BlockId, x: number, y: number, z: number) => void) | null = null;
export function setSaplingDropHandler(fn: typeof onSaplingDrop): void {
  onSaplingDrop = fn;
}

/** 清空树苗登记与凋零队列（切换世界时调用） */
export function clearSaplings(): void {
  saplings.clear();
  leafQueue.clear();
}
