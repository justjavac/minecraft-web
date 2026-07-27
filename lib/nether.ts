// 下界维度：地形（下界岩丘陵 + 密集洞穴 + 岩浆海）与 chunk 生成器
// 顶层基岩天花板（y≈122-127 参差）+ 萤石簇 + 下界石英矿 + 灵魂沙/沙砾斑块
// 群系变体：下界荒地（默认）/诡异森林/绯红森林/灵魂沙谷（化石）/玄武岩三角洲（柱海）

import { AIR, BLOCK_BY_KEY, LAVA } from './blocks';
import { BIOME_SURFACE } from './biomes';
import { applyNetherStructures } from './netherstructures';
import { createNoise2D, createNoise3D } from 'simplex-noise';
import { hash2, hashString, mulberry32, type Biome, type Terrain } from './noise';
import { CHUNK_SIZE, WORLD_HEIGHT, localIndex } from './world';

export const LAVA_SEA = 31; // 岩浆海平面（MC 一致）
const BEDROCK_TOP = 122; // 天花板基岩起始（向上参差到 127）

const K = (key: string) => BLOCK_BY_KEY[key].id;

/** 下界地形：洞穴密度远高于主世界；heightAt 为洞穴顶板高度（生成器按列填充） */
export function createNetherTerrain(seed: string): Terrain {
  const sh = hashString(seed);
  const nHill = createNoise2D(mulberry32(sh ^ 0x7e57ab1e));
  const nCaveA = createNoise3D(mulberry32(sh ^ 0x5c1e7a));
  const nCaveB = createNoise3D(mulberry32(sh ^ 0x9d3f2b));
  const nCheese = createNoise3D(mulberry32(sh ^ 0x1a8c4d));
  // 下界群系场（三角洲柱海也用它加高加糙）
  const nNetherBio = createNoise2D(mulberry32(sh ^ 0x3f8c2a));
  const nDelta = createNoise2D(mulberry32(sh ^ 0x6d4b1e));

  function netherBiomeAt(x: number, z: number): Biome {
    const v = nNetherBio(x * 0.0018, z * 0.0018);
    if (v > 0.42) return 'warped_forest';
    if (v > 0.05) return 'crimson_forest';
    if (v > -0.42) return 'nether';
    if (v > -0.55) return 'soul_sand_valley';
    return 'basalt_deltas';
  }

  function heightAt(x: number, z: number): number {
    const hills = nHill(x * 0.012, z * 0.012);
    const detail = nHill(x * 0.05 + 400, z * 0.05 + 400);
    let h = 45 + hills * 22 + detail * 6;
    // 玄武岩三角洲：更高更糙（MC 柱海乱石滩）
    if (netherBiomeAt(x, z) === 'basalt_deltas') {
      h += 8 + (1 - Math.abs(nDelta(x * 0.03, z * 0.03))) * 18;
    }
    // 洞穴世界的"地表"即顶板：约 23-73 起伏，谷地浸入 y31 岩浆海（约两成覆盖面）
    return Math.max(8, Math.min(110, Math.floor(h)));
  }

  function caveAt(x: number, y: number, z: number): boolean {
    if (y < 5) return false; // 基岩地板保护区
    // 意面隧道（比主世界更密）
    const t = Math.abs(nCaveA(x * 0.028, y * 0.028, z * 0.028) + nCaveB(x * 0.028 + 700, y * 0.028, z * 0.028 + 700));
    if (t < 0.13) return true;
    // 奶酪洞腔：下界大而多（巨型空腔是 MC 下界标志）
    if (nCheese(x * 0.013, y * 0.022, z * 0.013) > 0.6) return true;
    return false;
  }

  return {
    kind: 'nether',
    heightAt,
    biomeAt: netherBiomeAt,
    treeAt: () => null,
    caveAt,
    snowlineAt: () => Infinity,
    undergroundAt: () => null,
    aquiferAt: () => false,
  };
}

