// 流体传播（水源 + 流水 1-7 级；岩浆源 + 流动岩浆 1-7 级）：队列驱动、每 tick 限量。
// 水：传播 + 消退 + 无限水源（对齐 MC）。
// 岩浆（对齐 MC Java）：主世界/末地水平流 3 格（level 1-3）、下界 7 格（level 1-7），向下流动与水相同；
// 节奏主世界/末地每 1.5s（30 tick）一步、下界每 0.5s（10 tick）一步——sim.ts 慢节奏一拍 0.4s，
// 用本模块内部 accumulator 折算（0.4s 粒度下主世界约每 4 拍一步、下界约每 1-2 拍一步）。
// 水火反应（对齐 Java 圆石/石头/黑曜石规则）：
// - 侧向流入水的岩浆 / 水流入流动岩浆 → 圆石
// - 岩浆向下流入水 → 石头；岩浆源上方是水（水从上方浇下）→ 石头
// - 岩浆源遇侧向水 → 黑曜石
// 注：流动岩浆暂不做源头消退（同水 v1 的「只传播不消退」），挖掉源头后流岩浆保留。

import { AIR, BLOCK_BY_KEY, BLOCKS, COBBLE, isLavaId, isWaterId, LAVA, LAVA_FLOW_1, STONE, WATER, WATER_FLOW_1, type BlockId } from './blocks';
import type { World } from './world';
import { registerWorldScope } from './worldScope';

const FLOW_BASE = WATER_FLOW_1;
const FLOW_MAX = FLOW_BASE + 6; // WATER_FLOW_7

const LAVA_FLOW_BASE = LAVA_FLOW_1;
const LAVA_FLOW_MAX = LAVA_FLOW_BASE + 6; // LAVA_FLOW_7

/** 水位等级：源 0，流水 1-7；非水返回 -1 */
export function waterLevel(id: BlockId): number {
  if (id === WATER) return 0;
  if (id >= FLOW_BASE && id <= FLOW_MAX) return id - FLOW_BASE + 1;
  return -1;
}

/** 岩浆位等级：源 0，流动岩浆 1-7；非岩浆返回 -1 */
export function lavaLevel(id: BlockId): number {
  if (id === LAVA) return 0;
  if (id >= LAVA_FLOW_BASE && id <= LAVA_FLOW_MAX) return id - LAVA_FLOW_BASE + 1;
  return -1;
}

const pending = new Set<string>();

/** sim.ts 慢节奏拍长（秒）：tickFluids 每拍调用一次，本模块按拍累计模拟时间 */
const BEAT = 0.4;
/** 岩浆扩散一步的间隔（秒；MC Java：主世界/末地 30 tick，下界 10 tick） */
const LAVA_INTERVAL_NORMAL = 1.5;
const LAVA_INTERVAL_NETHER = 0.5;
let lavaAcc = 0;

/** 方块变动时把自身与邻居加入流体检查队列（world.setBlock 统一调用） */
export function enqueueFluid(x: number, y: number, z: number): void {
  pending.add(`${x},${y},${z}`);
  pending.add(`${x + 1},${y},${z}`);
  pending.add(`${x - 1},${y},${z}`);
  pending.add(`${x},${y},${z + 1}`);
  pending.add(`${x},${y},${z - 1}`);
  pending.add(`${x},${y - 1},${z}`);
  pending.add(`${x},${y + 1},${z}`); // 上方格：挖掉水下的方块，上方水才能流下补坑
}

export function fluidQueueSize(): number {
  return pending.size;
}

/** 清空流体队列与岩浆计时（切换世界时调用，防止旧坐标/旧累计带进新世界） */
export function clearFluids(): void {
  pending.clear();
  lavaAcc = 0;
}

const OBSIDIAN_ID = BLOCK_BY_KEY.obsidian.id;

/** 水格处理：水火接触反应 + 消退 + 无限水源 + 向下流 + 落地扩散 */
function tickWater(world: World, x: number, y: number, z: number, level: number, loaded: (nx: number, nz: number) => boolean): void {
  // 水火接触（MC）：侧向邻居是岩浆源 → 黑曜石；正下方是岩浆源（水浇在源上）→ 石头
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    if (!loaded(x + dx, z + dz)) continue;
    if (world.getBlock(x + dx, y, z + dz) === LAVA) world.setBlock(x + dx, y, z + dz, OBSIDIAN_ID);
  }
  if (world.getBlock(x, y - 1, z) === LAVA) world.setBlock(x, y - 1, z, STONE);
  // 消退（仅流水）：上方供水 或 同级上游（level-1）邻居，缺失则退化为空气（MC 规则）
  if (level > 0 && !isWaterId(world.getBlock(x, y + 1, z))) {
    const parentLevel = level - 1;
    const hasParent = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(
      ([dx, dz]) => loaded(x + dx, z + dz) && waterLevel(world.getBlock(x + dx, y, z + dz)) === parentLevel,
    );
    if (!hasParent) {
      world.setBlock(x, y, z, AIR);
      return;
    }
  }
  // 无限水源（MC 规则）：水平两侧都是水源 且 下方是水源或实心方块 → 本格成源
  if (level > 0) {
    const sources = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(
      ([dx, dz]) => loaded(x + dx, z + dz) && world.getBlock(x + dx, y, z + dz) === WATER,
    ).length;
    if (sources >= 2) {
      const below = world.getBlock(x, y - 1, z);
      if (below === WATER || BLOCKS[below]?.opaque) {
        world.setBlock(x, y, z, WATER);
        return;
      }
    }
  }
  if (y > 0) {
    const below = world.getBlock(x, y - 1, z);
    if (below === AIR) {
      world.setBlock(x, y - 1, z, level === 0 ? FLOW_BASE : FLOW_BASE + level - 1);
      pending.add(`${x},${y - 1},${z}`);
      return;
    }
    // 水向下流入岩浆（MC）：流动岩浆 → 圆石（源已在上方接触判定中变石头）
    if (isLavaId(below)) {
      world.setBlock(x, y - 1, z, COBBLE);
      return;
    }
  }
  // 落地才向四方扩散（下方是非水实心/流体底托）；水柱中段不在半空散开（MC 瀑布观感）
  if (level < 7 && !isWaterId(world.getBlock(x, y - 1, z))) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (!loaded(x + dx, z + dz)) continue;
      const t = world.getBlock(x + dx, y, z + dz);
      if (t === AIR) {
        world.setBlock(x + dx, y, z + dz, FLOW_BASE + level);
        pending.add(`${x + dx},${y},${z + dz}`);
      } else if (isLavaId(t)) {
        // 水侧向流入岩浆（MC）：流动岩浆 → 圆石（源已在接触判定中变黑曜石）
        world.setBlock(x + dx, y, z + dz, COBBLE);
      }
    }
  }
}

