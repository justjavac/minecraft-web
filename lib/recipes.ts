// 合成配方（与 MC 原版一致）：随身 2×2 + 工作台 3×3

import { COBBLE, CRAFTING_TABLE, FURNACE, LOG, PLANKS, type BlockId } from './blocks';
import { countsOf, type Slot } from './slots';
import type { ArmorPiece } from './armor';
import type { ToolType } from './tools';

export interface RecipeOutBlock {
  kind: 'block';
  id: BlockId;
  count: number;
}
export interface RecipeOutMaterial {
  kind: 'material';
  material: string;
  count: number;
}
export interface RecipeOutTool {
  kind: 'tool';
  tool: ToolType;
}
export interface RecipeOutArmor {
  kind: 'armor';
  piece: ArmorPiece;
}

export type RecipeOut = RecipeOutBlock | RecipeOutMaterial | RecipeOutTool | RecipeOutArmor;

export interface Recipe {
  id: string;
  name: string;
  out: RecipeOut;
  /** 材料：item 为 'block:<id>' 或 'material:<name>' */
  cost: { item: string; count: number }[];
  /** 需要工作台（3×3），否则随身 2×2 即可 */
  needsTable: boolean;
}

const LOG_ITEM = `block:${LOG}`;
const PLANKS_ITEM = `block:${PLANKS}`;
const COBBLE_ITEM = `block:${COBBLE}`;
const STICK = 'material:stick';

export const RECIPES: Recipe[] = [
  // —— 随身 2×2 ——
  { id: 'planks', name: '木板 ×4', out: { kind: 'block', id: PLANKS, count: 4 }, cost: [{ item: LOG_ITEM, count: 1 }], needsTable: false },
  { id: 'stick', name: '木棍 ×4', out: { kind: 'material', material: 'stick', count: 4 }, cost: [{ item: PLANKS_ITEM, count: 2 }], needsTable: false },
  { id: 'crafting_table', name: '工作台', out: { kind: 'block', id: CRAFTING_TABLE, count: 1 }, cost: [{ item: PLANKS_ITEM, count: 4 }], needsTable: false },
  // —— 工作台 3×3：工具（配方与 MC 一致） ——
  { id: 'furnace', name: '熔炉', out: { kind: 'block', id: FURNACE, count: 1 }, cost: [{ item: `block:${COBBLE}`, count: 8 }], needsTable: true },
  { id: 'wooden_pickaxe', name: '木镐', out: { kind: 'tool', tool: 'wooden_pickaxe' }, cost: [{ item: PLANKS_ITEM, count: 3 }, { item: STICK, count: 2 }], needsTable: true },
  { id: 'stone_pickaxe', name: '石镐', out: { kind: 'tool', tool: 'stone_pickaxe' }, cost: [{ item: COBBLE_ITEM, count: 3 }, { item: STICK, count: 2 }], needsTable: true },
  { id: 'wooden_axe', name: '木斧', out: { kind: 'tool', tool: 'wooden_axe' }, cost: [{ item: PLANKS_ITEM, count: 3 }, { item: STICK, count: 2 }], needsTable: true },
  { id: 'stone_axe', name: '石斧', out: { kind: 'tool', tool: 'stone_axe' }, cost: [{ item: COBBLE_ITEM, count: 3 }, { item: STICK, count: 2 }], needsTable: true },
  { id: 'wooden_shovel', name: '木锹', out: { kind: 'tool', tool: 'wooden_shovel' }, cost: [{ item: PLANKS_ITEM, count: 1 }, { item: STICK, count: 2 }], needsTable: true },
  { id: 'stone_shovel', name: '石锹', out: { kind: 'tool', tool: 'stone_shovel' }, cost: [{ item: COBBLE_ITEM, count: 1 }, { item: STICK, count: 2 }], needsTable: true },
  { id: 'wooden_sword', name: '木剑', out: { kind: 'tool', tool: 'wooden_sword' }, cost: [{ item: PLANKS_ITEM, count: 2 }, { item: STICK, count: 1 }], needsTable: true },
  { id: 'stone_sword', name: '石剑', out: { kind: 'tool', tool: 'stone_sword' }, cost: [{ item: COBBLE_ITEM, count: 2 }, { item: STICK, count: 1 }], needsTable: true },
  // —— 皮革装备（MC 配方用量 5/8/7/4） ——
  { id: 'leather_helmet', name: '皮革头盔', out: { kind: 'armor', piece: 'helmet' }, cost: [{ item: 'material:leather', count: 5 }], needsTable: true },
  { id: 'leather_chestplate', name: '皮革胸甲', out: { kind: 'armor', piece: 'chestplate' }, cost: [{ item: 'material:leather', count: 8 }], needsTable: true },
  { id: 'leather_leggings', name: '皮革护腿', out: { kind: 'armor', piece: 'leggings' }, cost: [{ item: 'material:leather', count: 7 }], needsTable: true },
  { id: 'leather_boots', name: '皮革靴子', out: { kind: 'armor', piece: 'boots' }, cost: [{ item: 'material:leather', count: 4 }], needsTable: true },
];

