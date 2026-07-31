// 存档持久化：按维度隔离的容器状态（跨维度覆盖回归）、版本/损坏校验、写失败用户提示。
// IndexedDB 用内存 fake（vi.mock('idb')），persistence 模块每用例 fresh import（重置 dbPromise/提示节流等模块态）。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Slot } from '../slots';
import type { World } from '../world';

/** 内存版 IndexedDB：两个 object store（meta/chunks）+ 可注入写失败 */
const h = vi.hoisted(() => ({
  stores: {} as Record<string, Map<string, unknown>>,
  failWrites: false,
}));

vi.mock('idb', () => ({
  openDB: () => {
    h.stores.meta ??= new Map();
    h.stores.chunks ??= new Map();
    const fail = () => Promise.reject(new Error('写入失败（测试注入）'));
    return Promise.resolve({
      get: (store: string, key: string) => Promise.resolve(h.stores[store]?.get(key)),
      put: (store: string, value: unknown, key: string) => {
        if (h.failWrites) return fail();
        h.stores[store]?.set(key, value);
        return Promise.resolve();
      },
      getAllKeys: (store: string) => Promise.resolve([...(h.stores[store]?.keys() ?? [])]),
      clear: (store: string) => {
        h.stores[store]?.clear();
        return Promise.resolve();
      },
      transaction: (store: string) => ({
        store: {
          get: (key: string) => Promise.resolve(h.stores[store]?.get(key)),
          put: (value: unknown, key: string) => {
            if (h.failWrites) return fail();
            h.stores[store]?.set(key, value);
            return Promise.resolve();
          },
        },
        get done() {
          return h.failWrites ? fail() : Promise.resolve();
        },
      }),
    });
  },
}));

/** 每个用例拿全新的 persistence 模块（模块内 dbPromise/失败节流都是单例态） */
async function freshPersistence() {
  vi.resetModules();
  return await import('../persistence');
}

/** 最小 World 替身：saveModifiedChunks 只读 seed/modifiedChunks/chunks */
function fakeWorld(seed: string): World {
  return { seed, modifiedChunks: new Set<string>(), chunks: new Map() } as unknown as World;
}

function chestWithStone(): Slot[] {
  const slots: Slot[] = Array.from({ length: 27 }, () => null);
  slots[0] = { kind: 'block', id: 1, count: 64 };
  return slots;
}

beforeEach(() => {
  h.stores = {};
  h.failWrites = false;
});

describe('跨维度存档（任务 1 回归）', () => {
  it('主世界容器 → 切下界 → 用下界 extras 保存 → 重载后主世界容器仍在', async () => {
    const p = await freshPersistence();
    const world = fakeWorld('seed1');
    const chest = chestWithStone();
    // 主世界 autosave：容器写入 dims.overworld
    await p.saveModifiedChunks(world, { dimension: 'overworld', dims: { overworld: { storages: { '1,64,1': chest } } } });

    // 切维度：读档后主世界容器进暂存；下界保存时合并「live 下界 + 暂存主世界」（World.tsx currentExtras 的纯函数部分）
    const loaded = await p.loadWorldMeta();
    const stashed = { overworld: loaded!.dims!.overworld! };
    const netherLive = p.scopesToDimExtras({
      furnace: [['5,60,5', { input: null, fuel: null, output: null, burnLeft: 0, progress: 0, xp: 0 }]],
    });
    const dims = p.mergeDims('nether', netherLive, stashed);
    await p.saveModifiedChunks(world, { dimension: 'nether', dims });

    const reloaded = await p.loadWorldMeta();
    expect(reloaded?.dimension).toBe('nether');
    expect(reloaded?.dims?.overworld?.storages?.['1,64,1']?.[0]).toEqual({ kind: 'block', id: 1, count: 64 });
    expect(reloaded?.dims?.nether?.furnaces?.['5,60,5']).toBeDefined();
  });

  it('mergeDims：当前维度以 live 为准（覆盖同名暂存），空维度不落字段', async () => {
    const p = await freshPersistence();
    const dims = p.mergeDims(
      'overworld',
      { storages: { '1,1,1': chestWithStone() } },
      { overworld: { furnaces: { '9,9,9': { input: null, fuel: null, output: null, burnLeft: 0, progress: 0, xp: 0 } } }, nether: {} },
    );
    expect(dims.overworld?.storages).toBeDefined();
    expect(dims.overworld?.furnaces).toBeUndefined(); // live 优先于暂存
    expect(dims.nether).toBeUndefined(); // 空 DimExtras 不落字段
  });

  it('scopesToDimExtras / dimExtrasToScopes 往返；全空容器不落盘', async () => {
    const p = await freshPersistence();
    const chest = chestWithStone();
    const scopes = p.dimExtrasToScopes({ storages: { '1,64,1': chest } });
    expect(p.scopesToDimExtras(scopes)).toEqual({ storages: { '1,64,1': chest } });
    // 27 格全 null 的容器视为空，不写入存档（与原 currentExtras 的过滤行为一致）
    expect(p.scopesToDimExtras({ storage: [['2,64,2', Array.from({ length: 27 }, () => null)]] })).toEqual({});
  });
});

