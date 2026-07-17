// 热键栏槽位模型与纯函数操作（不依赖 store，可单测）

import type { ArmorPiece } from './armor';
import type { BlockId } from './blocks';
import type { ToolType } from './tools';

/** 槽位：方块堆叠 / 材料 / 工具 / 装备（不可堆叠，带耐久） */
export type Slot =
  | { kind: 'block'; id: BlockId; count: number }
  | { kind: 'material'; material: string; count: number }
  | { kind: 'tool'; tool: ToolType; durability: number }
  | { kind: 'armor'; piece: ArmorPiece; durability: number }
  | null;

/** 可堆叠的槽位（方块/材料） */
function isStackSlot(slot: Slot): slot is { kind: 'block'; id: BlockId; count: number } | { kind: 'material'; material: string; count: number } {
  return slot !== null && (slot.kind === 'block' || slot.kind === 'material');
}

export const HOTBAR_SIZE = 9;

export function emptySlots(): Slot[] {
  return Array.from({ length: HOTBAR_SIZE }, () => null);
}

export const STACK_MAX = 64; // MC 一组 64

/** 向槽位添加可堆叠物品，返回放不下的数量 */
export function addStackToSlots(
  slots: Slot[],
  item: { kind: 'block'; id: BlockId } | { kind: 'material'; material: string },
  count: number,
): { slots: Slot[]; leftover: number } {
  const next = [...slots];
  const key = item.kind === 'block' ? `block:${item.id}` : `material:${item.material}`;
  let left = count;
  // 先合并进已有堆叠
  for (let i = 0; i < next.length && left > 0; i++) {
    const s = next[i];
    if (!isStackSlot(s)) continue;
    const k = s.kind === 'block' ? `block:${s.id}` : `material:${s.material}`;
    if (k !== key) continue;
    const add = Math.min(STACK_MAX - s.count, left);
    if (add > 0) {
      next[i] = { ...s, count: s.count + add };
      left -= add;
    }
  }
  // 再放进空槽
  for (let i = 0; i < next.length && left > 0; i++) {
    if (next[i] !== null) continue;
    const add = Math.min(STACK_MAX, left);
    next[i] = item.kind === 'block' ? { kind: 'block', id: item.id, count: add } : { kind: 'material', material: item.material, count: add };
    left -= add;
  }
  return { slots: next, leftover: left };
}

/** 给工具找一个空槽，满则返回 null */
export function addToolToSlots(slots: Slot[], tool: ToolType, durability: number): Slot[] | null {
  const i = slots.indexOf(null);
  if (i < 0) return null;
  const next = [...slots];
  next[i] = { kind: 'tool', tool, durability };
  return next;
}

/** 给装备找一个空槽，满则返回 null */
export function addArmorToSlots(slots: Slot[], piece: ArmorPiece, durability: number): Slot[] | null {
  const i = slots.indexOf(null);
  if (i < 0) return null;
  const next = [...slots];
  next[i] = { kind: 'armor', piece, durability };
  return next;
}

/** 材料聚合计数：'block:<id>' 与 'material:<name>' */
export function countsOf(slots: Slot[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of slots) {
    if (!isStackSlot(s)) continue;
    const key = s.kind === 'block' ? `block:${s.id}` : `material:${s.material}`;
    counts[key] = (counts[key] ?? 0) + s.count;
  }
  return counts;
}