/** 材料是否足够 */
export function canCraft(slots: Slot[], recipe: Recipe): boolean {
  const counts = countsOf(slots);
  return recipe.cost.every((c) => (counts[c.item] ?? 0) >= c.count);
}

/** 应用一次合成：扣材料 + 产出（调用前需 canCraft 与空间检查通过） */
export function applyCraft(
  slots: Slot[],
  recipe: Recipe,
  toolDurability: number,
): Slot[] {
  let next = [...slots];
  // 扣材料（逐个槽位扣）
  for (const c of recipe.cost) {
    let left = c.count;
    next = next.map((s) => {
      if (left <= 0 || !s || (s.kind !== 'block' && s.kind !== 'material')) return s; // 工具/装备不可作材料
      const key = s.kind === 'block' ? `block:${s.id}` : `material:${s.material}`;
      if (key !== c.item) return s;
      const take = Math.min(s.count, left);
      left -= take;
      const remain = s.count - take;
      return remain > 0 ? { ...s, count: remain } : null;
    });
  }
  // 产出
  if (recipe.out.kind === 'tool') {
    const i = next.indexOf(null);
    next[i] = { kind: 'tool', tool: recipe.out.tool, durability: toolDurability };
  } else if (recipe.out.kind === 'armor') {
    const i = next.indexOf(null);
    next[i] = { kind: 'armor', piece: recipe.out.piece, durability: toolDurability };
  } else {
    const out = recipe.out;
    let left = out.count; // 用局部变量，不能改共享配方对象
    // 与 addStackToSlots 同逻辑（合成调用方已做空间预检）
    for (let i = 0; i < next.length && left > 0; i++) {
      const s = next[i];
      if (s && ((out.kind === 'block' && s.kind === 'block' && s.id === out.id) ||
                (out.kind === 'material' && s.kind === 'material' && s.material === out.material))) {
        const add = Math.min(64 - s.count, left);
        next[i] = { ...s, count: s.count + add } as Slot;
        left -= add;
      }
    }
    for (let i = 0; i < next.length && left > 0; i++) {
      if (next[i] !== null) continue;
      const add = Math.min(64, left);
      next[i] = out.kind === 'block'
        ? { kind: 'block', id: out.id, count: add }
        : { kind: 'material', material: out.material, count: add };
      left -= add;
    }
  }
  return next;
}

/** 输出是否有空间放（工具/装备需空槽；方块/材料需可合并或空槽） */
export function hasSpaceFor(slots: Slot[], out: RecipeOut): boolean {
  if (out.kind === 'tool' || out.kind === 'armor') return slots.includes(null);
  const key = out.kind === 'block' ? `block:${out.id}` : `material:${out.material}`;
  let space = 0;
  for (const s of slots) {
    if (!s) space += 64;
    else if (s.kind === 'block' || s.kind === 'material') {
      const k = s.kind === 'block' ? `block:${s.id}` : `material:${s.material}`;
      if (k === key) space += 64 - s.count;
    }
  }
  return space >= out.count;
}
