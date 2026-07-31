// 闪电实体（MC Java）：概率折算、命中伤害范围、生物转化规则、视听状态

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BLOCK_BY_KEY } from '../blocks';
import {
  bolts,
  clearLightning,
  LIGHTNING_CHANCE_PER_CHUNK_TICK,
  strikeChancePerBeat,
  STRIKE_DAMAGE,
  strikeLightning,
  tickLightning,
} from '../lightning';
import { clearDrops } from '../items';
import { clearMobs, mobs, spawnMobAt } from '../mobs';
import { VOID_TERRAIN } from '../noise';
import { clearWeather, weather } from '../weather';
import { World } from '../world';

beforeEach(() => {
  clearMobs();
  clearDrops();
  clearLightning();
});

afterEach(() => {
  clearWeather(); // 复原天气，避免污染其他测试文件的全局状态
  clearMobs();
  clearDrops();
  clearLightning();
});

describe('落雷概率（MC：每 tick 每 chunk 1/100000，按拍折算）', () => {
  it('边界：0 chunk 概率为 0；随 chunk 数线性放大；巨量 chunk 截断到 1', () => {
    expect(strikeChancePerBeat(0)).toBe(0);
    expect(strikeChancePerBeat(-5)).toBe(0);
    // 1 chunk × 8 tick（0.4s 拍）= 8/100000
    expect(strikeChancePerBeat(1)).toBeCloseTo(LIGHTNING_CHANCE_PER_CHUNK_TICK * 8, 12);
    expect(strikeChancePerBeat(100)).toBeCloseTo(LIGHTNING_CHANCE_PER_CHUNK_TICK * 800, 12);
    expect(strikeChancePerBeat(100)).toBeLessThan(0.01); // 百 chunk 一拍也不到 1%
    expect(strikeChancePerBeat(1e9)).toBe(1); // 截断
  });
});

describe('命中伤害范围（3 格内 5 点伤害）', () => {
  it('3 格内生物受 5 点伤害，3 格外不受影响', () => {
    const w = new World('bolt-dmg', undefined, VOID_TERRAIN);
    const near = spawnMobAt('zombie', 10.5, 20, 10.5); // 距命中点 0
    const edge = spawnMobAt('zombie', 13.5, 20, 10.5); // 距 3.0：恰在范围内
    const far = spawnMobAt('zombie', 14.1, 20, 10.5); // 距 3.6：范围外
    const high = spawnMobAt('zombie', 10.5, 24.1, 10.5); // 垂直 4.1：范围外
    strikeLightning(w, 10.5, 20, 10.5);
    expect(near.hp).toBe(20 - STRIKE_DAMAGE);
    expect(edge.hp).toBe(20 - STRIKE_DAMAGE);
    expect(far.hp).toBe(20);
    expect(high.hp).toBe(20);
  });

  it('低血生物被雷击杀（掉落物结算走通用 damageMob）', () => {
    const w = new World('bolt-kill', undefined, VOID_TERRAIN);
    const m = spawnMobAt('cow', 10.5, 20, 10.5);
    m.hp = 3;
    strikeLightning(w, 10.5, 20, 10.5);
    expect(mobs.includes(m)).toBe(false);
  });
});

