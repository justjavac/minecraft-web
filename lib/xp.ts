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
  /** 抽取权重（MC 稀有度：常见 10 / 少见 5 / 稀有 2 / 极稀有 1） */
  weight: number;
}

export const ENCHANTS: Record<EnchKey, EnchDef> = {
  sharpness: { key: 'sharpness', name: '锋利', maxLvl: 5, applies: ['sword'], weight: 10 },
  efficiency: { key: 'efficiency', name: '效率', maxLvl: 5, applies: ['dig'], weight: 10 },
  fortune: { key: 'fortune', name: '时运', maxLvl: 3, applies: ['dig'], weight: 2 },
  silk_touch: { key: 'silk_touch', name: '精准采集', maxLvl: 1, applies: ['dig'], weight: 1 }, // MC：与时运互斥
  unbreaking: { key: 'unbreaking', name: '耐久', maxLvl: 3, applies: ['sword', 'dig', 'armor', 'hoe', 'bow'], weight: 5 },
  protection: { key: 'protection', name: '保护', maxLvl: 4, applies: ['armor'], weight: 10 },
  looting: { key: 'looting', name: '抢夺', maxLvl: 3, applies: ['sword'], weight: 2 },
  knockback: { key: 'knockback', name: '击退', maxLvl: 2, applies: ['sword'], weight: 5 },
};

/** 附魔互斥表（MC；按本项目现有附魔清单：时运/精准互斥，其余如锋利/亡灵/节肢、无限/经验修补暂未收录） */
export const ENCH_EXCLUSIVE: [EnchKey, EnchKey][] = [['fortune', 'silk_touch']];

/** 两条附魔是否兼容（可同存于一件物品） */
export function enchCompatible(a: EnchKey, b: EnchKey): boolean {
  return a === b || !ENCH_EXCLUSIVE.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

export interface EnchEntry {
  ench: EnchKey;
  lvl: number;
}

export interface EnchOffer {
  /** 产出附魔列表：主附魔在前，高档可按概率追加兼容附魔，共 1-3 条（MC） */
  enchants: EnchEntry[];
  /** 青金石消耗（槽位固定 1/2/3，与附魔等级无关） */
  lapis: number;
  /** 经验等级消耗（槽位固定 1/2/3，扣整级） */
  levels: number;
}

/** 某物品类的可附魔集合 */
export function enchantsFor(kind: 'sword' | 'dig' | 'armor' | 'hoe' | 'bow'): EnchDef[] {
  return Object.values(ENCHANTS).filter((e) => e.applies.includes(kind));
}

/** 附魔台消耗：MC 三档固定耗 1/2/3 级经验与等量青金石（按槽位，与最终附魔等级无关） */
export function enchCost(slot: number): { lapis: number; levels: number } {
  const cost = Math.min(Math.max(1, Math.floor(slot) + 1), 3);
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

/** MC randEnchantLevel：base = rand(1,8) + floor(power/2) + rand(1,power)，再按档位 1/3、2/3+1、全额加成。
 *  端点：无书架（power 0）高档 ≤ 8；满 15 书架高档恒 30 */
export function randEnchantLevel(power: number, slot: 0 | 1 | 2, rand: () => number): number {
  const base = 1 + Math.floor(rand() * 8) + Math.floor(power / 2) + (power > 0 ? 1 + Math.floor(rand() * power) : 0);
  const lvl = slot === 0 ? Math.max(Math.floor(base / 3), 1) : slot === 1 ? Math.floor((base * 2) / 3) + 1 : Math.max(base, power * 2);
  return Math.min(30, lvl);
}

/** 按权重从候选中抽一条附魔（MC 稀有度加权） */
function pickEnch(rand: () => number, candidates: EnchDef[]): EnchDef {
  const total = candidates.reduce((n, e) => n + e.weight, 0);
  let roll = rand() * total;
  for (const c of candidates) {
    roll -= c.weight;
    if (roll < 0) return c;
  }
  return candidates[candidates.length - 1];
}

/** 摇一档附魔产出：主附魔 + 按概率（约 level/15 起、逐次减半）追加兼容附魔，共 1-3 条；互斥组合剔除（MC） */
function rollEnchants(rand: () => number, pool: EnchDef[], level: number): EnchEntry[] {
  const out: EnchEntry[] = [];
  let candidates = [...pool];
  let chance = level / 15; // 追加概率（Java modifiedLevel/50 递减的近似）
  while (candidates.length > 0) {
    const def = pickEnch(rand, candidates);
    const cap = Math.min(def.maxLvl, Math.max(1, Math.ceil(level / 5)));
    out.push({ ench: def.key, lvl: 1 + Math.floor(rand() * cap) });
    candidates = candidates.filter((e) => e.key !== def.key && enchCompatible(def.key, e.key));
    if (out.length >= 3 || rand() >= chance) break;
    chance /= 2;
  }
  return out;
}

/** 为物品生成 3 个附魔选项（选中即定型，不重摇；消耗按槽位固定 1/2/3；MC：精准采集与时运互斥，已有其一则另一个不出现） */
export function rollOffers(seed: number, kind: 'sword' | 'dig' | 'armor' | 'hoe' | 'bow', playerLevel: number, power: number, current?: EnchMap): EnchOffer[] {
  let pool = enchantsFor(kind);
  if (current?.silk_touch) pool = pool.filter((e) => e.key !== 'fortune');
  if (current?.fortune) pool = pool.filter((e) => e.key !== 'silk_touch');
  const rand = mulberry32(seed);
  const offers: EnchOffer[] = [];
  for (let slot = 0; slot < 3 && pool.length > 0; slot++) {
    // 档位等级 = 书架曲线 × 玩家等级上探（MC：玩家等级不足时附魔偏弱）
    const lvl = Math.min(randEnchantLevel(power, slot as 0 | 1 | 2, rand), Math.max(1, playerLevel));
    offers.push({ enchants: rollEnchants(rand, pool, lvl), ...enchCost(slot) });
  }
  return offers;
}
