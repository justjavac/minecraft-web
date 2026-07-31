// MC Java 1.9 战斗数值：攻击冷却伤害缩放（attackCooldownScale）+ 斧头伤害/攻速

import { describe, expect, it } from 'vitest';
import { attackCooldownScale, TOOLS } from '../tools';

describe('攻击冷却伤害缩放（MC 1.9：0.2 + ((t+0.5)/T)²×0.8，封顶 1）', () => {
  it('冷却走满 = 满额（封顶 1）', () => {
    expect(attackCooldownScale(0.625, 0.625)).toBe(1); // 剑走满
    expect(attackCooldownScale(1.25, 1.25)).toBe(1); // 木斧走满
    expect(attackCooldownScale(2, 1.25)).toBe(1); // 超出也封顶
  });

  it('冷却未满伤害大减：木斧（T=1.25）刚出手再点 = 32.8%', () => {
    // 0.2 + (0.5/1.25)²×0.8 = 0.2 + 0.128 = 0.328
    expect(attackCooldownScale(0, 1.25)).toBeCloseTo(0.328, 3);
  });

  it('木斧冷却过半（t=0.5）：(1.0/1.25)²×0.8+0.2 = 71.2%', () => {
    expect(attackCooldownScale(0.5, 1.25)).toBeCloseTo(0.712, 3);
  });

  it('剑（T=0.625）恢复快：t=0.125 即回满（(0.625/0.625)²×0.8+0.2 = 1）', () => {
    expect(attackCooldownScale(0.125, 0.625)).toBe(1);
  });

  it('非法输入兜底：T≤0 视为满额；负 t 按 0 计', () => {
    expect(attackCooldownScale(0, 0)).toBe(1);
    expect(attackCooldownScale(-1, 1.25)).toBeCloseTo(0.328, 3);
  });
});

describe('斧头 Java 数值（1.9 战斗更新）', () => {
  it('伤害：木/金 7、石/铁/钻 9、下界合金 10', () => {
    expect(TOOLS.wooden_axe.attackDamage).toBe(7);
    expect(TOOLS.golden_axe.attackDamage).toBe(7);
    expect(TOOLS.stone_axe.attackDamage).toBe(9);
    expect(TOOLS.iron_axe.attackDamage).toBe(9);
    expect(TOOLS.diamond_axe.attackDamage).toBe(9);
    expect(TOOLS.netherite_axe.attackDamage).toBe(10);
  });

  it('攻速：木/石/金 0.8（冷却 1.25s）、铁 0.9、钻/合金 1.0（冷却 = 1/攻速）', () => {
    expect(TOOLS.wooden_axe.attackCd).toBeCloseTo(1 / 0.8, 6);
    expect(TOOLS.stone_axe.attackCd).toBeCloseTo(1 / 0.8, 6);
    expect(TOOLS.golden_axe.attackCd).toBeCloseTo(1 / 0.8, 6);
    expect(TOOLS.iron_axe.attackCd).toBeCloseTo(1 / 0.9, 6);
    expect(TOOLS.diamond_axe.attackCd).toBeCloseTo(1 / 1.0, 6);
    expect(TOOLS.netherite_axe.attackCd).toBeCloseTo(1 / 1.0, 6);
  });

  it('剑攻速 1.6（冷却 0.625s）与镐/锹/锄/剪刀/钓竿 4 攻速（0.25s）保持', () => {
    for (const t of ['wooden_sword', 'stone_sword', 'iron_sword', 'diamond_sword', 'netherite_sword', 'golden_sword'] as const) {
      expect(TOOLS[t].attackCd, t).toBeCloseTo(1 / 1.6, 6);
    }
    for (const t of ['wooden_pickaxe', 'diamond_pickaxe', 'iron_shovel', 'netherite_hoe', 'shears', 'fishing_rod'] as const) {
      expect(TOOLS[t].attackCd, t).toBe(0.25);
    }
  });
});
