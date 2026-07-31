// 世界作用域 registry（lib/worldScope.ts）：注册/清理/快照/恢复的结构保证。
// 用真实系统模块做集成断言（模块加载即自注册），另用一个临时 scope 验证注册/注销本身。

import { describe, expect, it } from 'vitest';
import { activeBeacons } from '../beacon';
import { brews } from '../brewing';
import { furnaces } from '../furnace';
import { mobs } from '../mobs';
import { storages } from '../storage';
import { primedTnt } from '../tnt';
import { emptySlots } from '../slots';
// 仅清理的 clear-only 系统：副作用导入触发自注册
import '../crops';
import '../fishing';
import { enqueueFluid, fluidQueueSize } from '../fluids';
import '../gravity';
import '../items';
import '../redstone';
import '../saplings';
import '../xporb';
import {
  clearWorldScopes,
  registerWorldScope,
  restoreWorldScopes,
  snapshotWorldScopes,
  worldScopeNames,
} from '../worldScope';

/** 14 个既有系统的注册名（新增系统只需在模块内 register 一次即自动纳入） */
const EXPECTED_SCOPES = [
  'mobs',
  'furnace',
  'brewing',
  'storage',
  'fluids',
  'fishing',
  'saplings',
  'crops',
  'redstone',
  'gravity',
  'xporb',
  'tnt',
  'beacon',
  'items',
];

describe('worldScope registry', () => {
  it('14 个世界系统全部自注册', () => {
    for (const name of EXPECTED_SCOPES) {
      expect(worldScopeNames()).toContain(name);
    }
  });

  it('快照 → 清空 → 恢复：可持久化系统（容器/熔炉/酿造/TNT/信标）完整往返', () => {
    const chest = emptySlots();
    chest[0] = { kind: 'block', id: 1, count: 3 };
    storages.set('1,64,1', chest);
    furnaces.set('2,64,2', { input: null, fuel: null, output: null, burnLeft: 0, progress: 0, xp: 0 });
    brews.set('3,64,3', { ingredient: null, fuel: null, potions: [null, null, null], burnLeft: 0, progress: 0 });
    primedTnt.push({ id: 1, x: 0.5, y: 64, z: 0.5, vy: 0, fuse: 4 });
    activeBeacons.set('4,64,4', { x: 4, y: 64, z: 4, effect: 'speed' });

    const snap = snapshotWorldScopes();
    expect(Object.keys(snap)).toEqual(expect.arrayContaining(['storage', 'furnace', 'brewing', 'tnt', 'beacon']));

    clearWorldScopes();
    expect(storages.size).toBe(0);
    expect(furnaces.size).toBe(0);
    expect(brews.size).toBe(0);
    expect(primedTnt).toHaveLength(0);
    expect(activeBeacons.size).toBe(0);

    restoreWorldScopes(snap);
    expect(storages.get('1,64,1')?.[0]).toEqual({ kind: 'block', id: 1, count: 3 });
    expect(furnaces.has('2,64,2')).toBe(true);
    expect(brews.has('3,64,3')).toBe(true);
    expect(primedTnt).toHaveLength(1);
    expect(activeBeacons.get('4,64,4')?.effect).toBe('speed');
  });

  it('恢复时快照缺失的可恢复系统被清空（不残留上一维度状态）', () => {
    storages.set('9,64,9', emptySlots());
    primedTnt.push({ id: 2, x: 0, y: 64, z: 0, vy: 0, fuse: 4 });
    restoreWorldScopes({}); // 空快照：所有可恢复系统清空
    expect(storages.size).toBe(0);
    expect(primedTnt).toHaveLength(0);
  });

  it('clearWorldScopes 同时覆盖 clear-only 系统（流体队列/生物）', () => {
    enqueueFluid(0, 64, 0);
    mobs.length = 0;
    clearWorldScopes();
    expect(fluidQueueSize()).toBe(0);
    expect(mobs).toHaveLength(0);
  });

  it('注册返回注销函数：临时 scope 可注册/快照/注销', () => {
    let cleared = 0;
    const dispose = registerWorldScope<{ n: number }>({
      name: '__test__',
      clear: () => {
        cleared++;
      },
      snapshot: () => ({ n: 42 }),
      restore: () => {},
    });
    expect(worldScopeNames()).toContain('__test__');
    expect(snapshotWorldScopes().__test__).toEqual({ n: 42 });
    clearWorldScopes();
    expect(cleared).toBe(1);
    dispose();
    expect(worldScopeNames()).not.toContain('__test__');
  });
});
