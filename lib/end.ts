// 末地维度：中央主岛（末地石，倒锥收束）+ 黑曜石柱环（顶基岩座）+ 返回门祭坛 + 出生黑曜石平台，四周虚空
// 末影龙与水晶见后续（lib/endfight.ts）；本文件只管地形与结构生成

import { AIR, BLOCK_BY_KEY } from './blocks';
import { hash2, hashString, type Terrain } from './noise';
import { fillChest, type LootEntry } from './structures';
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
  // 与 World.seedHash 同源（hashString）：地形高度闭包与特征生成（generateEndChunk 的 seedHash 参数）必须一套种子
  const seedHash = hashString(seed);
  return {
    kind: 'end',
    heightAt: (x, z) => {
      const main = endHeightAt(seedHash, x, z);
      return main >= 0 ? main : outerHeightAt(seedHash, x, z); // 主岛之外查外岛环带
    },
    biomeAt: () => 'plains', // 末地无群系（占位；刷怪按 kind==='end' 分支）
    treeAt: () => null,
    caveAt: () => false,
    snowlineAt: () => Infinity,
    undergroundAt: () => null,
    aquiferAt: () => false,
  };
}

// ——— 外岛（MC 末地外岛环带：r>150 虚空海之外散布小岛，紫颂树与末地城所在） ———

const OUTER_REGION = 96;

export interface OuterIsland {
  x: number;
  z: number;
  r: number;
  y: number;
  /** 岛上有末地城（约 1/4 岛，MC 稀有度简化） */
  city: boolean;
}

/** 区域级外岛（30% 区域一岛；距主岛 150 内的空带不出，MC 主岛与外岛间虚空海） */
export function outerIslandAt(seedHash: number, rx: number, rz: number): OuterIsland | null {
  if (hash2(seedHash ^ 0xe07e1, rx, rz) >= 0.3) return null;
  const x = rx * OUTER_REGION + 24 + Math.floor(hash2(seedHash ^ 0xe07e2, rx, rz) * 48);
  const z = rz * OUTER_REGION + 24 + Math.floor(hash2(seedHash ^ 0xe07e3, rx, rz) * 48);
  if (Math.hypot(x, z) < 150) return null;
  return {
    x,
    z,
    r: 16 + Math.floor(hash2(seedHash ^ 0xe07e4, rx, rz) * 16), // 16-31
    y: 58 + Math.floor(hash2(seedHash ^ 0xe07e5, rx, rz) * 14), // 58-71
    city: hash2(seedHash ^ 0xe07e7, rx, rz) < 0.25,
  };
}

/** 外岛地形高度（查 3×3 邻域岛心，取最高；无岛 -1 虚空） */
export function outerHeightAt(seedHash: number, x: number, z: number): number {
  const rx = Math.floor(x / OUTER_REGION);
  const rz = Math.floor(z / OUTER_REGION);
  let best = -1;
  for (let drx = -1; drx <= 1; drx++) {
    for (let drz = -1; drz <= 1; drz++) {
      const isle = outerIslandAt(seedHash, rx + drx, rz + drz);
      if (!isle) continue;
      const d = Math.hypot(x - isle.x, z - isle.z);
      if (d > isle.r) continue;
      const fall = 1 - (d / isle.r) ** 2;
      const n = vnoise(seedHash ^ 0xe07e6, x, z, 13);
      const hh = Math.floor(isle.y - 4 + fall * 7 + n * 5);
      if (hh > best) best = hh;
    }
  }
  return best;
}

/** 包含 (x,z) 的外岛（末地城生成/刷怪定位用；无则 null） */
export function outerIslandContaining(seedHash: number, x: number, z: number): OuterIsland | null {
  const rx = Math.floor(x / OUTER_REGION);
  const rz = Math.floor(z / OUTER_REGION);
  for (let drx = -1; drx <= 1; drx++) {
    for (let drz = -1; drz <= 1; drz++) {
      const isle = outerIslandAt(seedHash, rx + drx, rz + drz);
      if (isle && Math.hypot(x - isle.x, z - isle.z) <= isle.r) return isle;
    }
  }
  return null;
}