describe('命中转化（MC：转化优先于伤害）', () => {
  it('苦力怕 → 充能苦力怕（不掉血，且不重复充能）', () => {
    const w = new World('bolt-charge', undefined, VOID_TERRAIN);
    const c = spawnMobAt('creeper', 10.5, 20, 10.5);
    strikeLightning(w, 10.5, 20, 10.5);
    expect(c.powered).toBe(true);
    expect(c.hp).toBe(20); // 转化替代伤害
    strikeLightning(w, 10.5, 20, 10.5); // 已充能：第二次按普通生物吃伤害
    expect(c.hp).toBe(20 - STRIKE_DAMAGE);
  });

  it('猪 → 僵尸猪灵（满血新生，继承位置；原猪移除）', () => {
    const w = new World('bolt-pig', undefined, VOID_TERRAIN);
    const pig = spawnMobAt('pig', 10.5, 20, 10.5);
    const affected = strikeLightning(w, 10.5, 20, 10.5);
    expect(mobs.includes(pig)).toBe(false);
    expect(affected).toHaveLength(1);
    const zp = affected[0];
    expect(zp.type).toBe('zombified_piglin');
    expect(zp.hp).toBe(20);
    expect(zp.x).toBeCloseTo(10.5);
    expect(zp.z).toBeCloseTo(10.5);
    expect(mobs.includes(zp)).toBe(true);
  });

  it('村民：无女巫类型可转化（见 lightning.ts 注释），按普通生物吃 5 点伤害', () => {
    const w = new World('bolt-villager', undefined, VOID_TERRAIN);
    const v = spawnMobAt('villager', 10.5, 20, 10.5);
    strikeLightning(w, 10.5, 20, 10.5);
    expect(v.type).toBe('villager');
    expect(v.hp).toBe(20 - STRIKE_DAMAGE);
  });
});

describe('落雷驱动（雷暴 + 降雨区 + 概率门控）', () => {
  /** 有一格石头地表的空世界（落点选在地表） */
  function strikeWorld(): World {
    const w = new World('bolt-tick', undefined, VOID_TERRAIN);
    w.getChunk(0, 0); // 确保 chunk 已加载
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) w.setBlock(x, 20, z, BLOCK_BY_KEY.stone.id);
    }
    return w;
  }

  it('非雷暴不落雷；雷暴 + rand 必中时落雷：flash、bolt、命中结算、雷声范围内玩家受伤', () => {
    const w = strikeWorld();
    const playerPos = { x: 8.5, y: 21, z: 8.5 };
    const zombie = spawnMobAt('zombie', 7.5, 21, 8.5); // 预定落点 (6.5,21,8.5) 的 1 格外
    let playerDmg = 0;
    // 非雷暴：即使 rand 必中也不落
    weather.kind = 'rain';
    for (let i = 0; i < 10; i++) tickLightning(w, 0.4, playerPos, (d) => (playerDmg += d), () => 0);
    expect(bolts.length).toBe(0);
    expect(zombie.hp).toBe(20);
    expect(playerDmg).toBe(0);
    // 雷暴 + 受控 rand：概率必中；选点 ang=π、r=2 → 玩家西侧 2 格的降雨地表
    weather.kind = 'thunder';
    const seq = [0, 0.5, 0]; // 概率掷点、角度、半径；后续（bolt 抖动）落到序列末值 0
    let si = 0;
    const rand = (): number => seq[Math.min(si++, seq.length - 1)];
    tickLightning(w, 0.4, playerPos, (d) => (playerDmg += d), rand);
    expect(bolts.length).toBe(1);
    expect(bolts[0].x).toBeCloseTo(6.5);
    expect(bolts[0].y).toBe(21); // 地表石头（y=20）顶面
    expect(weather.flash).toBe(1);
    expect(zombie.hp).toBe(20 - STRIKE_DAMAGE); // 命中点 3 格内
    expect(playerDmg).toBe(STRIKE_DAMAGE); // 玩家在命中范围内同样受伤（MC）
    // bolt 存活 ~0.2s 后消散
    for (let i = 0; i < 10; i++) tickLightning(w, 0.05, playerPos, undefined, () => 0.999);
    expect(bolts.length).toBe(0);
  });

  it('rand 不中时不落雷', () => {
    const w = strikeWorld();
    weather.kind = 'thunder';
    for (let i = 0; i < 10; i++) tickLightning(w, 0.4, { x: 8.5, y: 21, z: 8.5 }, undefined, () => 0.999999);
    expect(bolts.length).toBe(0);
  });
});