/** 下界 chunk 生成（与主世界 generateChunk 并列，world.ts 按 terrain.kind 分发） */
export function generateNetherChunk(terrain: Terrain, cx: number, cz: number, data: Uint16Array, seedHash = 0): void {
  const netherrack = K('netherrack');
  const soulSand = K('soul_sand');
  const gravel = K('gravel');
  const glow = K('glowstone');
  const bedrock = K('bedrock');

  // 地形填充：下界岩 + 群系表层（菌岩/灵魂沙土/黑石）+ 灵魂沙/沙砾斑块
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = cx * CHUNK_SIZE + x;
      const wz = cz * CHUNK_SIZE + z;
      const h = terrain.heightAt(wx, wz);
      const top = Math.min(h, WORLD_HEIGHT - 1);
      const biome = terrain.biomeAt(wx, wz);
      const surf = BIOME_SURFACE[biome];
      const patch = hash2(seedHash ^ 0x61ab3f, wx, wz);
      for (let y = 0; y <= top; y++) {
        let id = netherrack;
        if (biome === 'basalt_deltas') {
          id = K('blackstone');
        } else if (biome === 'soul_sand_valley') {
          // 灵魂沙谷：灵魂沙为主，间灵魂土
          if (y >= top - 2) id = patch < 0.55 ? soulSand : K('soul_soil');
        } else if (y >= top - 2) {
          // 森林：顶三层菌岩；荒地：顶三层下界岩 + 斑块
          if (biome === 'warped_forest' || biome === 'crimson_forest') id = surf.top;
          else if (patch < 0.12) id = soulSand;
          else if (patch < 0.2) id = gravel;
        }
        data[localIndex(x, y, z)] = id;
      }
      // 岩浆海：地表低于海平面的部分灌岩浆（下界没有水）
      for (let y = top + 1; y <= LAVA_SEA; y++) data[localIndex(x, y, z)] = LAVA;
    }
  }

  // 洞穴雕刻（密集；矿石先填，洞壁即矿脉）
  applyNetherOres(seedHash, cx, cz, data);
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = cx * CHUNK_SIZE + x;
      const wz = cz * CHUNK_SIZE + z;
      const h = Math.min(terrain.heightAt(wx, wz), WORLD_HEIGHT - 1);
      for (let y = 5; y <= h; y++) {
        if (terrain.caveAt(wx, y, wz, h)) data[localIndex(x, y, z)] = AIR;
      }
    }
  }
  // 洞穴破入岩浆海：灌岩浆（MC 下界岩浆瀑布/地下岩浆湖）
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let y = LAVA_SEA; y >= 5; y--) {
        const i = localIndex(x, y, z);
        if (data[i] === AIR && data[localIndex(x, y + 1, z)] === LAVA) data[i] = LAVA;
      }
    }
  }

  // 基岩地板（y0 全铺，y1 半，y2 四分之一）与参差基岩天花板（y122-127 越上越密）
  const rand = mulberry32((seedHash ^ Math.imul(cx + 0x9e37, 0x85ebca6b) ^ Math.imul(cz + 0x27d4, 0x165667b1)) | 0);
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      data[localIndex(x, 0, z)] = bedrock;
      if (rand() < 0.5) data[localIndex(x, 1, z)] = bedrock;
      if (rand() < 0.25) data[localIndex(x, 2, z)] = bedrock;
      for (let y = BEDROCK_TOP; y < WORLD_HEIGHT; y++) {
        const p = (y - BEDROCK_TOP + 1) / (WORLD_HEIGHT - BEDROCK_TOP);
        if (rand() < p) data[localIndex(x, y, z)] = bedrock;
      }
    }
  }

  // 萤石簇：洞穴顶板下挂团（空气格、上方是下界岩；稀疏成簇）
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = cx * CHUNK_SIZE + x;
      const wz = cz * CHUNK_SIZE + z;
      for (let y = LAVA_SEA + 4; y < WORLD_HEIGHT - 8; y++) {
        const i = localIndex(x, y, z);
        if (data[i] !== AIR) continue;
        if (data[localIndex(x, y + 1, z)] !== netherrack) continue;
        const r = hash2(seedHash ^ 0x910ca5, wx * 31 + y, wz * 17 - y);
        if (r >= 0.006) continue;
        // 成簇：中心 + 邻格扩散
        data[i] = glow;
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]] as const) {
          const nx = x + dx;
          const ny = y + dy;
          const nz = z + dz;
          if (nx < 0 || nx >= CHUNK_SIZE || nz < 0 || nz >= CHUNK_SIZE) continue;
          const ni = localIndex(nx, ny, nz);
          if (data[ni] === AIR && hash2(seedHash ^ 0x910cb6, nx * 13 + ny, nz * 7 + y) < 0.5) data[ni] = glow;
        }
        y += 3; // 同列跳开，避免连珠
      }
    }
  }
  // 下界堡垒（桥廊 + 塔楼 + 地狱疣园 + 宝箱）
  applyNetherStructures(seedHash, terrain, cx, cz, data);

  // 群系标志物：巨型菌类树（诡异/绯红森林）、骨块化石（灵魂沙谷）、玄武岩柱（三角洲）
  applyNetherFeatures(seedHash, terrain, cx, cz, data);
}

