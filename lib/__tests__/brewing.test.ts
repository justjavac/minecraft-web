// 酿造：材料路由、酿造循环（水瓶→粗制→效果药）、燃料消耗、药水效果状态

import { beforeEach, describe, expect, it } from 'vitest';
import { BREW_TIME, BREWING, clearBrews, FUEL_USES, getBrew, POTIONS, putIntoBrewing, takePotion, tickBrewing } from '../brewing';
import { clearEffects, effects, tickEffects } from '../effects';
import { RECIPES } from '../recipes';
import { emptySlots, type Slot } from '../slots';

const mat = (material: string, count = 1): Slot => ({ kind: 'material', material, count });

beforeEach(() => {
  clearBrews();
  clearEffects();
});

describe('酿造材料路由', () => {
  it('烈焰粉进燃料槽、材料进材料槽、药水进空药水槽', () => {
    const b = getBrew('1,2,3');
    const slots: Slot[] = [mat('blaze_powder'), mat('nether_wart'), mat('water_bottle'), ...emptySlots().slice(3)];
    let r = putIntoBrewing(slots, 0, b);
    expect(r.to).toBe('fuel');
    r = putIntoBrewing(r.slots, 1, b);
    expect(r.to).toBe('ingredient');
    r = putIntoBrewing(r.slots, 2, b);
    expect(r.to).toBe('potion');
    expect(b.fuel?.item).toBe('blaze_powder');
    expect(b.ingredient?.item).toBe('nether_wart');
    expect(b.potions[0]?.item).toBe('water_bottle');
    // 石头/工具等材料拒绝
    expect(putIntoBrewing([mat('coal')], 0, b).to).toBeNull();
  });

  it('取出药水槽的药水', () => {
    const b = getBrew('4,5,6');
    b.potions[1] = { item: 'speed', count: 1 };
    const slots = takePotion(emptySlots(), b, 1);
    expect(b.potions[1]).toBeNull();
    expect(slots.some((s) => s?.kind === 'material' && s.material === 'speed')).toBe(true);
  });
});

describe('酿造循环', () => {
  it('水瓶 + 地狱疣 → 粗制药水（20 秒一轮，耗 1 材料与 1/20 燃料）', () => {
    const b = getBrew('7,8,9');
    b.fuel = { item: 'blaze_powder', count: 1 };
    b.ingredient = { item: 'nether_wart', count: 2 };
    b.potions[0] = { item: 'water_bottle', count: 1 };
    b.potions[2] = { item: 'water_bottle', count: 1 };
    for (let i = 0; i < BREW_TIME; i++) tickBrewing(1);
    expect(b.potions[0]?.item).toBe('awkward');
    expect(b.potions[2]?.item).toBe('awkward'); // 同槽多瓶同步转化（MC）
    expect(b.ingredient?.count).toBe(1);
    expect(b.fuel).toBeNull(); // 1 份粉已燃尽点火
    expect(b.burnLeft).toBe(FUEL_USES - 1);
  });

  it('粗制 + 糖 → 迅捷；无燃料不推进', () => {
    const b = getBrew('10,11,12');
    b.ingredient = { item: 'sugar', count: 1 };
    b.potions[1] = { item: 'awkward', count: 1 };
    tickBrewing(5);
    expect(b.potions[1]?.item).toBe('awkward'); // 无烈焰粉，不推进
    b.fuel = { item: 'blaze_powder', count: 1 };
    for (let i = 0; i < BREW_TIME; i++) tickBrewing(1);
    expect(b.potions[1]?.item).toBe('speed');
  });

  it('配方表与 MC 一致（水瓶→粗制；粗制→速度/力量/治疗/抗火）', () => {
    expect(BREWING['water_bottle+nether_wart']).toBe('awkward');
    expect(BREWING['awkward+sugar']).toBe('speed');
    expect(BREWING['awkward+blaze_powder']).toBe('strength');
    expect(BREWING['awkward+glistering_melon']).toBe('healing');
    expect(BREWING['awkward+magma_cream']).toBe('fire_res');
  });
});

describe('药水效果与配方', () => {
  it('效果药水带效果与时长；基础药水无效果', () => {
    expect(POTIONS.speed.effect).toBe('speed');
    expect(POTIONS.strength.effect).toBe('strength');
    expect(POTIONS.fire_res.effect).toBe('fireRes');
    expect(POTIONS.healing.effect).toBe('healing');
    expect(POTIONS.awkward.effect).toBeNull();
    expect(POTIONS.water_bottle.effect).toBeNull();
  });

  it('效果状态 tick 递减到 0', () => {
    effects.speed = 3;
    tickEffects(1);
    expect(effects.speed).toBeCloseTo(2);
    tickEffects(5);
    expect(effects.speed).toBe(0);
  });

  it('酿造台/玻璃瓶/糖/岩浆膏/闪烁的西瓜片配方存在', () => {
    expect(RECIPES.find((r) => r.id === 'brewing_stand')).toBeDefined();
    expect(RECIPES.find((r) => r.id === 'glass_bottle')).toBeDefined();
    expect(RECIPES.find((r) => r.id === 'sugar')).toBeDefined();
    expect(RECIPES.find((r) => r.id === 'magma_cream')).toBeDefined();
    expect(RECIPES.find((r) => r.id === 'glistering_melon')).toBeDefined();
  });
});
