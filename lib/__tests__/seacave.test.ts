// 海底洞穴灌水：水下洞腔被水填满，陆地洞穴保持空气

import { describe, expect, it } from 'vitest';
import { AIR, WATER } from '../blocks';
import { SEA_LEVEL } from '../noise';
import { World } from '../world';

describe('海底洞穴灌水', () => {
  it('水下洞腔灌满水（洞口开在海床上的柱洞）', () => {
    const terrain = {
      heightAt: () => 18, // 海床低于海平面 22
      biomeAt: () => 'ocean' as const,
      treeAt: () => null,
      caveAt: (_x: number, y: number) => y >= 8 && y <= 18, // 直通海床面的开放洞
    };
    const w = new World('flood-test', undefined, terrain);
    // 洞口到洞底全部是水（灌水也会挡住岩浆填充）
    for (let y = 8; y <= 18; y++) {
      expect(w.getBlock(8, y, 8)).toBe(WATER);
    }
    // 洞底以下仍是实心
    expect(w.getBlock(8, 7, 8)).not.toBe(WATER);
    expect(w.getBlock(8, 7, 8)).not.toBe(AIR);
    // 海面水层正常
    expect(w.getBlock(8, SEA_LEVEL, 8)).toBe(WATER);
  });

  it('陆地洞穴保持空气（山地 y=40 的洞）', () => {
    const terrain = {
      heightAt: () => 40,
      biomeAt: () => 'plains' as const,
      treeAt: () => null,
      caveAt: (_x: number, y: number) => y >= 20 && y <= 30,
    };
    const w = new World('dry-cave', undefined, terrain);
    expect(w.getBlock(8, 25, 8)).toBe(AIR);
  });
});
