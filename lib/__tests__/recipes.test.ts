import { describe, expect, it } from 'vitest';
import { ARMOR_DEFS } from '../armor';
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
    slots = applyCraft(slots, recipe, ARMOR_DEFS.helmet.durability);
    expect(slots.some((s) => s?.kind === 'armor' && s.piece === 'helmet' && s.durability === 55)).toBe(true);
    expect(canCraft(slots, recipe)).toBe(false); // 皮革已耗尽
  });
});
