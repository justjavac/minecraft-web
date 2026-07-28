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

  it('恶魂之泪可入材料槽：粗制 + 恶魂之泪 → 再生药水（MC）', () => {
    const b = getBrew('13,14,15');
    // 此前 INGREDIENTS 缺 ghast_tear，材料放不进槽（死配方）
    expect(putIntoBrewing([mat('ghast_tear')], 0, b).to).toBe('ingredient');
    b.fuel = { item: 'blaze_powder', count: 1 };
    b.potions[0] = { item: 'awkward', count: 1 };
    for (let i = 0; i < BREW_TIME; i++) tickBrewing(1);
    expect(b.potions[0]?.item).toBe('regeneration');
  });

  it('河豚入材料槽：粗制 + 河豚 → 水肺药水（MC）', () => {
    const b = getBrew('16,17,18');
    expect(putIntoBrewing([mat('pufferfish')], 0, b).to).toBe('ingredient');
    b.fuel = { item: 'blaze_powder', count: 1 };
    b.potions[0] = { item: 'awkward', count: 1 };
    for (let i = 0; i < BREW_TIME; i++) tickBrewing(1);
    expect(b.potions[0]?.item).toBe('water_breathing');
    expect(POTIONS.water_breathing).toMatchObject({ effect: 'waterBreath', duration: 180 });
  });

  it('二级酿造：红石延时 ×8/3、荧石粉 II 级（MC）', () => {
    // 红石/荧石粉可入材料槽（各用一台，避免材料槽互占）
    expect(putIntoBrewing([mat('redstone')], 0, getBrew('19,20,21')).to).toBe('ingredient');
    expect(putIntoBrewing([mat('glowstone_dust')], 0, getBrew('25,26,27')).to).toBe('ingredient');
    // 延时配方（3 分钟 → 8 分钟）
    expect(BREWING['speed+redstone']).toBe('speed_ext');
    expect(BREWING['strength+redstone']).toBe('strength_ext');
    expect(BREWING['fire_res+redstone']).toBe('fire_res_ext');
    expect(BREWING['regeneration+redstone']).toBe('regeneration_ext');
    expect(BREWING['water_breathing+redstone']).toBe('water_breathing_ext');
    // 增强配方（时长减半，治疗瞬发无时长）
    expect(BREWING['speed+glowstone_dust']).toBe('speed_2');
    expect(BREWING['strength+glowstone_dust']).toBe('strength_2');
    expect(BREWING['healing+glowstone_dust']).toBe('healing_2');
    expect(BREWING['regeneration+glowstone_dust']).toBe('regeneration_2');
    // 抗火/水肺无 II 级、瞬发治疗无延时（MC）
    expect(BREWING['fire_res+glowstone_dust']).toBeUndefined();
    expect(BREWING['water_breathing+glowstone_dust']).toBeUndefined();
    expect(BREWING['healing+redstone']).toBeUndefined();
    // 数值：180 → 480（×8/3）；II 级 90（减半）；再生 30 → 80 / 15
    expect(POTIONS.speed_ext.duration).toBe(480);
    expect(POTIONS.strength_ext.duration).toBe(480);
    expect(POTIONS.fire_res_ext.duration).toBe(480);
    expect(POTIONS.water_breathing_ext.duration).toBe(480);
    expect(POTIONS.regeneration_ext.duration).toBe(80);
    expect(POTIONS.speed_2).toMatchObject({ effect: 'speed', duration: 90, lvl: 2 });
    expect(POTIONS.strength_2).toMatchObject({ effect: 'strength', duration: 90, lvl: 2 });
    expect(POTIONS.healing_2).toMatchObject({ effect: 'healing', duration: 0, lvl: 2 });
    expect(POTIONS.regeneration_2).toMatchObject({ effect: 'regen', duration: 15, lvl: 2 });
  });

  it('延时/增强实际可酿：迅捷 + 红石 → 延长；力量 + 荧石粉 → II', () => {
    const b = getBrew('22,23,24');
    b.fuel = { item: 'blaze_powder', count: 2 };
    b.ingredient = { item: 'redstone', count: 1 };
    b.potions[0] = { item: 'speed', count: 1 };
    b.potions[1] = { item: 'strength', count: 1 };
    for (let i = 0; i < BREW_TIME; i++) tickBrewing(1);
    expect(b.potions[0]?.item).toBe('speed_ext');
    expect(b.potions[1]?.item).toBe('strength_ext'); // 同槽多瓶同步转化（MC）
    // 延时版不能再增强（MC：延时与增强互不兼容）
    b.ingredient = { item: 'glowstone_dust', count: 1 };
    for (let i = 0; i < BREW_TIME; i++) tickBrewing(1);
    expect(b.potions[0]?.item).toBe('speed_ext');
    // I 级 + 荧石粉 → II
    b.potions[2] = { item: 'strength', count: 1 };
    b.ingredient = { item: 'glowstone_dust', count: 1 };
    for (let i = 0; i < BREW_TIME; i++) tickBrewing(1);
    expect(b.potions[2]?.item).toBe('strength_2');
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
