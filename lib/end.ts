// 末地维度：中央主岛（末地石，倒锥收束）+ 黑曜石柱环（顶基岩座）+ 返回门祭坛 + 出生黑曜石平台，四周虚空
// 末影龙与水晶见后续（lib/endfight.ts）；本文件只管地形与结构生成

import { AIR, BLOCK_BY_KEY } from './blocks';
import { hash2, type Terrain } from './noise';
import { CHUNK_SIZE, localIndex, WORLD_HEIGHT } from './world';

const K = (key: string) => BLOCK_BY_KEY[key].id;

/** 主岛半径（格）与基准高度 */
export const END_ISLAND_R = 96;
export const END_ISLAND_Y = 64;

/** 出生黑曜石平台（MC 固定 (100, 49, 0)，悬于虚空；玩家落点为其上表面） */
export const END_SPAWN = { x: 100.5, y: 50, z: 0.5 } as const;
const PLATFORM_Y = 49;

/** 黑曜石柱环：10 根（MC），半径 42，高度 76-106 种子抖动，柱顶基岩座（水晶位） */
export interface EndPillar {
  x: number;
  z: number;
  top: number;
  radius: number;
}
export function endPillars(seedHash: number): EndPillar[] {
  const list: EndPillar[] = [];
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    list.push({
      x: Math.round(Math.cos(angle) * 42),
      z: Math.round(Math.sin(angle) * 42),
      top: 76 + Math.floor(hash2(seedHash ^ 0x9d17, i, 0) * 31), // 76-106
      radius: i % 3 === 0 ? 3 : 2, // 部分粗柱（MC 有粗细两种）
    });
  }
  return list;
}

/** 2D value noise（双线性平滑插值，0-1） */
function vnoise(seed: number, x: number, z: number, scale: number): number {
  const gx = x / scale;
  const gz = z / scale;
  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const fx = gx - x0;
  const fz = gz - z0;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const v00 = hash2(seed, x0, z0);
  const v10 = hash2(seed, x0 + 1, z0);
  const v01 = hash2(seed, x0, z0 + 1);
  const v11 = hash2(seed, x0 + 1, z0 + 1);
  return (v00 * (1 - sx) + v10 * sx) * (1 - sz) + (v01 * (1 - sx) + v11 * sx) * sz;
}

/** 岛面高度：中心隆起边缘走低 + 两层噪声起伏；岛外虚空 -1 */
export function endHeightAt(seedHash: number, x: number, z: number): number {
  const d = Math.hypot(x, z);
  if (d > END_ISLAND_R) return -1;
  const fall = 1 - (d / END_ISLAND_R) ** 2;
  const n = vnoise(seedHash, x, z, 18) * 0.7 + vnoise(seedHash ^ 0x51f3, x, z, 7) * 0.3;
  return Math.floor(END_ISLAND_Y - 8 + fall * 12 + n * 9);
}

export function createEndTerrain(seed: string): Terrain {
  let h = 0;
  for (const c of seed) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  const seedHash = h >>> 0;
  return {
    kind: 'end',
    heightAt: (x, z) => endHeightAt(seedHash, x, z),
    biomeAt: () => 'plains', // 末地无群系（占位；刷怪按 kind==='end' 分支）
    treeAt: () => null,
    caveAt: () => false,
    snowlineAt: () => Infinity,
    undergroundAt: () => null,
    aquiferAt: () => false,
  };
}

/** 末地 chunk 生成：末地石岛体（倒锥：中心厚边缘薄）+ 黑曜石柱 + 祭坛 + 出生平台 */
export function generateEndChunk(terrain: Terrain, cx: number, cz: number, data: Uint16Array, seedHash = 0): void {
  const END_STONE = K('end_stone');
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = cx * CHUNK_SIZE + x;
      const wz = cz * CHUNK_SIZE + z;
      const h = terrain.heightAt(wx, wz);
      if (h < 0) continue; // 虚空
      // 倒锥厚度：越靠边缘越薄（MC 岛底收束）
      const d = Math.hypot(wx, wz);
      const fall = 1 - (d / END_ISLAND_R) ** 2;
      const thick = Math.max(4, Math.floor(6 + fall * 26 + vnoise(seedHash ^ 0x77aa, wx, wz, 11) * 6));
      for (let y = Math.max(1, h - thick); y <= h; y++) data[localIndex(x, y, z)] = END_STONE;
    }
  }
  // 黑曜石柱（柱身黑曜石，顶 1 格基岩座——末影龙水晶位）
  for (const p of endPillars(seedHash)) {
    if (p.x < cx * CHUNK_SIZE - p.radius || p.x >= (cx + 1) * CHUNK_SIZE + p.radius) continue;
    if (p.z < cz * CHUNK_SIZE - p.radius || p.z >= (cz + 1) * CHUNK_SIZE + p.radius) continue;
    const base = terrain.heightAt(p.x, p.z);
    if (base < 0) continue;
    for (let dx = -p.radius; dx <= p.radius; dx++) {
      for (let dz = -p.radius; dz <= p.radius; dz++) {
        if (dx * dx + dz * dz > p.radius * p.radius) continue;
        const wx = p.x + dx;
        const wz = p.z + dz;
        const lx = wx - cx * CHUNK_SIZE;
        const lz = wz - cz * CHUNK_SIZE;
        if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) continue;
        for (let y = base + 1; y < p.top && y < WORLD_HEIGHT; y++) data[localIndex(lx, y, lz)] = K('obsidian');
        if (dx === 0 && dz === 0 && p.top < WORLD_HEIGHT) data[localIndex(lx, p.top, lz)] = K('bedrock'); // 水晶座
      }
    }
  }
  // 返回门祭坛（中央 5×5 基岩坛 + 四角柱 + 中心柱；杀龙后激活，见末影龙轮）
  const ay = terrain.heightAt(0, 0);
  if (ay >= 0) {
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const wx = dx;
        const wz = dz;
        const lx = wx - cx * CHUNK_SIZE;
        const lz = wz - cz * CHUNK_SIZE;
        if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) continue;
        data[localIndex(lx, ay + 1, lz)] = K('bedrock'); // 坛面
        if (Math.abs(dx) === 2 && Math.abs(dz) === 2) {
          data[localIndex(lx, ay + 2, lz)] = K('bedrock'); // 四角柱
          if (ay + 3 < WORLD_HEIGHT) data[localIndex(lx, ay + 3, lz)] = K('torch');
        } else {
          for (let dy = 2; dy <= 4; dy++) data[localIndex(lx, ay + dy, lz)] = AIR; // 坛上方净空
        }
      }
    }
    const lx = 0 - cx * CHUNK_SIZE;
    const lz = 0 - cz * CHUNK_SIZE;
    if (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE) {
      data[localIndex(lx, ay + 2, lz)] = K('bedrock'); // 中心柱（龙蛋位）
    }
  }
  // 出生黑曜石平台 5×5（MC (100,49,0) 平台，悬于虚空也生成）
  {
    const px = Math.floor(END_SPAWN.x);
    const pz = Math.floor(END_SPAWN.z);
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const lx = px + dx - cx * CHUNK_SIZE;
        const lz = pz + dz - cz * CHUNK_SIZE;
        if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) continue;
        data[localIndex(lx, PLATFORM_Y, lz)] = K('obsidian');
        for (let dy = 1; dy <= 3; dy++) data[localIndex(lx, PLATFORM_Y + dy, lz)] = AIR; // 平台上方净空
      }
    }
  }
}
