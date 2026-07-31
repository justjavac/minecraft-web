// 经验与附魔：XP 数值表、MC 等级公式、附魔定义与适用规则

import { BLOCK_BY_KEY } from './blocks';
import type { MobType } from './mobs';
import { mulberry32 } from './noise';
import type { World } from './world';

/** 杀怪经验（MC：敌对 5、烈焰人 10、被动 1-3 取中） */
export const XP_MOB: Record<MobType, number> = {
  zombie: 5,
  skeleton: 5,
  spider: 5,
  creeper: 5,
  zombified_piglin: 5,
  piglin: 5,
  piglin_brute: 10, // MC 蛮兵经验高
  blaze: 10,
  wither_skeleton: 5,
  ghast: 5,
  sheep: 2,
  wolf: 2,
  enderman: 5,
  wither: 50,
  ender_dragon: 500, // MC 首杀 12000 的简化：约升 16 级
  shulker: 5,
  slime: 4, // 大 4 / 中 2 / 小 1（分裂特判按档给；此处为大档）
  phantom: 5,
  iron_golem: 0, // MC：铁傀儡不掉经验
  pig: 2,
  cow: 2,
  chicken: 2,
  mooshroom: 2,
  villager: 0,
};

/** 挖矿经验区间 [min, max]（MC：煤/青金/红石/石英/钻/绿宝石掉经验；铁铜金不掉） */
export const XP_ORE: Record<string, [number, number]> = {
  coal: [0, 2],
  lapis: [2, 5],
  redstone: [2, 5],
  quartz: [2, 5],
  diamond: [3, 7],
  emerald: [3, 7],
};

/** 繁殖经验区间（MC 1-7） */
export const XP_BREED: [number, number] = [1, 7];

/** MC 等级所需经验（从 level 升到 level+1 所需） */
export function xpForLevel(level: number): number {
  if (level <= 15) return 2 * level + 7;
  if (level <= 30) return 5 * level - 38;
  return 9 * level - 158;
}

/** 总 XP → { 等级, 本级进度 0-1 }（HUD 用） */
export function levelFromXp(total: number): { level: number; progress: number } {
  let level = 0;
  let left = Math.max(0, Math.floor(total));
  while (left >= xpForLevel(level)) {
    left -= xpForLevel(level);
    level++;
  }
  return { level, progress: left / xpForLevel(level) };
}

/** 扣减 N 级经验（附魔消耗按 MC 扣整级；保持本级进度比例） */
export function subtractLevels(total: number, levels: number): number {
  const { level, progress } = levelFromXp(total);
  const target = Math.max(0, level - levels);
  let xp = 0;
  for (let l = 0; l < target; l++) xp += xpForLevel(l);
  return xp + Math.floor(progress * xpForLevel(target));
}

// ——— 附魔 ———

export type EnchKey = 'sharpness' | 'efficiency' | 'fortune' | 'silk_touch' | 'unbreaking' | 'protection' | 'looting' | 'knockback';

export type EnchMap = Partial<Record<EnchKey, number>>;

export interface EnchDef {
  key: EnchKey;
  name: string;
  maxLvl: number;
  /** 适用：sword 剑 / dig 挖掘工具（镐斧锹）/ armor 装备 / hoe 锄 / bow 弓 */
  applies: ('sword' | 'dig' | 'armor' | 'hoe' | 'bow')[];
}

export const ENCHANTS: Record<EnchKey, EnchDef> = {
  sharpness: { key: 'sharpness', name: '锋利', maxLvl: 5, applies: ['sword'] },
  efficiency: { key: 'efficiency', name: '效率', maxLvl: 5, applies: ['dig'] },
  fortune: { key: 'fortune', name: '时运', maxLvl: 3, applies: ['dig'] },
  silk_touch: { key: 'silk_touch', name: '精准采集', maxLvl: 1, applies: ['dig'] }, // MC：与时运互斥
  unbreaking: { key: 'unbreaking', name: '耐久', maxLvl: 3, applies: ['sword', 'dig', 'armor', 'hoe', 'bow'] },
  protection: { key: 'protection', name: '保护', maxLvl: 4, applies: ['armor'] },
  looting: { key: 'looting', name: '抢夺', maxLvl: 3, applies: ['sword'] },
  knockback: { key: 'knockback', name: '击退', maxLvl: 2, applies: ['sword'] },
};

export interface EnchOffer {
  ench: EnchKey;
  lvl: number;
  /** 青金石消耗（= min(附魔等级, 3)，MC 三档封顶） */
  lapis: number;
  /** 经验等级消耗（MC 扣整级，封顶 3） */
  levels: number;
}

/** 某物品类的可附魔集合 */
export function enchantsFor(kind: 'sword' | 'dig' | 'armor' | 'hoe' | 'bow'): EnchDef[] {
  return Object.values(ENCHANTS).filter((e) => e.applies.includes(kind));
}

/** 附魔台消耗：MC 按附魔档位耗 1-3 级经验与等量青金石（封顶 3，不再随附魔等级线性涨） */
export function enchCost(lvl: number): { lapis: number; levels: number } {
  const cost = Math.min(Math.max(1, lvl), 3);
  return { lapis: cost, levels: cost };
}

/** 附魔台书架功率（MC：2 格环内的书架数，0-15；内圈 3×3 要留空气间隔不算） */
export function bookshelfPower(world: World, x: number, y: number, z: number): number {
  let n = 0;
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -1; dy <= 2; dy++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1 && dy >= 0 && dy <= 1) continue; // 内圈：MC 要求一格空气间隔
        if (world.getBlock(x + dx, y + dy, z + dz) === BLOCK_BY_KEY.bookshelf.id) n++;
      }
    }
  }
  return Math.min(15, n);
}

/** 书架功率对应的附魔等级上限（MC：无书架最高 8 级档，满 15 书架 30 级档） */
export function enchantLevelCap(power: number): number {
  return Math.max(8, Math.min(30, power * 2));
}

/** 为物品生成 3 个附魔选项（选中即定型，不重摇；MC：精准采集与时运互斥，已有其一则另一个不出现） */
export function rollOffers(seed: number, kind: 'sword' | 'dig' | 'armor' | 'hoe' | 'bow', playerLevel: number, current?: EnchMap): EnchOffer[] {
  let pool = enchantsFor(kind);
  if (current?.silk_touch) pool = pool.filter((e) => e.key !== 'fortune');
  if (current?.fortune) pool = pool.filter((e) => e.key !== 'silk_touch');
  const rand = mulberry32(seed);
  const offers: EnchOffer[] = [];
  for (let n = 0; n < 3 && pool.length > 0; n++) {
    const idx = Math.floor(rand() * pool.length);
    const def = pool[idx];
    pool.splice(idx, 1); // 抽走即从候选移除（原 used+continue 会浪费一次循环，pool 小时附魔选项少于 3 个；MC 附魔台恒 3 项）
    // 等级随玩家等级上探（MC：等级越高越容易出高等级附魔）
    const cap = Math.min(def.maxLvl, Math.max(1, Math.ceil(playerLevel / 5)));
    const lvl = 1 + Math.floor(rand() * cap);
    offers.push({ ench: def.key, lvl, ...enchCost(lvl) });
  }
  return offers;
}
