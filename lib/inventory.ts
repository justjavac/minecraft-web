// 背包/容器光标交互（MC Java 语义）纯函数：光标堆叠的拿起/放下/合并/交换、右键半取与单放、
// 左键拖动均分、右键拖动逐格放一、双击收集、shift 快速移动。不依赖 store，可单测；
// store.ts 只持有 cursorSlot 状态与薄 action，UI（components/game/McGui.tsx）只做接线。

import type { BlockId } from './blocks';
import { addStackToSlots, STACK_MAX, type Slot } from './slots';

/** 可堆叠槽位（方块/材料）；工具/装备 count 视为 1 */
export function isStackable(slot: Slot): slot is { kind: 'block'; id: BlockId; count: number } | { kind: 'material'; material: string; count: number } {
  return slot !== null && (slot.kind === 'block' || slot.kind === 'material');
}

/** 槽位数量（工具/装备按 1 计） */
export function slotCount(slot: Slot): number {
  if (!slot) return 0;
  return isStackable(slot) ? slot.count : 1;
}

/** 同类可合并（同方块 id / 同材料名）；工具/装备永不合并 */
export function sameStack(a: Slot, b: Slot): boolean {
  if (!a || !b) return false;
  if (a.kind === 'block' && b.kind === 'block') return a.id === b.id;
  if (a.kind === 'material' && b.kind === 'material') return a.material === b.material;
  return false;
}

/** 光标减 1（工具/装备直接清空） */
function decCursor(cursor: NonNullable<Slot>): Slot {
  if (isStackable(cursor)) return cursor.count > 1 ? { ...cursor, count: cursor.count - 1 } : null;
  return null;
}

/** 取光标中的 1 个（工具/装备为整件） */
function oneOf(cursor: NonNullable<Slot>): Slot {
  return isStackable(cursor) ? { ...cursor, count: 1 } : cursor;
}

/**
 * 左键点击槽位：
 * - 光标空 → 拿起整堆
 * - 光标有物 → 空格放下 / 同类合并（到 64 上限，余数留光标）/ 异类交换
 */
export function clickSlot(slots: Slot[], index: number, cursor: Slot): { slots: Slot[]; cursor: Slot } {
  const slot = slots[index];
  if (slot === undefined) return { slots, cursor };
  if (cursor === null) {
    if (slot === null) return { slots, cursor };
    const next = [...slots];
    next[index] = null;
    return { slots: next, cursor: slot };
  }
  if (slot === null) {
    const next = [...slots];
    next[index] = cursor;
    return { slots: next, cursor: null };
  }
  if (isStackable(cursor) && isStackable(slot) && sameStack(cursor, slot) && slot.count < STACK_MAX) {
    // 同类合并到 64，余数留光标
    const add = Math.min(STACK_MAX - slot.count, cursor.count);
    const next = [...slots];
    next[index] = { ...slot, count: slot.count + add };
    return { slots: next, cursor: cursor.count > add ? { ...cursor, count: cursor.count - add } : null };
  }
  // 异类（或目标已满）→ 交换
  const next = [...slots];
  next[index] = cursor;
  return { slots: next, cursor: slot };
}

/**
 * 右键点击槽位：
 * - 光标空 → 拿起一半（向上取整；工具/装备为整件）
 * - 光标有物 → 放一个（空格或同类未满格；异类/已满不动）
 */
export function rightClickSlot(slots: Slot[], index: number, cursor: Slot): { slots: Slot[]; cursor: Slot } {
  const slot = slots[index];
  if (slot === undefined) return { slots, cursor };
  if (cursor === null) {
    if (slot === null) return { slots, cursor };
    if (!isStackable(slot)) {
      const next = [...slots];
      next[index] = null;
      return { slots: next, cursor: slot };
    }
    const half = Math.ceil(slot.count / 2);
    const next = [...slots];
    next[index] = slot.count > half ? { ...slot, count: slot.count - half } : null;
    return { slots: next, cursor: { ...slot, count: half } };
  }
  // 放一个
  if (slot === null) {
    const next = [...slots];
    next[index] = oneOf(cursor);
    return { slots: next, cursor: decCursor(cursor) };
  }
  if (isStackable(slot) && sameStack(cursor, slot) && slot.count < STACK_MAX) {
    const next = [...slots];
    next[index] = { ...slot, count: slot.count + 1 };
    return { slots: next, cursor: decCursor(cursor) };
  }
  return { slots, cursor };
}

