// 重力方块（MC）：沙子/沙砾/混凝土粉末/铁砧/龙蛋在失去支撑时下落，直到落在实心方块上；
// 砸在火把/半砖/积雪层等非整格方块上则碎成掉落物（MC 落方块破碎规则）。
// 简化实现：方块编辑（挖掘/放置）触发支撑检查，下落按 ~80ms 步进（MC 为掉落实体，此处逐格步进，性能友好）。
// 注意：自然生成的悬空沙（MC 也有）只在收到方块更新时坠落——与本实现的触发点一致（玩家编辑/爆炸）。

import { AIR, BLOCKS, BLOCK_BY_KEY, isWaterId, isLavaId, type BlockId } from './blocks';
import { spawnBlockDrop } from './items';
import type { World } from './world';
import { registerWorldScope } from './worldScope';

/** 受重力影响的方块（MC：沙子/红沙/沙砾/混凝土粉末×16/铁砧/龙蛋） */
const GRAVITY_KEYS: string[] = [
  'sand',
  'red_sand',
  'gravel',
  'anvil',
  'dragon_egg',
  ...(['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'] as const).map(
    (c) => `${c}_concrete_powder`,
  ),
];
const GRAVITY_IDS = new Set<number>(GRAVITY_KEYS.map((k) => BLOCK_BY_KEY[k]?.id).filter((id): id is BlockId => id !== undefined));

export const isGravityBlock = (id: BlockId): boolean => GRAVITY_IDS.has(id);

/** 每步下落间隔（秒；MC 掉落实体每 tick 加速，简化为匀速步进） */
const FALL_STEP = 0.08;

interface Falling {
  x: number;
  y: number;
  z: number;
  id: BlockId;
  timer: number;
}

/** 正在下落的方块（世界作用域状态，维度切换清空） */
const falling: Falling[] = [];

/** 该格是否可被落下方块穿越（空气/流体/非实心植物等；MC 中掉落可穿非实心格） */
function passable(world: World, x: number, y: number, z: number): boolean {
  const id = world.getBlock(x, y, z);
  if (id === AIR || isWaterId(id) || isLavaId(id)) return true;
  const def = BLOCKS[id];
  return def !== undefined && !def.solid;
}

/**
 * 该格是否会让落方块碎成掉落物（MC：火把类/半砖/毯/积雪层等非整格方块）。
 * 空气/水/岩浆不算（穿过行为不变）；砸上后目标方块保留，落方块碎为掉落物。
 */
function breaksFallingBlock(id: BlockId): boolean {
  const def = BLOCKS[id];
  if (def === undefined || def.fluid || def.lava) return false;
  if (def.key.includes('torch')) return true; // 火把/墙上火把/红石火把（含熄灭态）
  if (def.shape === 'slab') return true; // 半砖（含上半）/积雪层/压力板/床等非整格薄块
  return false;
}

/** 方块编辑后检查 (x,y,z) 及其上方一格：若是重力方块且下方可穿越则登记下落 */
export function checkGravityAt(world: World, x: number, y: number, z: number): void {
  for (const [cx, cy, cz] of [
    [x, y, z],
    [x, y + 1, z],
  ] as const) {
    const id = world.getBlock(cx, cy, cz);
    if (!isGravityBlock(id)) continue;
    if (!passable(world, cx, cy - 1, cz)) continue;
    // 已在队列中不重复登记
    if (falling.some((f) => f.x === cx && f.y === cy && f.z === cz)) continue;
    falling.push({ x: cx, y: cy, z: cz, id, timer: FALL_STEP });
  }
}

/** 每帧推进：到点下落一格；落地（下方不可穿越）则从队列移除 */
export function tickGravity(world: World, dt: number): void {
  for (let i = falling.length - 1; i >= 0; i--) {
    const f = falling[i];
    // 方块已被其他途径移除（挖掉/炸掉）
    if (world.getBlock(f.x, f.y, f.z) !== f.id) {
      falling.splice(i, 1);
      continue;
    }
    // MC：砸在火把/半砖/积雪层等非整格方块上碎成掉落物（目标方块保留，落方块不穿过也不放置）
    if (breaksFallingBlock(world.getBlock(f.x, f.y - 1, f.z))) {
      world.setBlock(f.x, f.y, f.z, AIR);
      spawnBlockDrop(f.id, f.x + 0.5, f.y - 0.6, f.z + 0.5);
      falling.splice(i, 1);
      continue;
    }
    if (!passable(world, f.x, f.y - 1, f.z)) {
      falling.splice(i, 1); // 落地
      continue;
    }
    f.timer -= dt;
    if (f.timer > 0) continue;
    f.timer = FALL_STEP;
    // 下到底部：落出世界即消失（MC 掉落实体坠入虚空消失）
    if (f.y <= 1) {
      world.setBlock(f.x, f.y, f.z, AIR);
      falling.splice(i, 1);
      continue;
    }
    world.setBlock(f.x, f.y - 1, f.z, f.id);
    world.setBlock(f.x, f.y, f.z, AIR);
    f.y -= 1;
    // 新位置悬空后，上方一格的重力方块可能连锁失撑
    checkGravityAt(world, f.x, f.y + 1, f.z);
  }
}

/** 清空（测试/维度切换用） */
export function clearGravity(): void {
  falling.length = 0;
}

// 世界作用域自注册（lib/worldScope.ts）：下落中的方块随世界清理
registerWorldScope({ name: 'gravity', clear: clearGravity });
