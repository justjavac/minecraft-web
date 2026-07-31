// 经验与附魔：MC 等级公式、XP 来源、附魔应用与全部六种效果

import { beforeEach, describe, expect, it } from 'vitest';
import { breakBlock } from '../actions';
import { BLOCK_BY_KEY } from '../blocks';
import { clearDrops, itemDrops } from '../items';
import { damageMob, mobs, clearMobs } from '../mobs';
import { VOID_TERRAIN, mulberry32 } from '../noise';
import { RECIPES } from '../recipes';
import { useGameStore } from '../store';
import { emptySlots, type Slot } from '../slots';
import { levelFromXp, subtractLevels, xpForLevel, XP_MOB, ENCHANTS, enchCost, rollOffers, randEnchantLevel, type EnchOffer } from '../xp';
import { World } from '../world';

const K = (k: string) => BLOCK_BY_KEY[k].id;

function setup(slots?: Slot[]): void {
  clearDrops();
  clearMobs();
  useGameStore.getState().loadSurvival({ health: 20, hunger: 20, slots: slots ?? emptySlots() });
  useGameStore.setState({ worldMode: 'survival', xpTotal: 0, cursorSlot: null, enchantOpen: null, enchantItem: null, enchantLapis: null, grindstoneOpen: null, grindSlots: [null, null] });
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
  const offer: EnchOffer = { enchants: [{ ench: 'sharpness', lvl: 3 }], lapis: 3, levels: 3 };

  /** Java 槽位模型：物品入附魔台物品槽、青金石入青金石槽 */
  function setupEnchantTable(item: Slot | null, lapis: number, xp: number): void {
    useGameStore.setState({
      enchantOpen: '0,64,0',
      enchantItem: item,
      enchantLapis: lapis > 0 ? { kind: 'material', material: 'lapis', count: lapis } : null,
      xpTotal: xp,
    });
  }

  it('应用附魔：耗槽内青金石与整级，附魔后物品留在槽内（Java）；不足则拒', () => {
    setup();
    setupEnchantTable({ kind: 'tool', tool: 'diamond_sword', durability: 1561 }, 5, xpForLevel(0) + xpForLevel(1) + xpForLevel(2) + 1); // 3 级+1
    expect(useGameStore.getState().enchantApply(offer)).toBe(true);
    // 附魔写入附魔台物品槽（物品留在槽内由玩家取走，MC Java）
    const slot = useGameStore.getState().enchantItem;
    expect(slot?.kind === 'tool' && slot.ench?.sharpness).toBe(3);
    // 青金石槽扣 3 剩 2
    const lapisSlot = useGameStore.getState().enchantLapis;
    expect(lapisSlot?.kind === 'material' ? lapisSlot.count : -1).toBe(2);
    // 青金石耗 3，经验扣 3 级 → 剩 0 级余 1
    const xpLeft = useGameStore.getState().xpTotal;
    expect(levelFromXp(xpLeft).level).toBe(0);
    // 经验不足再拒
    expect(useGameStore.getState().enchantApply(offer)).toBe(false);
  });

  it('应用附魔：青金石槽为空时即使背包有青金石也拒绝（Java 槽位模型，不再自动从背包扣）', () => {
    const slots = emptySlots();
    slots[1] = { kind: 'material', material: 'lapis', count: 10 };
    setup(slots);
    setupEnchantTable({ kind: 'tool', tool: 'diamond_sword', durability: 1561 }, 0, xpForLevel(0) + xpForLevel(1) + xpForLevel(2) + 1);
    expect(useGameStore.getState().enchantApply(offer)).toBe(false);
    // 背包青金石未动
    const inv = useGameStore.getState().hotbarSlots[1];
    expect(inv?.kind === 'material' ? inv.count : -1).toBe(10);
  });

  it('附魔台槽约束：物品槽拒非可附魔物、青金石槽拒非青金石', () => {
    setup();
    useGameStore.setState({ enchantOpen: '0,64,0' });
    // 方块进不了物品槽
    useGameStore.setState({ cursorSlot: { kind: 'block', id: BLOCK_BY_KEY.stone.id, count: 1 } });
    useGameStore.getState().enchantSlotMouseDown('item', { button: 0, shift: false });
    expect(useGameStore.getState().enchantItem).toBe(null);
    expect(useGameStore.getState().cursorSlot?.kind).toBe('block');
    // 石头进不了青金石槽
    useGameStore.getState().enchantSlotMouseDown('lapis', { button: 0, shift: false });
    expect(useGameStore.getState().enchantLapis).toBe(null);
    // 青金石可入青金石槽；工具可入物品槽
    useGameStore.setState({ cursorSlot: { kind: 'material', material: 'lapis', count: 10 } });
    useGameStore.getState().enchantSlotMouseDown('lapis', { button: 0, shift: false });
    const lapis = useGameStore.getState().enchantLapis;
    expect(lapis?.kind === 'material' ? lapis.count : -1).toBe(10);
    expect(useGameStore.getState().cursorSlot).toBe(null);
    useGameStore.setState({ cursorSlot: { kind: 'tool', tool: 'iron_pickaxe', durability: 250 } });
    useGameStore.getState().enchantSlotMouseDown('item', { button: 0, shift: false });
    expect(useGameStore.getState().enchantItem?.kind).toBe('tool');
    expect(useGameStore.getState().cursorSlot).toBe(null);
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
    // Java 两段式：皮头 1 点 → max(0.2, 1-5)/25 = 0.8% → 9.92；保护 IV（EPF 4）再 ×0.84 → ≈8.33
    expect(20 - hp).toBeCloseTo(9.92 * 0.84, 3);
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
      expect(rollOffers(seed, 'dig', 30, 15, { fortune: 3 }).some((o) => o.enchants.some((e) => e.ench === 'silk_touch'))).toBe(false);
      expect(rollOffers(seed, 'dig', 30, 15, { silk_touch: 1 }).some((o) => o.enchants.some((e) => e.ench === 'fortune'))).toBe(false);
    }
  });
});

