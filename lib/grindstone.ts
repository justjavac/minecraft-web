// 砂轮（MC Java）：两输入槽 + 输出槽。纯函数（不依赖 store，可单测）
// ① 两件同种工具/装备 → 合并修复：耐久 = A+B + 5%×最大耐久（封顶），附魔全部移除
// ② 单件附魔物品 → 祛魔：移除非诅咒附魔并返还经验（按附魔等级折算）
// ③ 输出从输出槽取出时生效（输入两槽清空 + 返还经验）
// 诅咒附魔：项目附魔清单（lib/xp.ts ENCHANTS）暂无诅咒类，故「诅咒保留」不生效，注释备查

import { armorDefOf } from './armor';
import type { Slot } from './slots';
import { TOOLS } from './tools';
import type { EnchMap } from './xp';

/** 砂轮接受的物品：工具 / 装备（不可堆叠、带耐久） */
type Grindable = Extract<NonNullable<Slot>, { kind: 'tool' | 'armor' }>;

export function isGrindable(slot: Slot): slot is Grindable {
  return slot !== null && (slot.kind === 'tool' || slot.kind === 'armor');
}

/** 该工具/装备的最大耐久 */
export function maxDurability(slot: NonNullable<Slot>): number {
  if (slot.kind === 'tool') return TOOLS[slot.tool].durability;
  if (slot.kind === 'armor') return armorDefOf({ piece: slot.piece, material: slot.material }).durability;
  return 0;
}

/** 两件是否同种（MC 砂轮合并前提）：工具同 type；装备同部位 + 同材质 */
export function sameKind(a: Slot, b: Slot): boolean {
  if (!isGrindable(a) || !isGrindable(b)) return false;
  if (a.kind === 'tool' && b.kind === 'tool') return a.tool === b.tool;
  if (a.kind === 'armor' && b.kind === 'armor') return a.piece === b.piece && (a.material ?? 'leather') === (b.material ?? 'leather');
  return false;
}

/**
 * 祛魔返还经验。Java 公式：每条非诅咒附魔按其等级经验区间 [min, max] 取 ceil((min+max)/2)；
 * 项目附魔无逐条 min/max 表，近似按附魔等级求和（锋利 III + 耐久 II → 5）。
 */
export function disenchantXp(ench: EnchMap | undefined): number {
  return Object.values(ench ?? {}).reduce((n, v) => n + (v ?? 0), 0);
}

export interface GrindOutput {
  /** 产出物品（修复/祛魔后的成品；附魔与铁砧累计惩罚 works 均移除，MC） */
  out: NonNullable<Slot>;
  /** 取出产出时返还的经验（祛魔折算；合并修复时两件附魔一并折算） */
  xp: number;
}

/**
 * 由两输入槽计算输出（null = 无产出）：
 * - 两件同种 → 合并修复（耐久 A+B+5%×max 封顶；附魔全移除并折算经验）
 * - 单件附魔 → 祛魔（移除附魔，耐久不变；折算经验）
 * - 其余（空 / 单件无附魔 / 两件不同种 / 不可磨物品）→ null
 */
export function grindResult(a: Slot, b: Slot): GrindOutput | null {
  if (isGrindable(a) && isGrindable(b)) {
    if (!sameKind(a, b)) return null;
    const max = maxDurability(a);
    const durability = Math.min(max, a.durability + b.durability + Math.ceil(max * 0.05));
    // 以 A 为基底：清附魔与 works（MC 砂轮同时移除 prior work penalty）
    const out: Grindable = { ...a, durability };
    delete out.ench;
    delete out.works;
    return { out, xp: disenchantXp(a.ench) + disenchantXp(b.ench) };
  }
  const single = isGrindable(a) ? a : isGrindable(b) ? b : null;
  if (single) {
    if (!single.ench || Object.keys(single.ench).length === 0) return null; // 无附魔无可祛（Java 无产出）
    const out: Grindable = { ...single };
    delete out.ench;
    delete out.works;
    return { out, xp: disenchantXp(single.ench) };
  }
  return null;
}
