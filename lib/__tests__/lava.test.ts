// 岩浆：定义属性 + 深层洞穴岩浆湖生成 + 流水 id 段回归

import { describe, expect, it } from 'vitest';
import { AIR, BLOCKS, BLOCK_BY_KEY, isLavaId, isWaterId, LAVA, WATER_FLOW_1 } from '../blocks';
import { waterLevel } from '../fluids';
import { World } from '../world';

describe('流水 id 段回归（14-20 连续，不与其他方块撞号）', () => {
  it('WATER_FLOW_1 起 7 级连续', () => {
    for (let lv = 1; lv <= 7; lv++) {
      expect(BLOCKS[WATER_FLOW_1 + lv - 1].key).toBe(`water_flow_${lv}`);
      expect(waterLevel(WATER_FLOW_1 + lv - 1)).toBe(lv);
    }
  });

  it('普通方块不被误判为水', () => {
    expect(waterLevel(BLOCK_BY_KEY.granite.id)).toBe(-1);
    expect(waterLevel(BLOCK_BY_KEY.polished_granite.id)).toBe(-1);
    expect(isWaterId(BLOCK_BY_KEY.crafting_table.id)).toBe(false);
    expect(isWaterId(BLOCK_BY_KEY.furnace.id)).toBe(false);
  });
});

describe('岩浆定义', () => {
  it('发光 15、非实心、不可选中、不参与水系', () => {
    const def = BLOCKS[LAVA];
    expect(def.key).toBe('lava');
    expect(def.light).toBe(15);
    expect(def.solid).toBe(false);
    expect(isLavaId(LAVA)).toBe(true);
    expect(isWaterId(LAVA)).toBe(false);
    expect(waterLevel(LAVA)).toBe(-1);
  });
});

describe('深层岩浆湖生成', () => {
  it('y≤10 的洞腔灌岩浆，以上保持空气', () => {
    // 人造地形：y 4-20 全雕空的大洞腔
    const cavern = {
      heightAt: () => 30,
      biomeAt: () => 'plains' as const,
      treeAt: () => null,
      caveAt: (_x: number, y: number) => y >= 4 && y <= 20,
    };
    const w = new World('lava-lake', undefined, cavern);
    expect(w.getBlock(8, 4, 8)).toBe(LAVA);
    expect(w.getBlock(8, 10, 8)).toBe(LAVA);
    expect(w.getBlock(8, 11, 8)).toBe(AIR);
    expect(w.getBlock(8, 20, 8)).toBe(AIR);
    // 洞底（y=3 未雕空）仍是实心
    expect(BLOCKS[w.getBlock(8, 3, 8)].solid).toBe(true);
  });

  it('真实地形深洞里能找到岩浆湖', () => {
    const w = new World('lava-real');
    let lava = 0;
    for (let x = 0; x < 64; x++) {
      for (let z = 0; z < 64; z++) {
        for (let y = 2; y <= 10; y++) {
          if (w.getBlock(x, y, z) === LAVA) lava++;
        }
      }
    }
    expect(lava).toBeGreaterThan(0);
  });
});
