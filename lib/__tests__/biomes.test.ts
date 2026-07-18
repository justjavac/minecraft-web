// 生物群系：分类确定性、要素覆盖（沙漠/冰川/河流/海洋/森林）、河流与海洋形态

import { describe, expect, it } from 'vitest';
import { BLOCK_BY_KEY } from '../blocks';
import { BIOME_SURFACE } from '../biomes';
import { createTerrain, SEA_LEVEL } from '../noise';

const SEED = 'biome-test';

function sample(t: ReturnType<typeof createTerrain>, size: number) {
  const counts = new Map<string, number>();
  for (let x = -size; x < size; x += 4) {
    for (let z = -size; z < size; z += 4) {
      const b = t.biomeAt(x, z);
      counts.set(b, (counts.get(b) ?? 0) + 1);
    }
  }
  return counts;
}

describe('生物群系', () => {
  it('分类确定性一致', () => {
    const t = createTerrain(SEED);
    for (const [x, z] of [[0, 0], [100, -50], [-300, 700]]) {
      expect(t.biomeAt(x, z)).toBe(t.biomeAt(x, z));
    }
  });

  it('大尺度采样覆盖主要群系（沙漠/冰川/森林/海洋/河流）', () => {
    const t = createTerrain(SEED);
    const counts = sample(t, 2000);
    for (const b of ['desert', 'ice', 'forest', 'plains']) {
      expect(counts.get(b) ?? 0, b).toBeGreaterThan(0);
    }
    expect(counts.get('ocean') ?? 0, 'ocean').toBeGreaterThan(0);
    expect(counts.get('river') ?? 0, 'river').toBeGreaterThan(0);
  });

  it('河流：通道内水位达到海平面', () => {
    const t = createTerrain(SEED);
    let checked = 0;
    for (let x = -2000; x < 2000 && checked < 50; x += 3) {
      for (let z = -2000; z < 2000 && checked < 50; z += 3) {
        if (t.biomeAt(x, z) !== 'river') continue;
        const h = t.heightAt(x, z);
        // 河床低于海平面（能蓄水），且不深不见底
        expect(h).toBeLessThan(SEA_LEVEL);
        expect(h).toBeGreaterThan(SEA_LEVEL - 6);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('海洋：海床明显低于海平面', () => {
    const t = createTerrain(SEED);
    let checked = 0;
    for (let x = -2000; x < 2000 && checked < 30; x += 5) {
      for (let z = -2000; z < 2000 && checked < 30; z += 5) {
        if (t.biomeAt(x, z) !== 'ocean') continue;
        expect(t.heightAt(x, z)).toBeLessThanOrEqual(SEA_LEVEL - 4);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('群系表层映射完整（冰原覆雪草+冰面，沙漠全沙）', () => {
    expect(BIOME_SURFACE.ice.top).toBe(BLOCK_BY_KEY.snowy_grass.id);
    expect(BIOME_SURFACE.ice.waterTop).toBe(BLOCK_BY_KEY.ice.id);
    expect(BIOME_SURFACE.desert.top).toBe(BLOCK_BY_KEY.sand.id);
    expect(BIOME_SURFACE.desert.filler).toBe(BLOCK_BY_KEY.sand.id);
  });

  it('树木按群系分布：森林远多于沙漠/海洋', () => {
    const t = createTerrain(SEED);
    let forestTrees = 0;
    let desertTrees = 0;
    let oceanTrees = 0;
    for (let x = -1000; x < 1000; x += 2) {
      for (let z = -1000; z < 1000; z += 2) {
        const b = t.biomeAt(x, z);
        const tree = t.treeAt(x, z);
        if (!tree) continue;
        if (b === 'forest') forestTrees++;
        else if (b === 'desert') desertTrees++;
        else if (b === 'ocean') oceanTrees++;
      }
    }
    expect(forestTrees).toBeGreaterThan(50);
    expect(desertTrees).toBe(0);
    expect(oceanTrees).toBe(0);
  });
});