describe('信标激活态持久化（任务 6）', () => {
  it('激活信标 → dims 存档 → 重载 → dimExtrasToScopes 还原为 beacon scope（仍激活的恢复源）', async () => {
    const p = await freshPersistence();
    const beacon = { x: 0, y: 60, z: 0, effect: 'speed' };
    const extras = p.scopesToDimExtras({ beacon: [['0,60,0', beacon]] });
    expect(extras.beacons).toEqual({ '0,60,0': beacon });
    const world = fakeWorld('seed-b');
    await p.saveModifiedChunks(world, { dimension: 'overworld', dims: p.mergeDims('overworld', extras, {}) });
    const loaded = await p.loadWorldMeta();
    expect(loaded?.dims?.overworld?.beacons?.['0,60,0']).toEqual(beacon);
    // 恢复方向：输出 registry 快照格式，restoreWorldScopes 直接消费
    expect(p.dimExtrasToScopes(loaded?.dims?.overworld)).toEqual({ beacon: [['0,60,0', beacon]] });
  });

  it('空信标表不落字段；mergeDims 保留只有信标的维度', async () => {
    const p = await freshPersistence();
    expect(p.scopesToDimExtras({ beacon: [] })).toEqual({});
    const dims = p.mergeDims('nether', {}, { overworld: { beacons: { '0,60,0': { x: 0, y: 60, z: 0, effect: 'haste' } } } });
    expect(dims.overworld?.beacons).toBeDefined();
    expect(dims.nether).toBeUndefined();
  });
});

describe('版本与损坏校验', () => {
  it('旧版本存档：明示用户 + 清库，不静默丢档（无迁移链）', async () => {
    const p = await freshPersistence();
    const messages: string[] = [];
    p.setPersistenceNoticeHandler((m) => messages.push(m));
    h.stores.meta = new Map([['current', { seed: 's', version: 7, updatedAt: 0, dimension: 'nether', storages: { '1,64,1': chestWithStone() } }]]);
    h.stores.chunks = new Map([['0,0', new Uint16Array(1)]]);
    const meta = await p.loadWorldMeta();
    expect(meta).toBeNull();
    expect(messages.some((m) => m.includes('v7') && m.includes('不符'))).toBe(true);
    expect(h.stores.meta.size).toBe(0);
    expect(h.stores.chunks.size).toBe(0);
  });

  it('来自更新版本的存档：明示用户 + 清库', async () => {
    const p = await freshPersistence();
    const messages: string[] = [];
    p.setPersistenceNoticeHandler((m) => messages.push(m));
    h.stores.meta = new Map([['current', { seed: 's', version: 99, updatedAt: 0 }]]);
    expect(await p.loadWorldMeta()).toBeNull();
    expect(messages.some((m) => m.includes('更新版本'))).toBe(true);
    expect(h.stores.meta.size).toBe(0);
  });

  it('损坏 meta（seed 非字符串 / slots 非数组）：明示损坏 + 清库', async () => {
    const p = await freshPersistence();
    const messages: string[] = [];
    p.setPersistenceNoticeHandler((m) => messages.push(m));
    h.stores.meta = new Map([['current', { seed: 123, version: 8, updatedAt: 0 }]]);
    expect(await p.loadWorldMeta()).toBeNull();
    expect(messages.some((m) => m.includes('损坏'))).toBe(true);

    h.stores.meta = new Map([['current', { seed: 's', version: 8, updatedAt: 0, survival: { health: 20, hunger: 20, slots: 'x' } }]]);
    expect(await p.loadWorldMeta()).toBeNull();
    expect(h.stores.meta.size).toBe(0);
  });
});

describe('写失败的用户可见提示（任务 2）', () => {
  it('连续写失败只提示一次；恢复成功后再次失败会再提示', async () => {
    const p = await freshPersistence();
    const messages: string[] = [];
    p.setPersistenceNoticeHandler((m) => messages.push(m));
    const world = fakeWorld('s');
    h.failWrites = true;
    await p.saveModifiedChunks(world, {});
    await p.saveModifiedChunks(world, {}); // autosave 每 5s 一次，不能刷屏
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('存档写入失败');

    h.failWrites = false;
    await p.saveModifiedChunks(world, {}); // 恢复成功
    h.failWrites = true;
    await p.saveModifiedChunks(world, {});
    expect(messages).toHaveLength(2);
  });
});
