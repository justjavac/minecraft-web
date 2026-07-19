// 容器存储（箱子/木桶）：按位置 key 持久 27 格，破坏时掉落内容物。纯数据逻辑（可单测）

import { spawnArmorDrop, spawnBlockDrop, spawnMaterialDrop, spawnToolDrop } from './items';
import { addStackToSlots, type Slot } from './slots';

export const STORAGE_SIZE = 27;

/** 世界内所有容器，key = "x,y,z" */
export const storages = new Map<string, Slot[]>();

export function getStorage(key: string): Slot[] {
  let s = storages.get(key);
  if (!s) {
    s = Array.from({ length: STORAGE_SIZE }, () => null);
    storages.set(key, s);
  }
  return s;
}

export function clearStorages(): void {
  storages.clear();
}

function sameStack(a: Slot, b: Slot): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'block' && b.kind === 'block') return a.id === b.id;
  if (a.kind === 'material' && b.kind === 'material') return a.material === b.material;
  return false;
}

/** 热键栏 slotIndex 整叠 → 容器（先并堆再占空格）；放不下的部分留在热键栏 */
export function putIntoStorage(slots: Slot[], slotIndex: number, storage: Slot[]): Slot[] {
  const slot = slots[slotIndex];
  if (!slot) return slots;
  if (slot.kind === 'tool' || slot.kind === 'armor') {
    const empty = storage.findIndex((s) => s === null);
    if (empty < 0) return slots;
    storage[empty] = slot;
    const next = [...slots];
    next[slotIndex] = null;
    return next;
  }
  let count = slot.count;
  for (let i = 0; i < storage.length && count > 0; i++) {
    const s = storage[i];
    if (!s || s.kind === 'tool' || s.kind === 'armor' || !sameStack(s, slot)) continue;
    if (s.count < 64) {
      const add = Math.min(64 - s.count, count);
      storage[i] = { ...s, count: s.count + add };
      count -= add;
    }
  }
  for (let i = 0; i < storage.length && count > 0; i++) {
    if (!storage[i]) {
      const add = Math.min(64, count);
      storage[i] =
        slot.kind === 'block'
          ? { kind: 'block', id: slot.id, count: add }
          : { kind: 'material', material: slot.material, count: add };
      count -= add;
    }
  }
  if (count === slot.count) return slots; // 一个都没放进去
  const next = [...slots];
  next[slotIndex] = count > 0 ? { ...slot, count } : null;
  return next;
}

/** 容器 index 整叠 → 热键栏；放不下的部分留在容器 */
export function takeFromStorage(slots: Slot[], storage: Slot[], index: number): Slot[] {
  const slot = storage[index];
  if (!slot) return slots;
  if (slot.kind === 'tool' || slot.kind === 'armor') {
    const empty = slots.findIndex((s) => s === null);
    if (empty < 0) return slots;
    const next = [...slots];
    next[empty] = slot;
    storage[index] = null;
    return next;
  }
  const out =
    slot.kind === 'block'
      ? addStackToSlots(slots, { kind: 'block', id: slot.id }, slot.count)
      : addStackToSlots(slots, { kind: 'material', material: slot.material }, slot.count);
  storage[index] = out.leftover > 0 ? { ...slot, count: out.leftover } : null;
  return out.slots;
}

/** 容器被破坏：掉落全部内容物并清除状态 */
export function dropStorageContents(key: string, x: number, y: number, z: number): void {
  const storage = storages.get(key);
  if (!storage) return;
  for (const slot of storage) {
    if (!slot) continue;
    if (slot.kind === 'block') spawnBlockDrop(slot.id, x + 0.5, y + 0.5, z + 0.5, slot.count);
    else if (slot.kind === 'material') spawnMaterialDrop(slot.material, x + 0.5, y + 0.5, z + 0.5, slot.count);
    else if (slot.kind === 'tool') spawnToolDrop(slot.tool, x + 0.5, y + 0.5, z + 0.5, slot.durability);
    else spawnArmorDrop(slot.piece, x + 0.5, y + 0.5, z + 0.5, slot.durability);
  }
  storages.delete(key);
}
