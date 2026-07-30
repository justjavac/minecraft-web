import { describe, expect, it } from 'vitest';
import { armorDef } from '../armor';
import { COBBLE, LOG, PLANKS } from '../blocks';
import { applyCraft, canCraft, hasSpaceFor, RECIPES } from '../recipes';
import { addStackToSlots, emptySlots } from '../slots';

const planksRecipe = RECIPES.find((r) => r.id === 'planks')!;
const stickRecipe = RECIPES.find((r) => r.id === 'stick')!;
const stonePickRecipe = RECIPES.find((r) => r.id === 'stone_pickaxe')!;

describe('合成配方', () => {
  it('原木 → 木板 ×4，材料耗尽后不可再合成', () => {
    let slots = emptySlots();
    slots = addStackToSlots(slots, { kind: 'block', id: LOG }, 1).slots;
    expect(canCraft(slots, planksRecipe)).toBe(true);
    slots = applyCraft(slots, planksRecipe, 0);
    expect(slots.some((s) => s?.kind === 'block' && s.id === PLANKS && s.count === 4)).toBe(true);
    expect(canCraft(slots, planksRecipe)).toBe(false);
  });

  it('完整链路：原木 → 木板 → 木棍 → 石镐（含耐久）', () => {
    let slots = emptySlots();
    slots = addStackToSlots(slots, { kind: 'block', id: LOG }, 2).slots;
    slots = applyCraft(slots, planksRecipe, 0); // 2 原木 → 8 木板
    slots = applyCraft(slots, planksRecipe, 0);
    slots = applyCraft(slots, stickRecipe, 0); // 4 木板 → 8 木棍
    slots = applyCraft(slots, stickRecipe, 0);
    slots = addStackToSlots(slots, { kind: 'block', id: COBBLE }, 3).slots;
    expect(canCraft(slots, stonePickRecipe)).toBe(true);
    slots = applyCraft(slots, stonePickRecipe, 131);
    const tool = slots.find((s) => s?.kind === 'tool');
    expect(tool).toEqual({ kind: 'tool', tool: 'stone_pickaxe', durability: 131 });
    // 木棍被扣掉 2 根
    const sticks = slots.find((s) => s?.kind === 'material');
    expect(sticks).toEqual({ kind: 'material', material: 'stick', count: 6 });
  });

  it('材料不足不可合成，背包满时空间预检失败', () => {
    expect(canCraft(emptySlots(), stickRecipe)).toBe(false);
    const full = emptySlots().map(() => ({ kind: 'block', id: 1, count: 64 }) as const);
    expect(hasSpaceFor([...full], stickRecipe.out)).toBe(false);
  });

  it('皮革 → 皮革头盔（5 皮革，带耐久）', () => {
    let slots = emptySlots();
    slots = addStackToSlots(slots, { kind: 'material', material: 'leather' }, 5).slots;
    const recipe = RECIPES.find((r) => r.id === 'leather_helmet')!;
    expect(canCraft(slots, recipe)).toBe(true);
    slots = applyCraft(slots, recipe, armorDef('leather', 'helmet').durability);
    expect(slots.some((s) => s?.kind === 'armor' && s.piece === 'helmet' && s.durability === 55)).toBe(true);
    expect(canCraft(slots, recipe)).toBe(false); // 皮革已耗尽
  });

  it('台阶/楼梯配方存在且符合 MC：3 块 → 6 台阶、6 块 → 4 楼梯（均需工作台）', () => {
    // 全部基材都有对应配方（此前缺失导致木桶配方被 planks_slab 锁死）
    const slabBases = ['stone', 'smooth_stone', 'cobble', 'stone_bricks', 'deepslate_bricks', 'brick', 'sandstone', 'planks', 'spruce_planks', 'dark_oak_planks'];
    for (const b of slabBases) {
      const r = RECIPES.find((x) => x.id === `${b}_slab`);
      expect(r, `${b}_slab`).toBeDefined();
      expect(r!.needsTable).toBe(true);
      expect(r!.out).toMatchObject({ kind: 'block', count: 6 });
      expect(r!.cost).toHaveLength(1);
      expect(r!.cost[0].count).toBe(3);
    }
    const stairBases = ['cobble', 'stone_bricks', 'deepslate_bricks', 'brick', 'planks', 'spruce_planks', 'dark_oak_planks'];
    for (const b of stairBases) {
      const r = RECIPES.find((x) => x.id === `${b}_stairs`);
      expect(r, `${b}_stairs`).toBeDefined();
      expect(r!.needsTable).toBe(true);
      expect(r!.out).toMatchObject({ kind: 'block', count: 4 });
      expect(r!.cost[0].count).toBe(6);
    }
  });

  it('木板 → 台阶 ×6 → 木桶可合成（配方链解锁）', () => {
    const slabRecipe = RECIPES.find((r) => r.id === 'planks_slab')!;
    const barrelRecipe = RECIPES.find((r) => r.id === 'barrel')!;
    let slots = emptySlots();
    slots = addStackToSlots(slots, { kind: 'block', id: PLANKS }, 9).slots;
    expect(canCraft(slots, slabRecipe)).toBe(true);
    slots = applyCraft(slots, slabRecipe, 0); // 3 木板 → 6 台阶
    expect(canCraft(slots, barrelRecipe)).toBe(true); // 木桶需 6 木板 + 2 台阶
  });
});
