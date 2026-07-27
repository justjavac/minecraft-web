// 铁砧：修复工具/装备（对应材料补 25% 耐久，MC）与附魔合并（同类两件合一，取高级、同级 +1 上限 5，MC）

import type { ArmorMaterial } from './armor';
import { TOOLS, type ToolType } from './tools';
import type { EnchMap } from './xp';

/** 物品键形式：'block:<id>' 或 'material:<name>'（与配方/扣料管线一致） */

/** 工具修复材料（MC：木→木板、石→圆石、铁→铁锭、钻→钻石、合金→合金锭；弓/钓竿→线，剪刀→铁锭） */
export function toolRepairMaterial(tool: ToolType): string | null {
  const def = TOOLS[tool];
  if (!def) return null;
  if (tool === 'bow' || tool === 'fishing_rod') return 'material:string';
  if (tool === 'shears') return 'material:iron_ingot';
  switch (def.tier) {
    case 'wood':
      return 'block:oak_planks';
    case 'stone':
      return 'block:cobblestone';
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

/** 附魔合并（MC 铁砧）：B 的每条附魔并入 A——取更高级；同级则 +1（上限 5）。返回新附魔表 */
export function mergeEnchants(a: EnchMap | undefined, b: EnchMap | undefined): EnchMap | undefined {
  if (!b) return a;
  const out: EnchMap = { ...a };
  for (const [k, lvl] of Object.entries(b) as [keyof EnchMap, number][]) {
    const cur = out[k] ?? 0;
    out[k] = lvl > cur ? lvl : lvl === cur ? Math.min(5, cur + 1) : cur;
  }
  return out;
}
