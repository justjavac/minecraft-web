// 体素 DDA 射线（Amanatides & Woo），用于挖掘/放置选块

import { AIR, BLOCKS } from './blocks';
import type { World } from './world';

export interface RaycastHit {
  /** 命中的方块坐标 */
  block: [number, number, number];
  /** 命中面的外法线；放置位置 = block + face。原点就在方块内时为 [0,0,0] */
  face: [number, number, number];
}

export function raycastBlock(
  world: World,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
): RaycastHit | null {
  const len = Math.hypot(dx, dy, dz);
  if (len === 0) return null;
  dx /= len;
  dy /= len;
  dz /= len;

  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);

  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const stepZ = dz > 0 ? 1 : -1;

  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;

  let tMaxX = dx !== 0 ? (dx > 0 ? x + 1 - ox : ox - x) * tDeltaX : Infinity;
  let tMaxY = dy !== 0 ? (dy > 0 ? y + 1 - oy : oy - y) * tDeltaY : Infinity;
  let tMaxZ = dz !== 0 ? (dz > 0 ? z + 1 - oz : oz - z) * tDeltaZ : Infinity;

  let face: [number, number, number] = [0, 0, 0];
  let t = 0;

  while (t <= maxDist) {
    const id = world.getBlock(x, y, z);
    if (id !== AIR && (BLOCKS[id]?.solid || BLOCKS[id]?.shape === 'cross')) {
      return { block: [x, y, z], face };
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      t = tMaxX;
      tMaxX += tDeltaX;
      x += stepX;
      face = [-stepX, 0, 0];
    } else if (tMaxY < tMaxZ) {
      t = tMaxY;
      tMaxY += tDeltaY;
      y += stepY;
      face = [0, -stepY, 0];
    } else {
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      z += stepZ;
      face = [0, 0, -stepZ];
    }
  }
  return null;
}
