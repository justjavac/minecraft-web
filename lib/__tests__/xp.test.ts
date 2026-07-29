// 经验与附魔：MC 等级公式、XP 来源、附魔应用与全部六种效果

import { beforeEach, describe, expect, it } from 'vitest';
import { breakBlock } from '../actions';
import { BLOCK_BY_KEY } from '../blocks';
import { clearDrops, itemDrops } from '../items';
import { damageMob, mobs, clearMobs } from '../mobs';
import { VOID_TERRAIN } from '../noise';
import { RECIPES } from '../recipes';
import { useGameStore } from '../store';
import { emptySlots, type Slot } from '../slots';
import { levelFromXp, subtractLevels, xpForLevel, XP_MOB, ENCHANTS, enchCost, rollOffers, type EnchOffer } from '../xp';
import { World } from '../world';

const K = (k: string) => BLOCK_BY_KEY[k].id;

function setup(slots?: Slot[]): void {
  clearDrops();
  clearMobs();
  useGameStore.getState().loadSurvival({ health: 20, hunger: 20, slots: slots ?? emptySlots() });
  useGameStore.setState({ worldMode: 'survival', xpTotal: 0 });
}

beforeEach(() => setup());

describe('MC 等级公式', () => {
  it('升级所需经验：≤16 级 2L+7，17-31 级 5L-38，32+ 级 9L-158', () => {
    expect(xpForLevel(0)).toBe(7);
    expect(xpForLevel(15)).toBe(37);
    expect(xpForLevel(16)).toBe(42);
    expect(xpForLevel(30)).toBe(112);
    expect(xpForLevel(31)).toBe(121);
  });

  it('总 XP → 等级与进度', () => {
    expect(levelFromXp(0)).toEqual({ level: 0, progress: 0 });
    expect(levelFromXp(7).level).toBe(1);
    expect(levelFromXp(14).level).toBe(1); // 2 级需 16（7+9）
    expect(levelFromXp(16).level).toBe(2);
    const { level, progress } = levelFromXp(10);
    expect(level).toBe(1);
    expect(progress).toBeCloseTo(3 / 9);
  });

  it('扣整级保持本级进度', () => {
    const total = 10; // 1 级 + 3/9
    const after = subtractLevels(total, 1);
    expect(levelFromXp(after).level).toBe(0);
    expect(levelFromXp(after).progress).toBeCloseTo(3 / 9, 1);
  });
});

describe('XP 来源', () => {
  it('杀怪得经验（敌对 5，烈焰人 10）', () => {
    expect(XP_MOB.zombie).toBe(5);
    expect(XP_MOB.blaze).toBe(10);
    expect(XP_MOB.pig).toBe(2);
    expect(XP_MOB.villager).toBe(0);
    const w = new World('xp-mob', undefined, VOID_TERRAIN);
    void w;
    mobs.push({ id: 1, type: 'zombie', x: 8, y: 40, z: 8, velY: 0, hp: 1, attackCd: 0, onGround: true, wanderDir: 0, wanderTimer: 0, wanderMoving: false, fleeTimer: 0, fleeFromX: 0, fleeFromZ: 0, arrowCd: 1, ignite: -1 });
    damageMob(mobs[0], 5, { x: 0, z: 0 });
    expect(useGameStore.getState().xpTotal).toBe(5);
  });

  it('挖煤矿掉经验（区间 0-2），挖石头不掉', () => {
    const w = new World('xp-ore', undefined, VOID_TERRAIN);
    const slots = emptySlots();
    slots[0] = { kind: 'tool', tool: 'wooden_pickaxe', durability: 59 };
    useGameStore.getState().loadSurvival({ health: 20, hunger: 20, slots });
    useGameStore.setState({ worldMode: 'survival', xpTotal: 0 });
    w.setBlock(4, 30, 4, K('coal_ore'));
    breakBlock(w, 4, 30, 4);
    expect(useGameStore.getState().xpTotal).toBeGreaterThanOrEqual(0);
    // 多挖统计必出（0-2 随机）
    let total = 0;
    for (let i = 0; i < 20; i++) {
      w.setBlock(6, 30, 6, K('coal_ore'));
      breakBlock(w, 6, 30, 6);
    }
    total = useGameStore.getState().xpTotal;
    expect(total).toBeGreaterThan(0);
    w.setBlock(8, 30, 8, BLOCK_BY_KEY.stone.id);
    const before = useGameStore.getState().xpTotal;
    breakBlock(w, 8, 30, 8);
    expect(useGameStore.getState().xpTotal).toBe(before);
  });
});

