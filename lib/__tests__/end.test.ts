// 末地维度：主岛地形（中心隆起/边缘收束/四周虚空）、黑曜石柱环、祭坛与出生平台生成、末影人刷怪、维度映射

import { beforeEach, describe, expect, it } from 'vitest';
import { AIR, BLOCK_BY_KEY } from '../blocks';
import { mapCoords, otherDimension } from '../dimension';
import { createEndTerrain, END_ISLAND_R, END_SPAWN, endHeightAt, endPillars } from '../end';
import { clearMobs, mobs, trySpawn } from '../mobs';
import { hashString } from '../noise';
import { World } from '../world';

const K = (k: string) => BLOCK_BY_KEY[k].id;

function endWorld(seed = 'end-test'): World {
  return new World(seed, undefined, createEndTerrain(seed));
}

beforeEach(() => {
  clearMobs();
});

describe('末地地形', () => {
  it('岛心隆起、边缘走低、半径外虚空（-1）；同种子确定一致', () => {
    const sh = hashString('end-test');
    const center = endHeightAt(sh, 0, 0);
    const mid = endHeightAt(sh, 48, 0);
    const edge = endHeightAt(sh, END_ISLAND_R - 2, 0);
    expect(center).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThanOrEqual(edge - 4); // 边缘噪声起伏容差
    expect(endHeightAt(sh, END_ISLAND_R + 5, 0)).toBe(-1);
    expect(endHeightAt(sh, 0, END_ISLAND_R + 20)).toBe(-1);
    expect(endHeightAt(sh, 30, 40)).toBe(endHeightAt(hashString('end-test'), 30, 40)); // 确定性
  });

  it('chunk 生成：末地石岛体（倒锥，岛底悬空），柱/祭坛/平台各就各位', () => {
    const w = endWorld();
    // 岛心 chunk：末地石实体，岛底以下为虚空
    const h0 = w.terrain.heightAt(4, 4);
    expect(w.getBlock(4, h0, 4)).toBe(K('end_stone'));
    expect(w.getBlock(4, h0 - 3, 4)).toBe(K('end_stone'));
    let airBelow = 0;
    for (let y = 1; y < h0 - 30; y++) if (w.getBlock(4, y, 4) === AIR) airBelow++;
    expect(airBelow).toBeGreaterThan(10); // 倒锥：深层大多悬空
    // 岛外 chunk 全虚空
    const farX = END_ISLAND_R + 32;
    expect(w.getBlock(farX, 64, 0)).toBe(AIR);
    expect(w.getBlock(farX, 10, 0)).toBe(AIR);
    // 祭坛：中心 (0,0) 岛面上基岩坛 + 中心柱
    const ay = w.terrain.heightAt(0, 0);
    expect(w.getBlock(1, ay + 1, 0)).toBe(K('bedrock'));
    expect(w.getBlock(0, ay + 2, 0)).toBe(K('bedrock'));
    // 出生平台：5×5 黑曜石 y=49，上方净空
    expect(w.getBlock(100, 49, 0)).toBe(K('obsidian'));
    expect(w.getBlock(102, 49, -1)).toBe(K('obsidian'));
    expect(w.getBlock(100, 50, 0)).toBe(AIR);
  });

  it('黑曜石柱环：10 根、半径 42、高 76-106，柱身黑曜石 + 柱顶基岩座', () => {
    const sh = hashString('end-test');
    const pillars = endPillars(sh);
    expect(pillars).toHaveLength(10);
    for (const p of pillars) {
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(42, 0);
      expect(p.top).toBeGreaterThanOrEqual(76);
      expect(p.top).toBeLessThanOrEqual(106);
    }
    const w = endWorld();
    const p = pillars[0];
    expect(w.getBlock(p.x, p.top - 2, p.z)).toBe(K('obsidian'));
    expect(w.getBlock(p.x, p.top, p.z)).toBe(K('bedrock'));
  });
});

describe('末地刷怪', () => {
  it('末地石表面刷末影人（MC 末地主岛遍布末影人）', () => {
    const w = endWorld();
    // 预载岛心附近 chunk（刷怪只写已加载 chunk）
    for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) w.getChunk(cx, cz);
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) ok = trySpawn(w, 0.5, 0.5);
    expect(ok).toBe(true);
    expect(mobs.length).toBeGreaterThan(0);
    expect(mobs.every((m) => m.type === 'enderman')).toBe(true);
  });
});

describe('维度映射', () => {
  it('末地坐标 1:1；otherDimension 保持主世界↔下界互跳（末地不经此）', () => {
    expect(mapCoords({ x: 100, y: 50, z: -30 }, 'end')).toEqual({ x: 100, y: 50, z: -30 });
    expect(otherDimension('overworld')).toBe('nether');
    expect(otherDimension('nether')).toBe('overworld');
  });

  it('出生平台常量即 MC 固定点 (100,49,0) 上表面', () => {
    expect(END_SPAWN).toEqual({ x: 100.5, y: 50, z: 0.5 });
  });
});
