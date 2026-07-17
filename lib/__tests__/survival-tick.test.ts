import { beforeEach, describe, expect, it } from 'vitest';
import { survivalStats } from '../game';
import { resetSurvivalMem, tickSurvival, type SurvivalMem } from '../survival';

function makeMem(): SurvivalMem {
  return { fallDist: 0, air: 15, regenTick: 0 };
}

const ENV = {
  dt: 0.5,
  flying: false,
  inWater: false,
  headInWater: false,
  onGround: true,
  velY: 0,
};

describe('生存数值 tick', () => {
  beforeEach(() => {
    survivalStats.exhaustion = 0;
  });

  it('掉落 4 格着地掉 1 点血（MC: floor(4-3)）', () => {
    const mem = makeMem();
    const dmg: number[] = [];
    // 先累计 4 格下落
    tickSurvival({ ...ENV, onGround: false, velY: -4 }, mem, { worldMode: 'survival', health: 20, hunger: 20, saturation: 5 }, { damagePlayer: (a) => dmg.push(a), setHealth: () => {}, setHunger: () => {}, setSaturation: () => {} });
    mem.fallDist = 4; // 直接置累计值验证结算
    tickSurvival({ ...ENV, onGround: true }, mem, { worldMode: 'survival', health: 20, hunger: 20, saturation: 5 }, { damagePlayer: (a) => dmg.push(a), setHealth: () => {}, setHunger: () => {}, setSaturation: () => {} });
    expect(dmg).toEqual([1]);
    expect(mem.fallDist).toBe(0);
  });

  it('创造模式跳过所有生存结算', () => {
    const mem = makeMem();
    mem.fallDist = 10;
    const dmg: number[] = [];
    tickSurvival(ENV, mem, { worldMode: 'creative', health: 20, hunger: 20, saturation: 5 }, { damagePlayer: (a) => dmg.push(a), setHealth: () => {}, setHunger: () => {}, setSaturation: () => {} });
    expect(dmg.length).toBe(0);
    expect(mem.fallDist).toBe(10); // 未触碰
  });

  it('溺水：15 秒氧气耗尽后每秒 2 点伤害', () => {
    const mem = makeMem();
    const dmg: number[] = [];
    const actions = { damagePlayer: (a: number) => dmg.push(a), setHealth: () => {}, setHunger: () => {}, setSaturation: () => {} };
    const s = { worldMode: 'survival', health: 20, hunger: 20, saturation: 5 };
    // 15 秒水下
    for (let i = 0; i < 29; i++) tickSurvival({ ...ENV, headInWater: true, onGround: false }, mem, s, actions);
    expect(dmg.length).toBe(0);
    tickSurvival({ ...ENV, headInWater: true, onGround: false }, mem, s, actions);
    expect(dmg).toEqual([2]);
    expect(mem.air).toBe(1);
  });

  it('消耗度满 4 先扣饱和度，耗尽后扣饥饿', () => {
    const mem = makeMem();
    const sat: number[] = [];
    const hun: number[] = [];
    const actions = {
      damagePlayer: () => {},
      setHealth: () => {},
      setHunger: (v: number) => hun.push(v),
      setSaturation: (v: number) => sat.push(v),
    };
    survivalStats.exhaustion = 4;
    tickSurvival(ENV, mem, { worldMode: 'survival', health: 20, hunger: 20, saturation: 2 }, actions);
    expect(sat).toEqual([1]);
    expect(survivalStats.exhaustion).toBe(0);
    // 饱和度 0 时扣饥饿
    survivalStats.exhaustion = 4;
    tickSurvival(ENV, mem, { worldMode: 'survival', health: 20, hunger: 20, saturation: 0 }, actions);
    expect(hun).toEqual([19]);
  });

  it('满饥饿且有饱和度时快速回血并消耗能量', () => {
    const mem = makeMem();
    const hp: number[] = [];
    const actions = { damagePlayer: () => {}, setHealth: (v: number) => hp.push(v), setHunger: () => {}, setSaturation: () => {} };
    tickSurvival({ ...ENV, dt: 0.6 }, mem, { worldMode: 'survival', health: 15, hunger: 20, saturation: 3 }, actions);
    expect(hp).toEqual([16]);
    expect(survivalStats.exhaustion).toBe(6);
  });

  it('resetSurvivalMem 重置全部记忆', () => {
    const mem = makeMem();
    mem.fallDist = 8;
    mem.air = 3;
    mem.regenTick = 2;
    resetSurvivalMem(mem);
    expect(mem).toEqual({ fallDist: 0, air: 15, regenTick: 0 });
  });
});
