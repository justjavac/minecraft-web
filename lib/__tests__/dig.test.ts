// 挖掘时间：digTime 表为 MC 徒手时间（需镐方块 = 硬度×5，徒手可采 = 硬度×1.5），
// 工具匹配切 ×1.5 基值（×0.3）再除倍率；效率附魔仅匹配生效

import { describe, expect, it } from 'vitest';
import { BLOCK_BY_KEY } from '../blocks';
import { effectiveDigTime } from '../dig';
import type { Slot } from '../slots';
import type { ToolType } from '../tools';
import type { EnchMap } from '../xp';

const K = (k: string) => BLOCK_BY_KEY[k].id;
const tool = (t: ToolType, ench?: EnchMap): Slot => ({ kind: 'tool', tool: t, durability: 100, ench });

describe('有效挖掘时间（MC 基值）', () => {
  it('需镐方块：工具匹配按 hardness×1.5/工具倍率（digTime×0.3/speed）', () => {
    // 黑曜石 250（硬度 50×5）：钻镐 250×0.3/8 = 9.375s（MC 9.4s）
    expect(effectiveDigTime(K('obsidian'), tool('diamond_pickaxe'), false)).toBeCloseTo(9.375, 3);
    // 石头 7.5（硬度 1.5×5）：木镐 7.5×0.3/2 = 1.125s（MC 1.13s）
    expect(effectiveDigTime(BLOCK_BY_KEY.stone.id, tool('wooden_pickaxe'), false)).toBeCloseTo(1.125, 3);
    // 远古残骸 150（硬度 30×5）：钻镐 5.625s（MC 一致）
    expect(effectiveDigTime(K('ancient_debris'), tool('diamond_pickaxe'), false)).toBeCloseTo(5.625, 3);
    // 煤矿石 15（硬度 3×5）：木镐 2.25s
    expect(effectiveDigTime(K('coal_ore'), tool('wooden_pickaxe'), false)).toBeCloseTo(2.25, 3);
  });

  it('徒手/错工具：保持 digTime（需镐方块 = 硬度×5 慢速）', () => {
    expect(effectiveDigTime(K('obsidian'), null, false)).toBe(250);
    expect(effectiveDigTime(BLOCK_BY_KEY.stone.id, null, false)).toBe(7.5);
    // 斧挖石头类型不匹配：不加速
    expect(effectiveDigTime(BLOCK_BY_KEY.stone.id, tool('diamond_axe'), false)).toBe(7.5);
    // 剑不是挖掘工具：挖泥土也不加速
    expect(effectiveDigTime(BLOCK_BY_KEY.dirt.id, tool('diamond_sword'), false)).toBe(0.75);
  });

  it('徒手可采方块（×1.5 基值）：工具匹配直接除倍率，不再乘 0.3', () => {
    // 泥土 0.75（硬度 0.5×1.5）：木锹 0.375s（MC 一致）
    expect(effectiveDigTime(BLOCK_BY_KEY.dirt.id, tool('wooden_shovel'), false)).toBeCloseTo(0.375, 3);
    // 原木 3（硬度 2×1.5）：钻斧 0.375s
    expect(effectiveDigTime(K('log'), tool('diamond_axe'), false)).toBeCloseTo(0.375, 3);
  });

  it('效率附魔仅工具匹配时生效（+30%/级）', () => {
    // 钻镐效率 V 挖石头：7.5×0.3/(8×(1+0.3×5))
    expect(effectiveDigTime(BLOCK_BY_KEY.stone.id, tool('diamond_pickaxe', { efficiency: 5 }), false)).toBeCloseTo(2.25 / 20, 4);
    // 错工具带效率：不加速（MC 不允许）
    expect(effectiveDigTime(BLOCK_BY_KEY.stone.id, tool('diamond_axe', { efficiency: 5 }), false)).toBe(7.5);
  });

  it('急迫：匹配与不匹配都 +30%', () => {
    expect(effectiveDigTime(BLOCK_BY_KEY.stone.id, tool('wooden_pickaxe'), true)).toBeCloseTo(1.125 / 1.3, 4);
    expect(effectiveDigTime(BLOCK_BY_KEY.dirt.id, null, true)).toBeCloseTo(0.75 / 1.3, 4);
  });
});
