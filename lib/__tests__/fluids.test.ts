// 流体传播：水位识别 + 下流水柱 + 落地扩散

import { describe, expect, it } from 'vitest';
import { AIR, STONE, WATER, WATER_FLOW_1 } from '../blocks';
import { tickFluids, waterLevel } from '../fluids';
import { VOID_TERRAIN } from '../noise';
import { World } from '../world';

const FLOW = (n: number) => WATER_FLOW_1 + n - 1;

describe('流体传播', () => {
  it('waterLevel 识别源/流水/非水', () => {
    expect(waterLevel(WATER)).toBe(0);
    expect(waterLevel(FLOW(1))).toBe(1);
    expect(waterLevel(FLOW(7))).toBe(7);
    expect(waterLevel(AIR)).toBe(-1);
    expect(waterLevel(STONE)).toBe(-1);
  });

  it('悬空水源向下流成水柱', () => {
    const w = new World('fluid-fall', undefined, VOID_TERRAIN);
    w.setBlock(8, 30, 8, WATER);
    for (let i = 0; i < 10; i++) tickFluids(w, 128);
    expect(w.getBlock(8, 29, 8)).toBe(FLOW(1));
    expect(w.getBlock(8, 25, 8)).toBe(FLOW(1));
    expect(w.getBlock(8, 21, 8)).toBe(FLOW(1));
  });

  it('落地后向四方扩散且等级递增（最多 7 级）', () => {
    const w = new World('fluid-spread', undefined, VOID_TERRAIN);
    for (let x = 2; x <= 10; x++) {
      for (let z = 2; z <= 10; z++) w.setBlock(x, 10, z, STONE);
    }
    w.setBlock(6, 11, 6, WATER);
    for (let i = 0; i < 6; i++) tickFluids(w, 256);
    // 四周 1 级
    expect(waterLevel(w.getBlock(7, 11, 6))).toBe(1);
    expect(waterLevel(w.getBlock(5, 11, 6))).toBe(1);
    expect(waterLevel(w.getBlock(6, 11, 7))).toBe(1);
    // 继续扩散出 2 级
    for (let i = 0; i < 6; i++) tickFluids(w, 256);
    expect(waterLevel(w.getBlock(8, 11, 6))).toBe(2);
    // 源永不降级/消失
    expect(w.getBlock(6, 11, 6)).toBe(WATER);
  });

  it('扩散不超过 7 级', () => {
    const w = new World('fluid-max', undefined, VOID_TERRAIN);
    for (let x = 0; x < 32; x++) w.setBlock(x, 10, 0, STONE);
    w.setBlock(0, 11, 0, WATER);
    for (let i = 0; i < 30; i++) tickFluids(w, 512);
    // 最远处等级 ≤ 7，且不会无限传播
    for (let x = 1; x < 32; x++) {
      const lv = waterLevel(w.getBlock(x, 11, 0));
      expect(lv === -1 || (lv >= 1 && lv <= 7)).toBe(true);
    }
    expect(waterLevel(w.getBlock(31, 11, 0))).not.toBe(8);
  });
});