/** 下界石英矿脉（石头团簇式随机游走；下界岩宿主） */
function applyNetherOres(seedHash: number, cx: number, cz: number, data: Uint16Array): void {
  const rand = mulberry32((seedHash ^ Math.imul(cx + 0x51f1, 0x85ebca6b) ^ Math.imul(cz + 0x27d4, 0x165667b1)) | 0);
  const netherrack = K('netherrack');
  const quartz = K('nether_quartz_ore');
  const magma = K('magma_block');
  // 石英：每 chunk 8-14 条，y 10-110 均匀（MC 下界石英全高度分布）
  for (let n = 0; n < 8 + Math.floor(rand() * 7); n++) {
    let x = Math.floor(rand() * CHUNK_SIZE);
    let y = 10 + Math.floor(rand() * 100);
    let z = Math.floor(rand() * CHUNK_SIZE);
    const size = 3 + Math.floor(rand() * 8);
    for (let s = 0; s < size; s++) {
      if (x >= 0 && x < CHUNK_SIZE && z >= 0 && z < CHUNK_SIZE && data[localIndex(x, y, z)] === netherrack) {
        data[localIndex(x, y, z)] = quartz;
      }
      x += Math.floor(rand() * 3) - 1;
      y = Math.max(6, Math.min(118, y + Math.floor(rand() * 3) - 1));
      z += Math.floor(rand() * 3) - 1;
    }
  }
  // 岩浆块团：y 24-38 岩浆海附近（MC 岩浆块带）
  for (let n = 0; n < 2 + Math.floor(rand() * 3); n++) {
    let x = Math.floor(rand() * CHUNK_SIZE);
    let y = 24 + Math.floor(rand() * 14);
    let z = Math.floor(rand() * CHUNK_SIZE);
    const size = 4 + Math.floor(rand() * 8);
    for (let s = 0; s < size; s++) {
      if (x >= 0 && x < CHUNK_SIZE && z >= 0 && z < CHUNK_SIZE && data[localIndex(x, y, z)] === netherrack) {
        data[localIndex(x, y, z)] = magma;
      }
      x += Math.floor(rand() * 3) - 1;
      y = Math.max(6, Math.min(118, y + Math.floor(rand() * 3) - 1));
      z += Math.floor(rand() * 3) - 1;
    }
  }
  // 远古残骸：y8-22 极稀有 1-2 簇 × 1-3 块（MC 峰值 y15；埋于下界岩内、防爆）
  const debris = K('ancient_debris');
  for (let n = 0; n < 1 + Math.floor(rand() * 2); n++) {
    let x = Math.floor(rand() * CHUNK_SIZE);
    let y = 8 + Math.floor(rand() * 15);
    let z = Math.floor(rand() * CHUNK_SIZE);
    const size = 1 + Math.floor(rand() * 3);
    for (let s = 0; s < size; s++) {
      if (x >= 0 && x < CHUNK_SIZE && z >= 0 && z < CHUNK_SIZE && data[localIndex(x, y, z)] === netherrack) {
        data[localIndex(x, y, z)] = debris;
      }
      x += Math.floor(rand() * 3) - 1;
      y = Math.max(8, Math.min(22, y + Math.floor(rand() * 3) - 1));
      z += Math.floor(rand() * 3) - 1;
    }
  }
}