/**
 * 左键拖动均分：把拖动起始光标堆 initial 均分到拖过的格子（before 为各格拖动前的值）。
 * floor 均分，余数留光标；只进空格或同类未满格（异类格不参与计数），同类格在原有数量上
 * 叠加、封顶 64，放不下的部分退回光标。initial 不可堆叠（工具/装备）或份额为 0 时不动。
 */
export function dragSplit(before: Slot[], initial: Slot): { slots: Slot[]; cursor: Slot } {
  if (!isStackable(initial)) return { slots: before, cursor: initial };
  const total = initial.count;
  const eligible = before.map((s) => s === null || (isStackable(s) && sameStack(s, initial) && s.count < STACK_MAX));
  const n = eligible.filter(Boolean).length;
  const share = n > 0 ? Math.floor(total / n) : 0;
  if (share <= 0) return { slots: before, cursor: initial };
  let placed = 0;
  const slots = before.map((s, i) => {
    if (!eligible[i]) return s;
    const room = STACK_MAX - (isStackable(s) && sameStack(s, initial) ? s.count : 0);
    const put = Math.min(share, room);
    if (put <= 0) return s;
    placed += put;
    if (s === null) return { ...initial, count: put } as Slot;
    return isStackable(s) ? ({ ...s, count: s.count + put } as Slot) : s;
  });
  if (placed === 0) return { slots: before, cursor: initial };
  return { slots, cursor: total > placed ? { ...initial, count: total - placed } : null };
}

/** 右键拖动：进入一格放 1 个（空格或同类未满；异类/已满/不可堆叠光标跳过） */
export function dragPlaceOne(slot: Slot, cursor: Slot): { slot: Slot; cursor: Slot } {
  if (cursor === null) return { slot, cursor };
  if (slot === null) return { slot: oneOf(cursor), cursor: decCursor(cursor) };
  if (isStackable(slot) && sameStack(cursor, slot) && slot.count < STACK_MAX) {
    return { slot: { ...slot, count: slot.count + 1 }, cursor: decCursor(cursor) };
  }
  return { slot, cursor };
}

/**
 * 双击收集（光标有物时）：把界面内各区域的同类物品收进光标（到 64）。
 * 单遍顺序收集（Java 先收未满堆再收满堆，此处简化为区域顺序）；光标满或不可堆叠则不动。
 */
export function collectToCursor(areas: Slot[][], cursor: Slot): { areas: Slot[][]; cursor: Slot } {
  if (!isStackable(cursor) || cursor.count >= STACK_MAX) return { areas, cursor };
  let count = cursor.count;
  const nextAreas = areas.map((slots) => [...slots]);
  for (const slots of nextAreas) {
    for (let i = 0; i < slots.length && count < STACK_MAX; i++) {
      const s = slots[i];
      if (!isStackable(s) || !sameStack(s, cursor)) continue;
      const take = Math.min(s.count, STACK_MAX - count);
      slots[i] = s.count > take ? { ...s, count: s.count - take } : null;
      count += take;
    }
  }
  if (count === cursor.count) return { areas, cursor };
  return { areas: nextAreas, cursor: { ...cursor, count } };
}

/**
 * shift 快速移动：把整叠移入目标区域（可堆叠先并堆再占空格；工具/装备占第一个空槽）。
 * 一格都没动时原样返回（保持数组/槽位引用，store 可据此判断是否 set）。
 */