/** 岩浆格处理（每 lavaInterval 秒一步）：水火接触 + 向下流 + 落地按维度距离扩散 */
function tickLava(world: World, x: number, y: number, z: number, level: number, maxLevel: number, loaded: (nx: number, nz: number) => boolean): void {
  // 上方是水（MC：水从上方浇到岩浆）：源 → 石头；流动岩浆 → 圆石
  if (isWaterId(world.getBlock(x, y + 1, z))) {
    world.setBlock(x, y, z, level === 0 ? STONE : COBBLE);
    return;
  }
  // 岩浆源遇侧向水 → 黑曜石（MC）
  if (level === 0) {
    const sideWater = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(
      ([dx, dz]) => loaded(x + dx, z + dz) && isWaterId(world.getBlock(x + dx, y, z + dz)),
    );
    if (sideWater) {
      world.setBlock(x, y, z, OBSIDIAN_ID);
      return;
    }
  }
  if (y > 0) {
    const below = world.getBlock(x, y - 1, z);
    if (below === AIR) {
      // 向下流动与水相同：源产生 1 级流、流动等级不变（下落直达）
      world.setBlock(x, y - 1, z, level === 0 ? LAVA_FLOW_BASE : LAVA_FLOW_BASE + level - 1);
      pending.add(`${x},${y - 1},${z}`);
      return;
    }
    // 岩浆向下流入水（MC）→ 石头
    if (isWaterId(below)) {
      world.setBlock(x, y - 1, z, STONE);
      return;
    }
  }
  // 落地才向四方扩散（下方非空非岩浆柱）；主世界/末地至多 3 级、下界至多 7 级
  if (level < maxLevel && !isLavaId(world.getBlock(x, y - 1, z))) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (!loaded(x + dx, z + dz)) continue;
      const t = world.getBlock(x + dx, y, z + dz);
      if (t === AIR) {
        world.setBlock(x + dx, y, z + dz, LAVA_FLOW_BASE + level);
        pending.add(`${x + dx},${y},${z + dz}`);
      } else if (isWaterId(t)) {
        // 侧向流入水的岩浆（MC）→ 圆石
        world.setBlock(x + dx, y, z + dz, COBBLE);
      }
    }
  }
}

/**
 * 每 ~0.4s（sim.ts 慢节奏一拍）调用一次：从队列取最多 budget 个流体格子尝试传播。
 * 水每拍结算；岩浆按维度节奏结算（主世界/末地 1.5s、下界 0.5s 一步），未到节奏的岩浆格留回队列。
 */
export function tickFluids(world: World, budget = 128): void {
  if (pending.size === 0) return;
  const nether = world.terrain.kind === 'nether';
  lavaAcc += BEAT;
  const lavaDue = lavaAcc >= (nether ? LAVA_INTERVAL_NETHER : LAVA_INTERVAL_NORMAL);
  if (lavaDue) lavaAcc -= nether ? LAVA_INTERVAL_NETHER : LAVA_INTERVAL_NORMAL;
  const maxLavaLevel = nether ? 7 : 3;
  let drained = 0;
  const deferred: string[] = [];
  for (const key of pending) {
    if (drained >= budget) break;
    pending.delete(key);
    const [x, y, z] = key.split(',').map(Number);
    // 未加载的格子不处理——getBlock 会隐式触发全量生成，把 chunk 生成拖出渲染半径形成生成风暴
    if (!world.isChunkLoaded(x, z)) continue;
    const id = world.getBlock(x, y, z);
    const wLevel = waterLevel(id);
    const lLevel = wLevel < 0 ? lavaLevel(id) : -1;
    if (wLevel < 0 && lLevel < 0) {
      drained++; // 非流体（已被挖掉/替换）：出队即弃
      continue;
    }
    // 邻格同理：chunk 未加载的方向直接跳过，否则在加载半径边缘倒液体会逐 chunk 向外爬，
    // 每步都隐式触发主线程全量地形生成 + cascadeLight
    const loaded = (nx: number, nz: number): boolean => world.isChunkLoaded(nx, nz);
    if (lLevel >= 0 && !lavaDue) {
      deferred.push(key); // 岩浆节奏未到：本拍不结算，留回队列
      continue;
    }
    drained++;
    if (wLevel >= 0) tickWater(world, x, y, z, wLevel, loaded);
    else tickLava(world, x, y, z, lLevel, maxLavaLevel, loaded);
  }
  for (const key of deferred) pending.add(key);
}

// 世界作用域自注册（lib/worldScope.ts）：流体队列随世界清理
registerWorldScope({ name: 'fluids', clear: clearFluids });
