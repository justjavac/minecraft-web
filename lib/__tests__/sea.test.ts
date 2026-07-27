// 海洋内容：蘑菇牛与蘑菇岛和平规则、海底遗迹、沉船

import { beforeEach, describe, expect, it } from 'vitest';
import { BLOCK_BY_KEY } from '../blocks';
import { worldClock } from '../game';
import { clearMobs, mobs, trySpawn } from '../mobs';
import type { Terrain } from '../noise';
import { clearStorages, getStorage } from '../storage';
import { applyStructures, structureAt } from '../structures';
import { CHUNK_VOLUME, World } from '../world';

const K = (k: string) => BLOCK_BY_KEY[k].id;

const oceanTerrain = (h: number): Terrain => ({
  heightAt: () => h,
  biomeAt: () => 'ocean' as const,
  treeAt: () => null,
  caveAt: () => false,
  snowlineAt: () => Infinity,
  undergroundAt: () => null,
  aquiferAt: () => false,
});

const mushTerrain: Terrain = {
  heightAt: () => 45,
  biomeAt: () => 'mushroom_fields' as const,
  treeAt: () => null,
  caveAt: () => false,
  snowlineAt: () => Infinity,
  undergroundAt: () => null,
  aquiferAt: () => false,
};

function findSpot(seedHash: number, t: Terrain, kind: string): { x: number; z: number } {
  for (let rx = 0; rx < 60; rx++) {
    for (let rz = 0; rz < 60; rz++) {
      const s = structureAt(seedHash, t, rx, rz);
      if (s?.kind === kind) return s;
    }
  }
  throw new Error(`未找到 ${kind}`);
}

beforeEach(() => {
  clearMobs();
  clearStorages();
});

describe('蘑菇岛规则（MC：不刷敌对生物，只出蘑菇牛）', () => {
  it('白天在菌丝上生成蘑菇牛', () => {
    const w = new World('mush-isle-day', undefined, mushTerrain);
    // 预载生成环覆盖的 chunk（trySpawn 只读已加载 chunk）
    for (let cx = -4; cx <= 4; cx++) for (let cz = -4; cz <= 4; cz++) w.getChunk(cx, cz);
    worldClock.t = 0.3; // 白天
    let spawned = false;
    for (let i = 0; i < 30 && !spawned; i++) spawned = trySpawn(w, 8, 8);
    expect(spawned).toBe(true);
    expect(mobs.some((m) => m.type === 'mooshroom')).toBe(true);
  });

  it('夜晚蘑菇岛不刷任何怪', () => {
    const w = new World('mush-isle-night', undefined, mushTerrain);
    worldClock.t = 0.75; // 夜晚
    for (let i = 0; i < 20; i++) expect(trySpawn(w, 8, 8)).toBe(false);
    expect(mobs.length).toBe(0);
    worldClock.t = 0.3; // 复原，避免影响其他用例
  });
});

describe('海底遗迹', () => {
  it('深海出遗迹：金块核心 + 湿海绵房 + 海晶灯窗', () => {
    const t = oceanTerrain(25);
    const spot = findSpot(777, t, 'ocean_monument');
    const ccx = Math.floor(spot.x / 16);
    const ccz = Math.floor(spot.z / 16);
    const data = new Uint16Array(CHUNK_VOLUME);
    for (let cx = ccx - 1; cx <= ccx + 1; cx++) for (let cz = ccz - 1; cz <= ccz + 1; cz++) applyStructures(777, t, cx, cz, data);
    const found = new Set<number>();
    for (const v of data) found.add(v);
    expect(found.has(K('gold_block'))).toBe(true);
    expect(found.has(K('wet_sponge'))).toBe(true);
    expect(found.has(K('sea_lantern'))).toBe(true);
    expect(found.has(K('prismarine_bricks'))).toBe(true);
    expect(found.has(K('dark_prismarine'))).toBe(true);
  });
});

describe('沉船', () => {
  it('海床出沉船：木壳 + 桅杆 + 尾舱宝箱（战利品预填）', () => {
    const t = oceanTerrain(36);
    const spot = findSpot(555, t, 'shipwreck');
    const ccx = Math.floor(spot.x / 16);
    const ccz = Math.floor(spot.z / 16);
    const data = new Uint16Array(CHUNK_VOLUME);
    for (let cx = ccx - 1; cx <= ccx + 1; cx++) for (let cz = ccz - 1; cz <= ccz + 1; cz++) applyStructures(555, t, cx, cz, data);
    const found = new Set<number>();
    for (const v of data) found.add(v);
    expect(found.has(K('chest'))).toBe(true);
    expect(found.has(K('planks')) || found.has(K('spruce_planks'))).toBe(true);
    // 尾舱宝箱（bx+3, by+3, bz）
    const loot = getStorage(`${spot.x + 3},${t.heightAt(spot.x, spot.z) + 4},${spot.z}`);
    expect(loot.some((s) => s !== null)).toBe(true);
  });
});
