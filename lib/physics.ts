// AABB 碰撞与占位检测：玩家（Player）与怪物（mobs）共用

import { BLOCKS } from './blocks';
import type { World } from './world';

export interface Aabb {
  x: number;
  y: number;
  z: number;
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
        if (!BLOCKS[world.getBlock(x, y, z)]?.solid) continue;
        hit = true;
        if (axis === 0) {
          p.x = delta > 0 ? Math.min(p.x, x - halfW - 0.001) : Math.max(p.x, x + 1 + halfW + 0.001);
        } else if (axis === 1) {
          p.y = delta > 0 ? Math.min(p.y, y - height - 0.001) : Math.max(p.y, y + 1 + 0.001);
        } else {
          p.z = delta > 0 ? Math.min(p.z, z - halfW - 0.001) : Math.max(p.z, z + 1 + halfW + 0.001);
        }
      }
    }
  }
  return hit;
}

/** AABB 是否与任何实心方块重叠 */
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
        if (BLOCKS[world.getBlock(xx, yy, zz)]?.solid) return false;
      }
    }
  }
  return true;
}
