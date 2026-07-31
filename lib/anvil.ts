// 铁砧：修复工具/装备（对应材料补 25% 耐久，MC）与附魔合并（同类两件合一，取高级、同级 +1 上限 5，MC）

import type { ArmorMaterial } from './armor';
import { BLOCK_BY_KEY } from './blocks';
import { TOOLS, type ToolType } from './tools';
import { ENCHANTS, type EnchMap } from './xp';

/** 物品键形式：'block:<id>' 或 'material:<name>'（与配方/扣料管线一致） */

/** 工具修复材料（MC：木→木板、石→圆石、铁→铁锭、钻→钻石、合金→合金锭；弓/钓竿→线，剪刀→铁锭） */
export function toolRepairMaterial(tool: ToolType): string | null {
  const def = TOOLS[tool];
  if (!def) return null;
  if (tool === 'bow' || tool === 'fishing_rod') return 'material:string';
  if (tool === 'shears') return 'material:iron_ingot';
  // 金工具 tier 记为 'wood'（采掘层级同木），修复材料须按工具名识别（MC：金→金锭）
  if (tool.startsWith('golden_')) return 'material:gold_ingot';
  switch (def.tier) {
    case 'wood':
      return `block:${BLOCK_BY_KEY.planks.id}`; // 物品键惯例 block:<数字id>（与 anvilUse 扣料/配方一致；原为字符串 key 永不匹配，木/石工具修不了）
    case 'stone':
      return `block:${BLOCK_BY_KEY.cobble.id}`;
    case 'iron':
      return 'material:iron_ingot';
    case 'diamond':
      return 'material:diamond';
    case 'netherite':
      return 'material:netherite_ingot';
  }
}

/** 装备修复材料（皮革→皮革、金属→对应锭、鞘翅→皮革［MC 幻翼膜的简化替代］） */
export function armorRepairMaterial(material: ArmorMaterial | undefined): string {
  switch (material ?? 'leather') {
    case 'leather':
      return 'material:leather';
    case 'gold':
      return 'material:gold_ingot';
    case 'iron':
      return 'material:iron_ingot';
    case 'diamond':
      return 'material:diamond';
    case 'netherite':
      return 'material:netherite_ingot';
    case 'elytra':
      return 'material:leather';
  }
}

/** 附魔合并（MC 铁砧）：B 的每条附魔并入 A——取更高级；同级则 +1（按各附魔 maxLvl 封顶，不会出现 MC 不存在的保护 V）。返回新附魔表 */
export function mergeEnchants(a: EnchMap | undefined, b: EnchMap | undefined): EnchMap | undefined {
  if (!b) return a;
  const out: EnchMap = { ...a };
  for (const [k, lvl] of Object.entries(b) as [keyof EnchMap, number][]) {
    const max = ENCHANTS[k].maxLvl;
    const cur = out[k] ?? 0;
    out[k] = Math.min(max, lvl > cur ? lvl : lvl === cur ? cur + 1 : cur);
  }
  return out;
}

/** 附魔表等级总和（铁砧合并费用基准，MC 简化） */
export function enchLevelSum(ench: EnchMap | undefined): number {
  return Object.values(ench ?? {}).reduce((n, v) => n + (v ?? 0), 0);
}

/** 铁砧累计使用惩罚（MC prior work penalty：2^works - 1 级） */
export function priorWorkPenalty(works: number): number {
  return works <= 0 ? 0 : 2 ** works - 1;
}
