// 维度切换：主世界 ↔ 下界（坐标 1:8 映射、落点扫描、目的地无门则造门）

import { AIR, BLOCK_BY_KEY, BLOCKS, isLavaId } from './blocks';
import { LAVA_SEA } from './nether';
import { SEA_LEVEL } from './noise';
import { isPortalId, tryIgnitePortal } from './portal';
import { WORLD_HEIGHT, type World } from './world';

export type Dimension = 'overworld' | 'nether';

export const otherDimension = (d: Dimension): Dimension => (d === 'overworld' ? 'nether' : 'overworld');

/** 跨维度坐标映射（下界 1 格 = 主世界 8 格，MC 一致） */
export function mapCoords(pos: { x: number; y: number; z: number }, to: Dimension): { x: number; y: number; z: number } {
  if (to === 'nether') return { x: pos.x / 8, y: pos.y, z: pos.z / 8 };
  return { x: pos.x * 8, y: pos.y, z: pos.z * 8 };
}

/** 落点：以 (bx, bz) 为中心螺旋外扩，找上方两格空的实心面（下界避开岩浆；主世界避开深水） */
export function findLanding(world: World, bx: number, bz: number, dim: Dimension): { x: number; y: number; z: number } {
  const minY = dim === 'nether' ? LAVA_SEA + 2 : 1;
  for (let r = 0; r <= 12; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = bx + dx;
        const z = bz + dz;
        let y = WORLD_HEIGHT - 8;
        while (y > minY && !BLOCKS[world.getBlock(x, y, z)]?.solid) y--;
        while (y > minY && (BLOCKS[world.getBlock(x, y + 1, z)]?.solid || BLOCKS[world.getBlock(x, y + 2, z)]?.solid)) y--;
        if (y <= minY) continue;
        const above = world.getBlock(x, y + 1, z);
        if (isLavaId(above)) continue;
        if (dim === 'overworld' && above === BLOCK_BY_KEY.water.id) continue;
        return { x: x + 0.5, y: y + 1, z: z + 0.5 };
      }
    }
  }
  return { x: bx + 0.5, y: dim === 'nether' ? LAVA_SEA + 6 : SEA_LEVEL + 6, z: bz + 0.5 };
}

/** 目的地保证有门：附近 16×8×16 内有门块则罢，否则就地造 4×5 框并点燃（保证能往返） */
export function ensurePortal(world: World, bx: number, by: number, bz: number): void {
  for (let dx = -16; dx <= 16; dx++) {
    for (let dy = -8; dy <= 8; dy++) {
      for (let dz = -16; dz <= 16; dz++) {
        if (isPortalId(world.getBlock(bx + dx, by + dy, bz + dz))) return;
      }
    }
  }
  const obs = BLOCK_BY_KEY.obsidian.id;
  // 平台 + 4×5 框（沿 x 展开）+ 点燃
  const fy = by - 1;
  for (let dx = -1; dx <= 4; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      world.setBlock(bx + dx, fy, bz + dz, obs);
    }
  }
  for (let dy = 0; dy <= 4; dy++) {
    world.setBlock(bx, by + dy, bz, obs);
    world.setBlock(bx + 3, by + dy, bz, obs);
  }
  for (let dx = 0; dx <= 3; dx++) {
    world.setBlock(bx + dx, by, bz, obs);
    world.setBlock(bx + dx, by + 4, bz, obs);
  }
  for (let dx = 1; dx <= 2; dx++) {
    for (let dy = 1; dy <= 3; dy++) world.setBlock(bx + dx, by + dy, bz, AIR);
  }
  tryIgnitePortal(world, bx + 1, by + 1, bz);
}