/** 末地 chunk 生成：末地石岛体（倒锥：中心厚边缘薄）+ 黑曜石柱 + 祭坛 + 出生平台 + 外岛（紫颂树/末地城） */
export function generateEndChunk(terrain: Terrain, cx: number, cz: number, data: Uint16Array, seedHash = 0): void {
  const END_STONE = K('end_stone');
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = cx * CHUNK_SIZE + x;
      const wz = cz * CHUNK_SIZE + z;
      const h = terrain.heightAt(wx, wz);
      if (h < 0) continue; // 虚空
      // 倒锥厚度：越靠边缘越薄（MC 岛底收束；外岛薄些）
      const d = Math.hypot(wx, wz);
      const isOuter = d > 150;
      const fall = isOuter ? 0.5 : 1 - (d / END_ISLAND_R) ** 2;
      const thick = Math.max(4, Math.floor((isOuter ? 8 : 6) + fall * (isOuter ? 14 : 26) + vnoise(seedHash ^ 0x77aa, wx, wz, 11) * 6));
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
  // 外岛内容：紫颂树（全岛散布）+ 末地城（城岛塔楼群）
  applyOuterFeatures(terrain, cx, cz, data, seedHash);
}

/** 末地城战利品：主塔顶箱必含鞘翅（MC 末地船鞘翅的简化）；小塔箱无鞘翅 */
export const END_CITY_MAIN_LOOT: LootEntry[] = [
  ['elytra', 1, 1, 1],
  ['diamond', 2, 6, 0.5],
  ['iron_ingot', 2, 5, 0.5],
  ['emerald', 1, 3, 0.3],
];
const END_CITY_SIDE_LOOT: LootEntry[] = [
  ['diamond', 1, 4, 0.4],
  ['gold_ingot', 2, 5, 0.5],
  ['iron_ingot', 2, 5, 0.5],
];

function putLocal(data: Uint16Array, cx: number, cz: number, x: number, y: number, z: number, id: number): void {
  const lx = x - cx * CHUNK_SIZE;
  const lz = z - cz * CHUNK_SIZE;
  if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return;
  data[localIndex(lx, y, lz)] = id;
}

/** 外岛特征：紫颂树散布（主干 + 侧枝 + 顶花）；末地城塔楼（岛心有城时） */
function applyOuterFeatures(terrain: Terrain, cx: number, cz: number, data: Uint16Array, seedHash: number): void {
  const x0 = cx * CHUNK_SIZE;
  const z0 = cz * CHUNK_SIZE;
  const rx = Math.floor(x0 / OUTER_REGION);
  const rz = Math.floor(z0 / OUTER_REGION);
  for (let drx = -1; drx <= 1; drx++) {
    for (let drz = -1; drz <= 1; drz++) {
      const isle = outerIslandAt(seedHash, rx + drx, rz + drz);
      if (!isle) continue;
      // 紫颂树：岛面约 0.8% 列（MC 外岛遍布）
      for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
          const wx = x0 + x;
          const wz = z0 + z;
          const d = Math.hypot(wx - isle.x, wz - isle.z);
          if (d > isle.r - 3 || d < 4) continue;
          if (hash2(seedHash ^ 0xc0a501, wx, wz) >= 0.008) continue;
          const h = terrain.heightAt(wx, wz);
          if (h < 0) continue;
          const trunk = 4 + Math.floor(hash2(seedHash ^ 0xc0a502, wx, wz) * 4); // 4-7
          for (let t = 1; t <= trunk; t++) putLocal(data, cx, cz, wx, h + t, wz, K('chorus_plant'));
          putLocal(data, cx, cz, wx, h + trunk + 1, wz, K('chorus_flower'));
          // 1-2 条斜上侧枝（MC 分叉简化）
          const branches = 1 + Math.floor(hash2(seedHash ^ 0xc0a503, wx, wz) * 2);
          for (let b = 0; b < branches; b++) {
            const ang = hash2(seedHash ^ (0xc0a504 + b * 7), wx, wz) * Math.PI * 2;
            const sx = Math.round(Math.cos(ang));
            const sz = Math.round(Math.sin(ang));
            const by = h + 2 + Math.floor(hash2(seedHash ^ (0xc0a505 + b * 7), wx, wz) * Math.max(1, trunk - 3));
            const bl = 2 + Math.floor(hash2(seedHash ^ (0xc0a506 + b * 7), wx, wz) * 2);
            let bx = wx;
            let bz = wz;
            for (let t = 0; t < bl; t++) {
              bx += sx;
              bz += sz;
              putLocal(data, cx, cz, bx, by + t, bz, K('chorus_plant'));
            }
            putLocal(data, cx, cz, bx, by + bl, bz, K('chorus_flower'));
          }
        }
      }
      if (isle.city) writeEndCity(terrain, isle, cx, cz, data, seedHash);
    }
  }
}