export function shiftMove(slot: Slot, target: Slot[]): { slot: Slot; target: Slot[] } {
  if (slot === null) return { slot, target };
  if (slot.kind === 'block' || slot.kind === 'material') {
    const item = slot.kind === 'block' ? { kind: 'block' as const, id: slot.id } : { kind: 'material' as const, material: slot.material };
    const out = addStackToSlots(target, item, slot.count);
    if (out.leftover === slot.count) return { slot, target };
    return { slot: out.leftover > 0 ? { ...slot, count: out.leftover } : null, target: out.slots };
  }
  const empty = target.indexOf(null);
  if (empty < 0) return { slot, target };
  const next = [...target];
  next[empty] = slot;
  return { slot: null, target: next };
}

// ——— 字符串栈（熔炉/酿造 { item, count }，item 为 'block:<id>' / 'material:<name>' 或裸材料名） ———

export interface ItemStack {
  item: string;
  count: number;
}

/** 槽位 → 材料串（仅方块/材料；工具/装备返回 null，进不了熔炉/酿造槽） */
export function slotToItemKey(slot: Slot): string | null {
  if (!slot) return null;
  if (slot.kind === 'block') return `block:${slot.id}`;
  if (slot.kind === 'material') return `material:${slot.material}`;
  return null;
}

/** 材料串 → 槽位（兼容 'block:X' / 'material:X' 前缀与裸材料名） */
export function itemKeyToSlot(item: string, count: number): Slot {
  if (item.startsWith('block:')) return { kind: 'block', id: Number(item.slice(6)), count };
  return { kind: 'material', material: item.startsWith('material:') ? item.slice(9) : item, count };
}

/** 材料串同物判断（兼容带不带 'material:' 前缀） */
function sameItemKey(a: string, b: string): boolean {
  return a === b || a === `material:${b}` || `material:${a}` === b;
}

/**
 * 字符串栈格子的左/右键点击（熔炉输入/燃料、酿造燃料/材料/药水槽共用）：
 * 规则同 clickSlot/rightClickSlot；max 为格子上限（药水槽传 1）。
 * bare 表示该格子的材料串不带 'material:' 前缀（酿造台惯例）。
 * 调用方负责放置约束（如燃料槽只收烈焰粉）：不满足时不要调用。
 */
export function clickItemStack(
  stack: ItemStack | null,
  cursor: Slot,
  button: 0 | 2,
  max = STACK_MAX,
  bare = false,
): { stack: ItemStack | null; cursor: Slot } {
  const toItem = (key: string): string => (bare && key.startsWith('material:') ? key.slice(9) : key);
  if (cursor === null) {
    if (stack === null) return { stack, cursor };
    if (button === 0) return { stack: null, cursor: itemKeyToSlot(stack.item, stack.count) };
    const half = Math.ceil(stack.count / 2);
    return { stack: stack.count > half ? { item: stack.item, count: stack.count - half } : null, cursor: itemKeyToSlot(stack.item, half) };
  }
  if (!isStackable(cursor)) return { stack, cursor }; // 工具/装备进不了字符串栈
  const key = slotToItemKey(cursor) as string; // isStackable 已保证非 null
  const cCount = cursor.count;
  if (stack === null) {
    if (button === 0) {
      const put = Math.min(cCount, max);
      return { stack: { item: toItem(key), count: put }, cursor: cCount > put ? { ...cursor, count: cCount - put } : null };
    }
    return { stack: { item: toItem(key), count: 1 }, cursor: decCursor(cursor) };
  }
  if (sameItemKey(stack.item, key) && stack.count < max) {
    if (button === 0) {
      const add = Math.min(max - stack.count, cCount);
      return { stack: { item: stack.item, count: stack.count + add }, cursor: cCount > add ? { ...cursor, count: cCount - add } : null };
    }
    return { stack: { item: stack.item, count: stack.count + 1 }, cursor: decCursor(cursor) };
  }
  // 异类（或同类已满）：左键交换（光标数量须放得下，如药水槽 max=1）
  if (button === 0 && cCount <= max) {
    return { stack: { item: toItem(key), count: cCount }, cursor: itemKeyToSlot(stack.item, stack.count) };
  }
  return { stack, cursor };
}
