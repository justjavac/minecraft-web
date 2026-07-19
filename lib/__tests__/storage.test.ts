// 容器存储：存入/取出/堆叠合并/满溢/破坏掉落

import { beforeEach, describe, expect, it } from 'vitest';
import { BLOCK_BY_KEY } from '../blocks';
import { clearDrops, itemDrops } from '../items';
import { emptySlots, type Slot } from '../slots';
import {
  clearStorages,
  dropStorageContents,
  getStorage,
  putIntoStorage,
  STORAGE_SIZE,
  storages,
  takeFromStorage,
} from '../storage';

const STONE = BLOCK_BY_KEY.stone.id;

function hotbarWith(slot: Slot): Slot[] {
  const slots = emptySlots();
  slots[0] = slot;
  return slots;
}

describe('容器存储', () => {
  beforeEach(() => {
    clearStorages();
    clearDrops();
  });

  it('getStorage 惰性创建 27 格且按 key 持久', () => {
    const a = getStorage('1,2,3');
    expect(a.length).toBe(STORAGE_SIZE);
    a[0] = { kind: 'block', id: STONE, count: 5 };
    expect(getStorage('1,2,3')[0]).toEqual({ kind: 'block', id: STONE, count: 5 });
    expect(getStorage('4,5,6')[0]).toBeNull();
  });

  it('存入整叠并并堆，取回热键栏', () => {
    const storage = getStorage('k');
    storage[0] = { kind: 'block', id: STONE, count: 30 };
    let slots = hotbarWith({ kind: 'block', id: STONE, count: 40 });
    slots = putIntoStorage(slots, 0, storage);
    // 30+40 → 64 + 6
    expect(storage[0]).toEqual({ kind: 'block', id: STONE, count: 64 });
    expect(storage[1]).toEqual({ kind: 'block', id: STONE, count: 6 });
    expect(slots[0]).toBeNull();
    // 取回
    slots = takeFromStorage(slots, storage, 0);
    expect(slots[0]).toEqual({ kind: 'block', id: STONE, count: 64 });
    expect(storage[0]).toBeNull();
  });

  it('容器满时原物留在热键栏', () => {
    const storage = getStorage('k');
    for (let i = 0; i < STORAGE_SIZE; i++) storage[i] = { kind: 'block', id: BLOCK_BY_KEY.dirt.id, count: 64 };
    const slots = hotbarWith({ kind: 'block', id: STONE, count: 10 });
    const next = putIntoStorage(slots, 0, storage);
    expect(next[0]).toEqual({ kind: 'block', id: STONE, count: 10 });
  });

  it('工具不可堆叠：占独立格，热键栏满则取不出', () => {
    const storage = getStorage('k');
    let slots = hotbarWith({ kind: 'tool', tool: 'iron_pickaxe', durability: 200 });
    slots = putIntoStorage(slots, 0, storage);
    expect(slots[0]).toBeNull();
    expect(storage[0]).toEqual({ kind: 'tool', tool: 'iron_pickaxe', durability: 200 });
    // 热键栏塞满 → 取不出
    const full = emptySlots().map(() => ({ kind: 'block', id: STONE, count: 1 }) as Slot);
    const after = takeFromStorage(full, storage, 0);
    expect(storage[0]).not.toBeNull();
    expect(after).toBe(full);
  });

  it('破坏容器掉落全部内容物并清除状态', () => {
    const key = '7,8,9';
    const storage = getStorage(key);
    storage[0] = { kind: 'block', id: STONE, count: 3 };
    storage[1] = { kind: 'material', material: 'coal', count: 2 };
    dropStorageContents(key, 7, 8, 9);
    expect(storages.has(key)).toBe(false);
    expect(itemDrops.length).toBe(2);
    expect(itemDrops.reduce((n, d) => n + d.count, 0)).toBe(5);
  });
});