/** 群系标志物：巨型菌类树/小菌与菌索（森林）、化石（灵魂沙谷）、玄武岩柱（三角洲） */
function applyNetherFeatures(seedHash: number, terrain: Terrain, cx: number, cz: number, data: Uint16Array): void {
  const put = (lx: number, y: number, lz: number, id: number, onlyAir: boolean) => {
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return;
    const i = localIndex(lx, y, lz);
    if (onlyAir && data[i] !== AIR) return;
    data[i] = id;
  };
  for (let tx = -3; tx < CHUNK_SIZE + 3; tx++) {
    for (let tz = -3; tz < CHUNK_SIZE + 3; tz++) {
      const wx = cx * CHUNK_SIZE + tx;
      const wz = cz * CHUNK_SIZE + tz;
      const biome = terrain.biomeAt(wx, wz);
      const h = terrain.heightAt(wx, wz);
      if (h <= LAVA_SEA + 1 || h + 16 >= WORLD_HEIGHT) continue;
      const r0 = hash2(seedHash ^ 0x77a1f3, wx, wz);
      if (biome === 'warped_forest' || biome === 'crimson_forest') {
        // 巨型菌类树：菌柄 6-10 高 + 疣块华盖 + 菌光体内嵌（MC 巨型菌）
        if (r0 < 0.012) {
          const warped = biome === 'warped_forest';
          const stem = K(warped ? 'warped_stem' : 'crimson_stem');
          const wart = K(warped ? 'warped_wart_block' : 'nether_wart_block');
          const H = 6 + Math.floor(hash2(seedHash ^ 0x77a2e4, wx, wz) * 5);
          for (let y = h + 1; y <= h + H; y++) put(tx, y, tz, stem, false);
          // 华盖：顶部两层 5×5 去角 + 顶 3×3，内嵌菌光体
          for (const ly of [h + H - 1, h + H]) {
            for (let dx = -2; dx <= 2; dx++) {
              for (let dz = -2; dz <= 2; dz++) {
                if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
                put(tx + dx, ly, tz + dz, wart, true);
              }
            }
          }
          for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) put(tx + dx, h + H + 1, tz + dz, wart, true);
          const shroom = K('shroomlight');
          if (hash2(seedHash ^ 0x77a3d5, wx, wz) < 0.6) put(tx + 1, h + H - 1, tz, shroom, true);
          if (hash2(seedHash ^ 0x77a4c6, wx, wz) < 0.4) put(tx - 1, h + H, tz + 1, shroom, true);
        } else if (r0 < 0.06) {
          // 小菌与菌索（地表植被）
          const warped = biome === 'warped_forest';
          const pick = hash2(seedHash ^ 0x77a5b7, wx, wz);
          const veg = pick < 0.4 ? K(warped ? 'warped_fungus' : 'crimson_fungus') : pick < 0.7 ? K(warped ? 'warped_roots' : 'crimson_roots') : K(warped ? 'crimson_roots' : 'warped_roots');
          if (data[localIndex(tx, h + 1, tz)] === AIR) put(tx, h + 1, tz, veg, true);
        }
      } else if (biome === 'soul_sand_valley') {
        // 化石：骨块肋拱（5 格弯肋，MC 灵魂沙谷化石）
        if (r0 < 0.004) {
          const bone = K('bone_block');
          for (let i = 0; i < 5; i++) {
            const dy = i < 3 ? i : 2;
            put(tx + i, h + 1 + dy, tz, bone, false);
            put(tx + i, h + 5 - dy, tz, bone, false);
          }
        }
      } else if (biome === 'basalt_deltas') {
        // 玄武岩柱：3-12 高细柱群（MC 三角洲柱海）
        if (r0 < 0.05) {
          const H = 3 + Math.floor(hash2(seedHash ^ 0x77a6c8, wx, wz) * 10);
          for (let y = h + 1; y <= h + H && y < WORLD_HEIGHT - 1; y++) put(tx, y, tz, K('basalt'), false);
        }
      }
    }
  }
}
