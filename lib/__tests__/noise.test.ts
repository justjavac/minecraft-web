import { describe, expect, it } from 'vitest';
import { createTerrain, SEA_LEVEL } from '../noise';
import { WORLD_HEIGHT } from '../world';

describe('createTerrain', () => {
  it('相同种子生成相同地形', () => {
    const a = createTerrain('hello');
    const b = createTerrain('hello');
    for (let i = 0; i < 200; i++) {
      expect(a.heightAt(i * 7 - 500, i * 13 - 500)).toBe(b.heightAt(i * 7 - 500, i * 13 - 500));
      expect(a.treeAt(i * 11, i * 17)).toBe(b.treeAt(i * 11, i * 17));
    }
  });

  it('不同种子地形不同', () => {
    const a = createTerrain('seed-a');
    const b = createTerrain('seed-b');
    let diff = 0;
    for (let i = 0; i < 100; i++) {
      if (a.heightAt(i * 7, i * 13) !== b.heightAt(i * 7, i * 13)) diff++;
    }
    expect(diff).toBeGreaterThan(10);
  });

  it('高度在合理范围内', () => {
    const t = createTerrain('range-check');
    for (let i = 0; i < 2000; i++) {
      const h = t.heightAt(i * 3 - 3000, i * 5 - 2000);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(WORLD_HEIGHT - 10);
    }
  });

  it('树木分布确定性且稀疏', () => {
    const t = createTerrain('trees');
    let count = 0;
    const total = 10000;
    for (let i = 0; i < total; i++) {
      if (t.treeAt(i % 100, Math.floor(i / 100))) count++;
    }
    // 约 0.8% 密度，允许 0.2% ~ 2% 波动
    expect(count).toBeGreaterThan(total * 0.002);
    expect(count).toBeLessThan(total * 0.02);
  });

  it('海平面常量合理', () => {
    expect(SEA_LEVEL).toBeGreaterThan(0);
    expect(SEA_LEVEL).toBeLessThan(WORLD_HEIGHT - 10);
  });

  it('洞穴：确定性一致，地下存在洞腔，基岩层不雕，地表大体完整', () => {
    const t = createTerrain('cave-check');
    // 确定性
    for (const [x, y, z] of [[10, 20, 30], [-50, 12, 70]]) {
      expect(t.caveAt(x, y, z)).toBe(t.caveAt(x, y, z));
    }
    // 基岩层保护
    for (let x = -100; x < 100; x += 7) {
      expect(t.caveAt(x, 0, 0)).toBe(false);
      expect(t.caveAt(x, 3, 0)).toBe(false);
    }
    // 地下有洞（大样本中至少有洞腔）
    let caves = 0;
    let surfaceCaves = 0;
    for (let x = -300; x < 300; x += 3) {
      for (let z = -300; z < 300; z += 3) {
        const h = t.heightAt(x, z);
        for (let y = 6; y < h - 3; y += 2) {
          if (t.caveAt(x, y, z)) caves++;
        }
        if (t.caveAt(x, h - 1, z)) surfaceCaves++;
      }
    }
    expect(caves).toBeGreaterThan(1000);
    // 地表破开率低（隧道不出地表，仅奶酪偶尔）
    expect(surfaceCaves).toBeLessThan(2000);
  });
});
