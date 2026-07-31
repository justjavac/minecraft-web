// 横扫攻击（MC Java）：剑 + 冷却全满 + 非冲刺命中时，主目标水平/垂直 1 格内其他敌对生物各受 1 点横扫伤害
// （剑/冷却/冲刺的条件判定在 Player 攻击分支，这里测 sweepAround 的范围与目标筛选）

import { afterEach, describe, expect, it } from 'vitest';
import { sweepAround } from '../actions';
import { clearMobs, spawnMobAt } from '../mobs';
import { VOID_TERRAIN } from '../noise';
import { World } from '../world';

afterEach(() => {
  clearMobs();
});

describe('横扫攻击', () => {
  it('主目标 1 格内其他敌对生物受 1 点伤害；主目标/远处/被动生物不受影响', () => {
    const w = new World('sweep-test', undefined, VOID_TERRAIN);
    const target = spawnMobAt('zombie', 10.5, 30, 10.5);
    const near = spawnMobAt('zombie', 11.2, 30, 10.9); // 水平差 <1
    const above = spawnMobAt('zombie', 10.5, 30.8, 10.5); // 垂直差 <1
    const far = spawnMobAt('zombie', 13.5, 30, 10.5); // 水平 3 格
    const tooHigh = spawnMobAt('zombie', 10.5, 32.5, 10.5); // 垂直 2 格
    const passive = spawnMobAt('pig', 10.8, 30, 10.8); // 被动生物不横扫
    const hp = [target.hp, near.hp, above.hp, far.hp, tooHigh.hp, passive.hp];
    const hits = sweepAround(target, { x: 10.5, z: 10.5 }, w);
    expect(hits).toBe(2);
    expect(target.hp).toBe(hp[0]); // 主目标不受横扫（主攻击已结算）
    expect(near.hp).toBe(hp[1] - 1); // 横扫固定 1 点
    expect(above.hp).toBe(hp[2] - 1);
    expect(far.hp).toBe(hp[3]);
    expect(tooHigh.hp).toBe(hp[4]);
    expect(passive.hp).toBe(hp[5]);
  });
});
