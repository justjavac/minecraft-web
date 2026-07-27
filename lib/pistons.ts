// 活塞机械：供能推出（至多 12 格）、断能收回、粘性拉回、孤儿头清理
// 状态完全由方块布局推导（活塞 facing + 前方活塞头），无需持久化

import { AIR, BLOCK_BY_KEY, BLOCKS, isWaterId, isLavaId, type BlockId } from './blocks';
import type { World } from './world';

const HEAD = () => BLOCK_BY_KEY.piston_head.id;

const pistonKey = (id: BlockId): string => BLOCKS[id]?.key ?? '';

export const isPistonId = (id: BlockId): boolean => {
  const k = pistonKey(id);
  return k.startsWith('piston_') && k !== 'piston_head';
};
export const isStickyPistonId = (id: BlockId): boolean => pistonKey(id).startsWith('piston_sticky_');
export const isPistonPart = (id: BlockId): boolean => isPistonId(id) || id === HEAD();

/** 活塞 id：粘性与否 × 朝向（0-5） */
export function pistonIdFor(sticky: boolean, facing: number): number {
  const suf = ['n', 'e', 's', 'w', 'u', 'd'][facing] ?? 'n';
  return BLOCK_BY_KEY[`piston_${sticky ? 'sticky_' : ''}${suf}`].id;
}

/** 朝向向量（0-5：n/e/s/w/上/下） */
export const FACING_VEC: Record<number, [number, number, number]> = {
  0: [0, 0, -1],
  1: [1, 0, 0],
  2: [0, 0, 1],
  3: [-1, 0, 0],
  4: [0, 1, 0],
  5: [0, -1, 0],
};

/** 不可推动（MC 规则简化：防爆方块 + 容器/功能方块 + 流体 + 传送门 + 活塞自身） */
function immovable(id: BlockId): boolean {
  if (id === AIR) return false;
  const def = BLOCKS[id];
  if (!def) return true;
  if (def.unbreakable) return true;
  if (def.pickTier === 3) return true; // 黑曜石类（MC 不可推）
  if (isWaterId(id) || isLavaId(id)) return true;
  if (isPistonPart(id)) return true;
  const key = def.key;
  return key === 'chest' || key === 'barrel' || key === 'furnace' || key === 'brewing_stand' || key === 'enchanting_table';
}

/** 供能推出：把活塞前方一行（≤12 格）整体前推一格并放活塞头；不可推/无空位则不动 */
export function tryExtend(world: World, x: number, y: number, z: number): void {
  const def = BLOCKS[world.getBlock(x, y, z)];
  const f = def?.facing ?? 4;
  const [dx, dy, dz] = FACING_VEC[f];
  // 找一行末尾：连续可推块的终点（首个空气格，作为推出目标）
  let end = 0;
  for (let i = 1; i <= 12; i++) {
    const id = world.getBlock(x + dx * i, y + dy * i, z + dz * i);
    if (immovable(id)) return; // 行内有不可推块：整行不动
    if (id === AIR) {
      end = i;
      break;
    }
    if (i === 12) return; // 12 格内无空位：推不出（MC 规则）
  }
  if (end === 0) return;
  // 从末端往回逐格前推
  for (let i = end; i >= 1; i--) {
    const from = world.getBlock(x + dx * (i - 1), y + dy * (i - 1), z + dz * (i - 1));
    world.setBlock(x + dx * i, y + dy * i, z + dz * i, from);
  }
  world.setBlock(x + dx, y + dy, z + dz, HEAD());
}

/** 断能收回：移除活塞头；粘性活塞把头部前方的块拉回（MC 粘性规则） */
export function retract(world: World, x: number, y: number, z: number): void {
  const def = BLOCKS[world.getBlock(x, y, z)];
  const sticky = isStickyPistonId(world.getBlock(x, y, z));
  const f = def?.facing ?? 4;
  const [dx, dy, dz] = FACING_VEC[f];
  const hx = x + dx;
  const hy = y + dy;
  const hz = z + dz;
  if (world.getBlock(hx, hy, hz) !== HEAD()) return;
  world.setBlock(hx, hy, hz, AIR);
  if (!sticky) return;
  // 粘性：把再前一格的块拉到头部原位置（只拉固体，MC 一致）
  const pulled = world.getBlock(hx + dx, hy + dy, hz + dz);
  if (pulled === AIR || immovable(pulled)) return;
  world.setBlock(hx + dx, hy + dy, hz + dz, AIR);
  world.setBlock(hx, hy, hz, pulled);
}

/** 孤儿活塞头清理：背向无活塞的头自动消失（recompute/变动时调用） */
export function cleanupOrphanHeads(world: World, x: number, y: number, z: number): void {
  if (world.getBlock(x, y, z) !== HEAD()) return;
  for (const [dx, dy, dz] of Object.values(FACING_VEC)) {
    if (isPistonId(world.getBlock(x - dx, y - dy, z - dz))) return;
  }
  world.setBlock(x, y, z, AIR);
}

/** 该活塞是否处于推出态（前方是活塞头） */
export function isExtended(world: World, x: number, y: number, z: number): boolean {
  const def = BLOCKS[world.getBlock(x, y, z)];
  const f = def?.facing ?? 4;
  const [dx, dy, dz] = FACING_VEC[f];
  return world.getBlock(x + dx, y + dy, z + dz) === HEAD();
}