/** 末地城：主塔 9×9×16（紫珀/末地石砖，层间隔板 + 窗洞）+ 两座 5×5×9 小塔；主塔顶箱必含鞘翅 */
function writeEndCity(terrain: Terrain, isle: OuterIsland, cx: number, cz: number, data: Uint16Array, seedHash: number): void {
  const bricks = K('end_stone_bricks');
  const purpur = K('purpur_block');
  const pillar = K('purpur_pillar');
  const baseY = terrain.heightAt(isle.x, isle.z);
  if (baseY < 0) return;
  // 主塔
  for (let x = -4; x <= 4; x++) {
    for (let z = -4; z <= 4; z++) {
      for (let dy = 0; dy <= 16; dy++) {
        const wx = isle.x + x;
        const wz = isle.z + z;
        const edge = Math.abs(x) === 4 || Math.abs(z) === 4;
        if (dy % 5 === 0) {
          putLocal(data, cx, cz, wx, baseY + 1 + dy, wz, dy % 10 === 0 ? purpur : bricks); // 隔板
          continue;
        }
        if (!edge) {
          putLocal(data, cx, cz, wx, baseY + 1 + dy, wz, AIR);
          continue;
        }
        const win = dy % 5 >= 2 && dy % 5 <= 3 && ((Math.abs(x) <= 1 && Math.abs(z) === 4) || (Math.abs(z) <= 1 && Math.abs(x) === 4));
        putLocal(data, cx, cz, wx, baseY + 1 + dy, wz, win ? AIR : bricks);
      }
    }
  }
  // 南门洞 + 紫珀柱顶饰 + 顶箱（鞘翅）
  for (let dy = 1; dy <= 2; dy++) putLocal(data, cx, cz, isle.x, baseY + dy, isle.z + 4, AIR);
  for (const [px, pz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]] as const) {
    for (let dy = 17; dy <= 19; dy++) putLocal(data, cx, cz, isle.x + px, baseY + dy, isle.z + pz, pillar);
  }
  putLocal(data, cx, cz, isle.x, baseY + 16, isle.z, K('chest'));
  fillChest(seedHash, isle.x, baseY + 16, isle.z, END_CITY_MAIN_LOOT);
  // 小塔两座（±9 偏移）：5×5×9 空箱塔
  for (const [ox, oz] of [[9, 0], [-9, 0]] as const) {
    const tx = isle.x + ox;
    const tz = isle.z + oz;
    const ty = terrain.heightAt(tx, tz);
    if (ty < 0) continue;
    for (let x = -2; x <= 2; x++) {
      for (let z = -2; z <= 2; z++) {
        for (let dy = 0; dy <= 9; dy++) {
          const edge = Math.abs(x) === 2 || Math.abs(z) === 2;
          if (dy % 4 === 0 || dy === 9) {
            putLocal(data, cx, cz, tx + x, ty + 1 + dy, tz + z, bricks);
            continue;
          }
          putLocal(data, cx, cz, tx + x, ty + 1 + dy, tz + z, edge ? bricks : AIR);
        }
      }
    }
    putLocal(data, cx, cz, tx, ty + 2, tz, K('chest'));
    fillChest(seedHash, tx, ty + 2, tz, END_CITY_SIDE_LOOT);
  }
}
