// 锻造台：钻石工具 + 下界合金锭 → 下界合金工具（MC 升级规则：保留附魔与剩余耐久）

import type { ToolType } from './tools';

/** 钻石工具 → 下界合金工具的映射（MC 五件） */
export const NETHERITE_UPGRADE: ReadonlyMap<ToolType, ToolType> = new Map<ToolType, ToolType>([
  ['diamond_pickaxe', 'netherite_pickaxe'],
  ['diamond_axe', 'netherite_axe'],
  ['diamond_shovel', 'netherite_shovel'],
  ['diamond_sword', 'netherite_sword'],
  ['diamond_hoe', 'netherite_hoe'],
]);

/** 该工具是否可升级为下界合金（是则返回升级后的类型） */
export function netheriteUpgradeOf(tool: ToolType): ToolType | null {
  return NETHERITE_UPGRADE.get(tool) ?? null;
}
