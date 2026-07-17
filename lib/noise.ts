// 程序化地形：simplex 噪声高度图 + 确定性树木分布

import { createNoise2D } from 'simplex-noise';

export const SEA_LEVEL = 22;

export interface Terrain {
  /** 世界列高度（地表方块的 y 坐标），-1 表示虚空 */
  heightAt(x: number, z: number): number;
  /** 该列是否长树（按列哈希，跨 chunk 确定性一致） */
  treeAt(x: number, z: number): boolean;
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
function hash2(seed: number, x: number, z: number): number {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(z, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function createTerrain(seed: string): Terrain {
  const sh = hashString(seed);
  const noise = createNoise2D(mulberry32(sh));
  return {
    heightAt(x: number, z: number): number {
      const continent = noise(x * 0.004, z * 0.004) * 12;
      const hills = noise(x * 0.015, z * 0.015) * 5;
      const detail = noise(x * 0.06, z * 0.06) * 1.5;
      return Math.floor(24 + continent + hills + detail);
    },
    treeAt(x: number, z: number): boolean {
      return hash2(sh, x, z) < 0.008;
    },
  };
}

/** 全空地形，供测试使用 */
export const VOID_TERRAIN: Terrain = {
  heightAt: () => -1,
  treeAt: () => false,
};