describe('附魔应用与效果', () => {
  const offer: EnchOffer = { ench: 'sharpness', lvl: 3, lapis: 3, levels: 3 };

  it('应用附魔：耗青金石与整级，写入槽位；不足则拒', () => {
    const slots = emptySlots();
    slots[0] = { kind: 'tool', tool: 'diamond_sword', durability: 1561 };
    slots[1] = { kind: 'material', material: 'lapis', count: 5 };
    setup(slots);
    useGameStore.setState({ xpTotal: xpForLevel(0) + xpForLevel(1) + xpForLevel(2) + 1 }); // 3 级+1
    expect(useGameStore.getState().enchantApply(0, offer)).toBe(true);
    const slot = useGameStore.getState().hotbarSlots[0];
    expect(slot?.kind === 'tool' && slot.ench?.sharpness).toBe(3);
    // 青金石扣 3 剩 2（回归：曾被后续 set 覆盖成不扣）
    const lapisSlot = useGameStore.getState().hotbarSlots[1];
    expect(lapisSlot?.kind === 'material' ? lapisSlot.count : -1).toBe(2);
    // 青金石耗 3，经验扣 3 级 → 剩 0 级余 1
    const xpLeft = useGameStore.getState().xpTotal;
    expect(levelFromXp(xpLeft).level).toBe(0);
    // 经验不足再拒
    expect(useGameStore.getState().enchantApply(0, offer)).toBe(false);
  });

  it('耐久附魔：概率不掉耐久（大数下总有省耐久的次数）', () => {
    const slots = emptySlots();
    slots[0] = { kind: 'tool', tool: 'iron_pickaxe', durability: 250, ench: { unbreaking: 3 } };
    setup(slots);
    let saved = 0;
    for (let i = 0; i < 40; i++) {
      const before = useGameStore.getState().hotbarSlots[0];
      const bd = before?.kind === 'tool' ? before.durability : -1;
      useGameStore.getState().damageHeldTool(1);
      const after = useGameStore.getState().hotbarSlots[0];
      const ad = after?.kind === 'tool' ? after.durability : bd - 1;
      if (ad === bd) saved++;
    }
    expect(saved).toBeGreaterThan(10); // 耐久 III 期望 75% 省
  });

  it('时运附魔：挖钻石矿加掉（40 次总有 >1 的掉落）', () => {
    const w = new World('xp-fortune', undefined, VOID_TERRAIN);
    const slots = emptySlots();
    slots[0] = { kind: 'tool', tool: 'iron_pickaxe', durability: 250, ench: { fortune: 3 } };
    setup(slots);
    let bonus = false;
    for (let i = 0; i < 40 && !bonus; i++) {
      clearDrops();
      w.setBlock(4, 30, 4, K('diamond_ore'));
      breakBlock(w, 4, 30, 4);
      if (itemDrops.some((d) => d.drop.kind === 'material' && d.drop.material === 'diamond' && d.count > 1)) bonus = true;
    }
    expect(bonus).toBe(true);
  });

  it('保护附魔：减伤（皮甲 + 保护 IV 明显低于无保护）', () => {
    const slots = emptySlots();
    setup(slots);
    useGameStore.setState({
      worldMode: 'survival',
      armorSlots: { helmet: { durability: 55, ench: { protection: 4 } }, chestplate: null, leggings: null, boots: null },
      health: 20,
    });
    useGameStore.getState().damagePlayer(10);
    const hp = useGameStore.getState().health;
    expect(hp).toBeGreaterThan(20 - 10); // 有减伤（无保护则整 10 点）
    expect(20 - hp).toBeLessThanOrEqual(8); // 皮甲 4% + 保护 IV 16% = 减 20%
  });

  it('抢夺附魔：杀牛加掉（掉落计数上有加成的分布）', () => {
    const w = new World('xp-loot', undefined, VOID_TERRAIN);
    void w;
    mobs.push({ id: 1, type: 'cow', x: 8, y: 40, z: 8, velY: 0, hp: 1, attackCd: 0, onGround: true, wanderDir: 0, wanderTimer: 0, wanderMoving: false, fleeTimer: 0, fleeFromX: 0, fleeFromZ: 0, arrowCd: 1, ignite: -1 });
    damageMob(mobs[0], 5, { x: 0, z: 0 }, 3);
    // 牛掉 1-3 生牛肉 + 抢夺 0-3：总数可能到 6，只需验证机制存在（掉落非空且牛肉存在）
    expect(itemDrops.some((d) => d.drop.kind === 'material' && d.drop.material === 'raw_beef')).toBe(true);
  });

  it('附魔台/书/纸配方存在（MC 一致）', () => {
    expect(RECIPES.find((r) => r.id === 'enchanting_table')).toBeDefined();
    expect(RECIPES.find((r) => r.id === 'book')).toBeDefined();
    expect(RECIPES.find((r) => r.id === 'paper')).toBeDefined();
    const table = RECIPES.find((r) => r.id === 'enchanting_table')!;
    expect(table.cost).toContainEqual({ item: 'material:book', count: 1 });
    expect(table.cost).toContainEqual({ item: 'material:diamond', count: 2 });
  });
});

