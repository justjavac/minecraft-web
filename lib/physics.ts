// AABB 碰撞与占位检测：玩家（Player）与怪物（mobs）共用；碰撞盒按方块形状（台阶半高/栅栏 1.5/门薄面板/花草无）

import { BLOCKS, type BlockId } from './blocks';
import type { World } from './world';

export interface Aabb {
  x: number;
  y: number;
  z: number;
}

export type Box3 = readonly [number, number, number, number, number, number];

/** 方块碰撞盒 [minX,minY,minZ,maxX,maxY,maxZ]（无碰撞返回 null：花草/水/空气） */
export function blockBox(id: BlockId): Box3 | null {
  const def = BLOCKS[id];
  if (!def?.solid) return null;
  return def.box3 ?? [0, 0, 0, 1, 1, 1];
}

const EPS = 0.001;

function overlaps(p: Aabb, halfW: number, height: number, x: number, y: number, z: number, b: Box3): boolean {
  return (
    p.x + halfW > x + b[0] + EPS &&
    p.x - halfW < x + b[3] - EPS &&
    p.y + height > y + b[1] + EPS &&
    p.y < y + b[4] - EPS &&
    p.z + halfW > z + b[2] + EPS &&
    p.z - halfW < z + b[5] - EPS
  );
}

/** 逐轴 AABB 碰撞：移动后若与实心方块碰撞盒重叠则推回，返回是否碰撞 */
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
  const maxY = Math.floor(p.y + height - EPS);
  const minZ = Math.floor(p.z - halfW);
  const maxZ = Math.floor(p.z + halfW);
  let hit = false;
  for (let y = minY; y <= maxY; y++) {
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        const box = blockBox(world.getBlock(x, y, z));
        if (!box) continue;
        if (!overlaps(p, halfW, height, x, y, z, box)) continue;
        hit = true;
        if (axis === 0) {
          p.x = delta > 0 ? Math.min(p.x, x + box[0] - halfW - EPS) : Math.max(p.x, x + box[3] + halfW + EPS);
        } else if (axis === 1) {
          p.y = delta > 0 ? Math.min(p.y, y + box[1] - height - EPS) : Math.max(p.y, y + box[4] + EPS);
        } else {
          p.z = delta > 0 ? Math.min(p.z, z + box[2] - halfW - EPS) : Math.max(p.z, z + box[5] + halfW + EPS);
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
  const maxY = Math.floor(y + height - EPS);
  const minZ = Math.floor(z - halfW);
  const maxZ = Math.floor(z + halfW);
  for (let yy = minY; yy <= maxY; yy++) {
    for (let zz = minZ; zz <= maxZ; zz++) {
      for (let xx = minX; xx <= maxX; xx++) {
        const box = blockBox(world.getBlock(xx, yy, zz));
        if (!box) continue;
        if (!overlaps({ x, y, z }, halfW, height, xx, yy, zz, box)) continue;
        return false;
      }
    }
  }
  return true;
}
