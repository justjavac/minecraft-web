// 程序化地形：多噪声场（大陆/山丘/温度/湿度/河流/盆地）+ 生物群系判定 + 分群系树木分布 + 3D 噪声洞穴

import { createNoise2D, createNoise3D } from 'simplex-noise';

export const SEA_LEVEL = 22;

/** 生物群系（主世界） */
export type Biome = 'plains' | 'forest' | 'desert' | 'ice' | 'ocean' | 'river' | 'basin';

/** 树木种类（对应 blocks 中的 <type>_log / <type>_leaves） */
export type TreeKind = 'oak' | 'birch' | 'spruce';

export interface Terrain {
  /** 世界列高度（地表方块的 y 坐标），-1 表示虚空 */
  heightAt(x: number, z: number): number;
  /** 该列的群系（确定性） */
  biomeAt(x: number, z: number): Biome;
  /** 该列长什么树（null = 无树，按群系密度与种类） */
  treeAt(x: number, z: number): TreeKind | null;
  /** 该位置是否被洞穴雕刻（3D 噪声：意面隧道 + 奶酪洞腔） */
  caveAt(x: number, y: number, z: number): boolean;
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 列级确定性哈希 → [0, 1) */
export function hash2(seed: number, x: number, z: number): number {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(z, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** 河流通道阈值（|riverNoise| 小于它就是河） */
export const RIVER_WIDTH = 0.045;

export function createTerrain(seed: string): Terrain {
  const sh = hashString(seed);
  // 各噪声场独立播种（互不影响，便于分别调参）
  const nCont = createNoise2D(mulberry32(sh ^ 0x1a2b3c));
  const nHill = createNoise2D(mulberry32(sh ^ 0x4d5e6f));
  const nRiver = createNoise2D(mulberry32(sh ^ 0x708192));
  const nEro = createNoise2D(mulberry32(sh ^ 0xa3b4c5));
  const nTemp = createNoise2D(mulberry32(sh ^ 0xd6e7f8));
  const nHumid = createNoise2D(mulberry32(sh ^ 0x091a2b));
  // 洞穴 3D 噪声：意面隧道双场 + 奶酪洞腔
  const nCaveA = createNoise3D(mulberry32(sh ^ 0x1f2e3d));
  const nCaveB = createNoise3D(mulberry32(sh ^ 0x4c5a6b));
  const nCheese = createNoise3D(mulberry32(sh ^ 0x7d8e9f));

  const riverField = (x: number, z: number) => nRiver(x * 0.006, z * 0.006);
  const erosion = (x: number, z: number) => nEro(x * 0.0022, z * 0.0022);
  const temperature = (x: number, z: number) => nTemp(x * 0.0016, z * 0.0016);
  const humidity = (x: number, z: number) => nHumid(x * 0.0016, z * 0.0016);

  function heightAt(x: number, z: number): number {
    const cont = nCont(x * 0.004, z * 0.004); // -1..1 大陆尺度
    const hills = nHill(x * 0.015, z * 0.015);
    const detail = nHill(x * 0.06, z * 0.06);
    let h = 24 + cont * 12 + hills * 5 + detail * 1.5;
    // 盆地：侵蚀值低的区域下沉并压平（低洼平旷，常积水成湖）
    const basin = smoothstep(-0.18, -0.5, erosion(x, z));
    h = h * (1 - basin * 0.45) + 20 * basin * 0.45 - basin * 6;
    // 海洋：大陆值很低的区域进一步下压成深海
    if (cont < -0.45) h -= (-0.45 - cont) * 16;
    // 河流：只雕刻近海平面的陆地（河道入海即止，不把深海抠成深渊）
    const rv = Math.abs(riverField(x, z));
    if (rv < RIVER_WIDTH && h > SEA_LEVEL - 6) {
      const depth = 1 - rv / RIVER_WIDTH;
      h = Math.min(h, SEA_LEVEL - 1 - Math.floor(depth * 3));
    }
    return Math.max(1, Math.floor(h));
  }

  function caveAt(x: number, y: number, z: number): boolean {
    if (y < 4) return false; // 基岩层保护区
    const h = heightAt(x, z);
    // 意面隧道：双 3D 噪声叠加出蜿蜒通道，埋藏在地下
    if (y <= h - 3) {
      const t = Math.abs(nCaveA(x * 0.03, y * 0.03, z * 0.03) + nCaveB(x * 0.03 + 500, y * 0.03, z * 0.03 + 500));
      if (t < 0.11) return true;
    }
    // 奶酪洞腔：大型洞窟，偶尔破出地表
    if (y <= h - 1 && nCheese(x * 0.011, y * 0.02, z * 0.011) > 0.72) return true;
    return false;
  }

  /** 群系分类（heightAt 由调用方算好传入，避免重复求值） */
  function classify(x: number, z: number, h: number): Biome {
    // 深海（海床明显低于海平面；判在河流之前，深水道归海洋）
    if (h <= SEA_LEVEL - 4) return 'ocean';
    // 河流水域及两岸浅滩
    const rv = Math.abs(riverField(x, z));
    if (rv < RIVER_WIDTH && h <= SEA_LEVEL + 1) return 'river';
    const temp = temperature(x, z);
    const humid = humidity(x, z);
    if (temp < -0.28) return 'ice';
    if (temp > 0.35 && humid < 0.05) return 'desert';
    if (erosion(x, z) < -0.3) return 'basin';
    if (humid > 0.22) return 'forest';
    return 'plains';
  }

  function biomeAt(x: number, z: number): Biome {
    return classify(x, z, heightAt(x, z));
  }

  /** 各群系树木密度与种类 */
  function treeAt(x: number, z: number): TreeKind | null {
    const h = heightAt(x, z);
    if (h <= SEA_LEVEL + 1) return null; // 水下/水边不长树
    const biome = classify(x, z, h);
    let chance = 0;
    let kinds: TreeKind[] = [];
    switch (biome) {
      case 'forest':
        chance = 0.03;
        kinds = ['oak', 'birch', 'spruce'];
        break;
      case 'plains':
      case 'basin':
        chance = 0.005;
        kinds = ['oak'];
        break;
      case 'ice':
        chance = 0.004;
        kinds = ['spruce'];
        break;
      default:
        return null; // desert / ocean / river 不长树
    }
    const r = hash2(sh ^ 0x7ee5a1c3, x, z);
    if (r >= chance) return null;
    return kinds[Math.floor(hash2(sh ^ 0x31c8d2, x, z) * kinds.length)];
  }

  return { heightAt, biomeAt, treeAt, caveAt };
}

/** 全空地形，供测试使用 */
export const VOID_TERRAIN: Terrain = {
  heightAt: () => -1,
  biomeAt: () => 'plains',
  treeAt: () => null,
  caveAt: () => false,
};
