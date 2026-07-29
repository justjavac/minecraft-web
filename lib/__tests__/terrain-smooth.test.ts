// 地形平滑度：河岸/平原不得出现断裂峡谷（单步落差受限 + 陡坡占比受限）
import { describe, expect, it } from 'vitest';
import { createTerrain, SEA_LEVEL, type Biome } from '../noise';

function sample(biome: Biome) {
  const t = createTerrain('smooth-river-1');
  let columns = 0;
  let maxStep = 0;
  let over6 = 0;
  for (let x = -1500; x < 1500; x += 3) {
    for (let z = -1500; z < 1500; z += 3) {
      if (t.biomeAt(x, z) !== biome) continue;
      columns++;
      for (const [dx, dz] of [[1, 0], [0, 1]] as const) {
        const step = Math.abs(t.heightAt(x + dx, z + dz) - t.heightAt(x, z));
        if (step > maxStep) maxStep = step;
        if (step > 6) over6++;
      }
    }
  }
  return { columns, maxStep, over6 };
}

describe('地形平滑（无断裂峡谷）', () => {
  it('河流：河床在水下，河道足够宽（MC 河宽量级）', () => {
    const t = createTerrain('smooth-river-1');
    let river = 0;
    let belowSea = 0;
    for (let x = -1500; x < 1500; x += 5) {
      for (let z = -1500; z < 1500; z += 5) {
        if (t.biomeAt(x, z) !== 'river') continue;
        river++;
        if (t.heightAt(x, z) < SEA_LEVEL) belowSea++;
      }
    }
    expect(river).toBeGreaterThan(100);
    expect(belowSea / river).toBeGreaterThan(0.7); // 河床大部在水下
  });

  it('河流：无 >10 格单步落差，>6 格陡坡占比 <0.5%（旧硬切：最大 24 格、占比 2%）', () => {
    const s = sample('river');
    expect(s.columns).toBeGreaterThan(1000);
    expect(s.maxStep).toBeLessThanOrEqual(10);
    expect(s.over6 / s.columns).toBeLessThan(0.005);
  });

  it('平原：无 >10 格单步落差，>6 格陡坡占比 <0.1%（旧：最大 13 格）', () => {
    const s = sample('plains');
    expect(s.columns).toBeGreaterThan(1000);
    expect(s.maxStep).toBeLessThanOrEqual(10);
    expect(s.over6 / s.columns).toBeLessThan(0.001);
  });
});