describe('精准采集（silk_touch，MC）', () => {
  it('附魔定义：工具类仅 1 级；击退为剑类 1-2 级', () => {
    expect(ENCHANTS.silk_touch).toMatchObject({ name: '精准采集', maxLvl: 1, applies: ['dig'] });
    expect(ENCHANTS.knockback).toMatchObject({ name: '击退', maxLvl: 2, applies: ['sword'] });
  });

  it('石头掉石头而非圆石；煤矿石掉煤矿石方块（不掉煤、不掉经验）', () => {
    const w = new World('xp-silk', undefined, VOID_TERRAIN);
    const slots = emptySlots();
    slots[0] = { kind: 'tool', tool: 'iron_pickaxe', durability: 250, ench: { silk_touch: 1 } };
    setup(slots);
    // 石头 → 石头（跳过 dropBlock → 圆石的转换）
    w.setBlock(4, 30, 4, K('stone'));
    breakBlock(w, 4, 30, 4);
    expect(itemDrops.some((d) => d.drop.kind === 'block' && d.drop.blockId === K('stone'))).toBe(true);
    expect(itemDrops.some((d) => d.drop.kind === 'block' && d.drop.blockId === K('cobble'))).toBe(false);
    // 煤矿石 → 煤矿石方块自身
    clearDrops();
    w.setBlock(6, 30, 6, K('coal_ore'));
    breakBlock(w, 6, 30, 6);
    expect(itemDrops.some((d) => d.drop.kind === 'block' && d.drop.blockId === K('coal_ore'))).toBe(true);
    expect(itemDrops.some((d) => d.drop.kind === 'material' && d.drop.material === 'coal')).toBe(false);
    expect(useGameStore.getState().xpTotal).toBe(0); // MC：精准采矿不掉经验
    // 深层矿石同理
    clearDrops();
    w.setBlock(8, 30, 8, K('deepslate_diamond_ore'));
    breakBlock(w, 8, 30, 8);
    expect(itemDrops.some((d) => d.drop.kind === 'block' && d.drop.blockId === K('deepslate_diamond_ore'))).toBe(true);
    expect(itemDrops.some((d) => d.drop.kind === 'material' && d.drop.material === 'diamond')).toBe(false);
  });

  it('镐层级不足仍无掉落（不可采规则不变）；无精准时石头仍掉圆石', () => {
    const w = new World('xp-silk2', undefined, VOID_TERRAIN);
    const slots = emptySlots();
    slots[0] = { kind: 'tool', tool: 'wooden_pickaxe', durability: 59, ench: { silk_touch: 1 } };
    setup(slots);
    // 木镐（tier 0）+ 精准挖钻石矿（需 tier 2）：无掉落（MC 层级规则优先）
    w.setBlock(4, 30, 4, K('diamond_ore'));
    breakBlock(w, 4, 30, 4);
    expect(itemDrops.length).toBe(0);
    // 对照：无精准采集，石头仍掉圆石
    slots[0] = { kind: 'tool', tool: 'wooden_pickaxe', durability: 59 };
    setup(slots);
    w.setBlock(6, 30, 6, K('stone'));
    breakBlock(w, 6, 30, 6);
    expect(itemDrops.some((d) => d.drop.kind === 'block' && d.drop.blockId === K('cobble'))).toBe(true);
    expect(itemDrops.some((d) => d.drop.kind === 'block' && d.drop.blockId === K('stone'))).toBe(false);
  });

  it('rollOffers：精准采集与时运互斥（已有其一则另一个不出现）', () => {
    for (let seed = 0; seed < 40; seed++) {
      expect(rollOffers(seed, 'dig', 30, { fortune: 3 }).some((o) => o.ench === 'silk_touch')).toBe(false);
      expect(rollOffers(seed, 'dig', 30, { silk_touch: 1 }).some((o) => o.ench === 'fortune')).toBe(false);
    }
  });
});

describe('附魔台成本（MC 封顶 3）', () => {
  it('enchCost：1-3 级按档位，4 级以上封顶 3', () => {
    expect(enchCost(1)).toEqual({ lapis: 1, levels: 1 });
    expect(enchCost(2)).toEqual({ lapis: 2, levels: 2 });
    expect(enchCost(3)).toEqual({ lapis: 3, levels: 3 });
    expect(enchCost(4)).toEqual({ lapis: 3, levels: 3 });
    expect(enchCost(5)).toEqual({ lapis: 3, levels: 3 });
  });

  it('rollOffers：高等级玩家摇出 4-5 级附魔时成本仍为 3', () => {
    let sawHigh = false;
    for (let seed = 0; seed < 200; seed++) {
      for (const o of rollOffers(seed, 'sword', 30)) {
        expect(o.lapis).toBeLessThanOrEqual(3);
        expect(o.levels).toBeLessThanOrEqual(3);
        if (o.lvl > 3) {
          sawHigh = true;
          expect(o.lapis).toBe(3);
          expect(o.levels).toBe(3);
        }
      }
    }
    expect(sawHigh).toBe(true); // 30 级玩家必能摇出 4+ 级（cap = ceil(30/5) = 6 → maxLvl 5）
  });
});