describe('附魔台档位消耗（MC：槽位固定 1/2/3，与附魔等级无关）', () => {
  it('enchCost：三档固定耗 1/2/3 青金石与经验级', () => {
    expect(enchCost(0)).toEqual({ lapis: 1, levels: 1 });
    expect(enchCost(1)).toEqual({ lapis: 2, levels: 2 });
    expect(enchCost(2)).toEqual({ lapis: 3, levels: 3 });
  });

  it('rollOffers：成本按槽位固定；高档摇出 4-5 级附魔时成本仍 = 槽位档', () => {
    let sawHigh = false;
    for (let seed = 0; seed < 200; seed++) {
      const offers = rollOffers(seed, 'sword', 30, 15);
      expect(offers).toHaveLength(3);
      offers.forEach((o, i) => {
        expect(o.lapis).toBe(i + 1); // 消耗与附魔结果无关，只看槽位
        expect(o.levels).toBe(i + 1);
        if (o.enchants.some((e) => e.lvl >= 4)) sawHigh = true;
      });
    }
    expect(sawHigh).toBe(true); // 30 级玩家满书架高档必能摇出 4+ 级
  });
});

describe('附魔等级曲线（MC randEnchantLevel）', () => {
  it('端点：无书架高档 ≤ 8；满 15 书架高档恒 30', () => {
    for (let seed = 0; seed < 200; seed++) {
      expect(randEnchantLevel(0, 2, mulberry32(seed))).toBeLessThanOrEqual(8);
      expect(randEnchantLevel(0, 2, mulberry32(seed))).toBeGreaterThanOrEqual(1);
      expect(randEnchantLevel(15, 2, mulberry32(seed))).toBe(30);
    }
    // 无书架也能摇到 8（rand(1,8) 上端）
    let saw8 = false;
    for (let seed = 0; seed < 200 && !saw8; seed++) if (randEnchantLevel(0, 2, mulberry32(seed)) === 8) saw8 = true;
    expect(saw8).toBe(true);
  });
});

describe('高档多条附魔（MC）', () => {
  it('产出 1-3 条；互斥组合（时运/精准）永不同现；无重复', () => {
    for (let seed = 0; seed < 400; seed++) {
      for (const o of rollOffers(seed, 'dig', 30, 15)) {
        expect(o.enchants.length).toBeGreaterThanOrEqual(1);
        expect(o.enchants.length).toBeLessThanOrEqual(3);
        const keys = o.enchants.map((e) => e.ench);
        expect(new Set(keys).size).toBe(keys.length); // 不重复
        expect(keys.includes('fortune') && keys.includes('silk_touch')).toBe(false); // 互斥剔除
      }
    }
  });

  it('概率边界：满级高档（追加概率 ≥1）dig 恒 3 条；1 级（概率 1/15）多为 1 条', () => {
    // 高档（slot 2）满书架恒 30 级：chance = 30/15 = 2 ≥ 1 → 必追加第 2 条；减半后 1 → rand()<1 恒真 → 必追加第 3 条（候选足够）
    for (let seed = 0; seed < 200; seed++) {
      expect(rollOffers(seed, 'dig', 30, 15)[2].enchants).toHaveLength(3);
    }
    // level 1：chance = 1/15 ≈ 6.7% → 多条应为少数
    let multi = 0;
    let total = 0;
    for (let seed = 0; seed < 400; seed++) {
      for (const o of rollOffers(seed, 'dig', 1, 0)) {
        total++;
        if (o.enchants.length > 1) multi++;
      }
    }
    expect(multi).toBeGreaterThan(0); // 非零概率存在
    expect(multi / total).toBeLessThan(0.3);
    // 候选只有 1 条（锄：仅耐久）时恒 1 条
    for (let seed = 0; seed < 40; seed++) {
      for (const o of rollOffers(seed, 'hoe', 30, 15)) expect(o.enchants).toHaveLength(1);
    }
  });
});
