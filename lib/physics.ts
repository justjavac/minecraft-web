// AABB 碰撞与占位检测：玩家（Player）与怪物（mobs）共用；碰撞盒按方块形状（台阶半高/栅栏 1.5/花草无）

import { BLOCKS, type BlockId } from './blocks';
import type { World } from './world';

export interface Aabb {
  x: number;
  y: number;
  z: number;
}

/** 方块碰撞盒 y 范围（[min,max]；无碰撞返回 null：花草/水/空气） */
export function blockBox(id: BlockId): readonly [number, number] | null {
  const def = BLOCKS[id];
  if (!def?.solid) return null;
  return def.box ?? [0, 1];
}

/** 逐轴 AABB 碰撞：移动后若与实心方块重叠则推回，返回是否碰撞 */
export function collideAxis(
  world: World,
  p: Aabb,
  axis: 0 | 1 | 2,
  delta: number,
  halfW: number,
  height: number,
): boolean {
  if (delta === 0) return false;
  const minX = Math.floor(p.x - halfW);
  const maxX = Math.floor(p.x + halfW);
  const minY = Math.floor(p.y);
  const maxY = Math.floor(p.y + height - 0.001);
  const minZ = Math.floor(p.z - halfW);
  const maxZ = Math.floor(p.z + halfW);
  let hit = false;
  for (let y = minY; y <= maxY; y++) {
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        const box = blockBox(world.getBlock(x, y, z));
        if (!box) continue;
        // 盒与玩家 AABB 相交才计碰撞（半高台阶只挡下半部分）
        if (p.y + height <= y + box[0] + 0.001 || p.y >= y + box[1] - 0.001) continue;
        hit = true;
        if (axis === 0) {
          p.x = delta > 0 ? Math.min(p.x, x - halfW - 0.001) : Math.max(p.x, x + 1 + halfW + 0.001);
        } else if (axis === 1) {
          p.y = delta > 0 ? Math.min(p.y, y + box[0] - height - 0.001) : Math.max(p.y, y + box[1] + 0.001);
        } else {
          p.z = delta > 0 ? Math.min(p.z, z - halfW - 0.001) : Math.max(p.z, z + 1 + halfW + 0.001);
        }
      }
    }
  }
  return hit;
}

/** AABB 是否与任何实心方块碰撞盒重叠 */
export function aabbFree(world: World, x: number, y: number, z: number, halfW: number, height: number): boolean {
  const minX = Math.floor(x - halfW);
  const maxX = Math.floor(x + halfW);
  const minY = Math.floor(y);
  const maxY = Math.floor(y + height - 0.001);
  const minZ = Math.floor(z - halfW);
  const maxZ = Math.floor(z + halfW);
  for (let yy = minY; yy <= maxY; yy++) {
    for (let zz = minZ; zz <= maxZ; zz++) {
      for (let xx = minX; xx <= maxX; xx++) {
        const box = blockBox(world.getBlock(xx, yy, zz));
        if (!box) continue;
        if (y + height <= yy + box[0] + 0.001 || y >= yy + box[1] - 0.001) continue;
        return false;
      }
    }
  }
  return true;
}
