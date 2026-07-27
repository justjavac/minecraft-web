// 经验与附魔：XP 数值表、MC 等级公式、附魔定义与适用规则

import type { MobType } from './mobs';

/** 杀怪经验（MC：敌对 5、烈焰人 10、被动 1-3 取中） */
export const XP_MOB: Record<MobType, number> = {
  zombie: 5,
  skeleton: 5,
  spider: 5,
  creeper: 5,
  zombified_piglin: 5,
  blaze: 10,
  wither_skeleton: 5,
  ghast: 5,
  sheep: 2,
  wolf: 2,
  enderman: 5,
  wither: 50,
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

export type EnchKey = 'sharpness' | 'efficiency' | 'fortune' | 'unbreaking' | 'protection' | 'looting';

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
  unbreaking: { key: 'unbreaking', name: '耐久', maxLvl: 3, applies: ['sword', 'dig', 'armor', 'hoe', 'bow'] },
  protection: { key: 'protection', name: '保护', maxLvl: 4, applies: ['armor'] },
  looting: { key: 'looting', name: '抢夺', maxLvl: 3, applies: ['sword'] },
};

export interface EnchOffer {
  ench: EnchKey;
  lvl: number;
  /** 青金石消耗（= 等级） */
  lapis: number;
  /** 经验等级消耗（MC 扣整级） */
  levels: number;
}

/** 某物品类的可附魔集合 */
export function enchantsFor(kind: 'sword' | 'dig' | 'armor' | 'hoe' | 'bow'): EnchDef[] {
  return Object.values(ENCHANTS).filter((e) => e.applies.includes(kind));
}
