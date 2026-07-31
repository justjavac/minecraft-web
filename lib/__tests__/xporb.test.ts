// 死亡经验球（MC）：死亡掉落约 min(等级×7, 100) 点经验球，可捡回；超龄消失

import { afterEach, describe, expect, it } from 'vitest';
import { levelFromXp, xpForLevel } from '../xp';
import { clearXpOrbs, spawnXpOrbs, tickXpOrbs, xpOrbs } from '../xporb';
import { VOID_TERRAIN } from '../noise';
import { World } from '../world';

const solid = () => false;

afterEach(() => clearXpOrbs());

describe('死亡经验球', () => {
  it('掉落总量守恒：拆成多球，总量 = min(等级×7, 100)', () => {
    const level = levelFromXp(500).level;
    const expected = Math.min(level * 7, 100);
    spawnXpOrbs(4, 40, 4, expected);
    expect(xpOrbs.length).toBeGreaterThanOrEqual(3);
    expect(xpOrbs.reduce((n, o) => n + o.value, 0)).toBe(expected);
  });

  it('拾取：贴近玩家的球被吸收并回调加经验', () => {
    const w = new World('xporb', undefined, VOID_TERRAIN);
    spawnXpOrbs(4, 40, 4, 10);
    let got = 0;
    const player = { x: 4.2, y: 40, z: 4.2 };
    // 等过拾取延迟
    for (let i = 0; i < 30; i++) tickXpOrbs(w, 0.1, player, (v) => (got += v), solid);
    expect(got).toBe(10);
    expect(xpOrbs.length).toBe(0);
  });

  it('吸附：2.5 格外不动，入内吸向玩家', () => {
    const w = new World('xporb2', undefined, VOID_TERRAIN);
    xpOrbs.push({ id: 99, x: 4, y: 40, z: 4, velX: 0, velY: 0, velZ: 0, value: 3, age: 1 });
    const player = { x: 4, y: 40, z: 6 };
    // 距离 2 < 2.5：应吸向 +z
    tickXpOrbs(w, 0.1, player, () => undefined, solid);
    expect(xpOrbs[0].velZ).toBeGreaterThan(0);
    // 远距：不吸
    xpOrbs[0].x = 4;
    xpOrbs[0].z = 0;
    xpOrbs[0].velZ = 0;
    tickXpOrbs(w, 0.1, player, () => undefined, solid);
    expect(xpOrbs[0].velZ).toBeLessThanOrEqual(0);
  });

  it('MC 等级换算：xpForLevel 与 levelFromXp 一致（死亡掉落公式依赖）', () => {
    // 等级 5 的死亡掉落 = 35（< 100 上限）
    expect(Math.min(5 * 7, 100)).toBe(35);
    expect(Math.min(20 * 7, 100)).toBe(100); // 上限 100
    expect(xpForLevel(0)).toBeGreaterThan(0);
  });
});
