// 末影龙战：柱顶水晶放置、击毁爆炸、水晶回血、龙三态 AI、击杀结算（龙蛋 + 返回门 + 经验）

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BLOCK_BY_KEY } from '../blocks';
import { createEndTerrain, endPillars } from '../end';
import { dragonState, endCrystals, hitCrystal, initEndFight, resetEndFight, tickCrystals } from '../endfight';
import { bossState } from '../game';
import { arrows, clearMobs, damageMob, makeEnderDragon, mobs, tickMobs } from '../mobs';
import { hashString } from '../noise';
import { loadDragonSlain } from '../persistence';
import { XP_MOB } from '../xp';
import { World } from '../world';

// IndexedDB 内存替身：persistence 的屠龙标记读写走这里（node 测试环境无 indexedDB）
vi.mock('idb', () => {
  const stores = new Map<string, Map<string, unknown>>();
  const store = (name: string): Map<string, unknown> => {
    let s = stores.get(name);
    if (!s) {
      s = new Map();
      stores.set(name, s);
    }
    return s;
  };
  return {
    openDB: async () => ({
      get: async (s: string, k: string) => store(s).get(k),
      put: async (s: string, v: unknown, k: string) => void store(s).set(k, v),
    }),
  };
});

const K = (k: string) => BLOCK_BY_KEY[k].id;

function endWorld(seed = 'fight-test'): World {
  return new World(seed, undefined, createEndTerrain(seed));
}

function setup(): World {
  clearMobs();
  resetEndFight();
  // 不预载 chunk：多数用例只读地形纯函数；需要方块的用例自行按需加载（cascadeLight 开销大）
  return endWorld();
}

beforeEach(() => {
  clearMobs();
  resetEndFight();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('末影水晶', () => {
  it('initEndFight：每根柱顶一颗水晶（10 颗）；已屠龙则不放', () => {
    const w = setup();
    initEndFight(w);
    expect(endCrystals).toHaveLength(10);
    const pillars = endPillars(hashString('fight-test'));
    for (let i = 0; i < 10; i++) {
      expect(endCrystals[i].x).toBe(pillars[i].x + 0.5);
      expect(endCrystals[i].y).toBe(pillars[i].top + 1.2);
      expect(endCrystals[i].alive).toBe(true);
    }
    dragonState.slain = true;
    initEndFight(w);
    expect(endCrystals).toHaveLength(0);
  });

  it('击毁水晶：爆炸伤害附近玩家并标记摧毁（MC 威力大于 TNT）', () => {
    const w = setup();
    initEndFight(w);
    const c = endCrystals[0];
    let dmg = 0;
    hitCrystal(c, w, { x: c.x + 1, y: c.y, z: c.z }, (d) => (dmg += d));
    expect(c.alive).toBe(false);
    expect(dmg).toBeGreaterThan(0);
    expect(endCrystals.filter((x) => x.alive)).toHaveLength(9);
  });

  it('龙在存活水晶 32 格内每 0.5s 回 1 血；水晶全灭不回血（MC 治疗光束）', () => {
    setup();
    endCrystals.push({ x: 0.5, y: 80, z: 0.5, alive: true });
    const dragon = { x: 10, y: 80, z: 0, hp: 100 };
    tickCrystals(dragon, 0.5);
    expect(dragon.hp).toBe(101);
    // 32 格外不回
    endCrystals[0].x = 100;
    tickCrystals(dragon, 0.5);
    expect(dragon.hp).toBe(101);
    // 全灭不回
    endCrystals[0].alive = false;
    tickCrystals(dragon, 0.5);
    expect(dragon.hp).toBe(101);
    // 满血不再回
    dragon.hp = 200;
    endCrystals[0].alive = true;
    endCrystals[0].x = 0.5;
    tickCrystals(dragon, 0.5);
    expect(dragon.hp).toBe(200);
  });
});

describe('末影龙 AI', () => {
  it('盘旋绕岛推进相位；俯冲锁定玩家冲撞造成伤害', () => {
    const w = setup();
    const dragon = makeEnderDragon(0.5, 84, 0.5);
    mobs.push(dragon);
    const player = { x: 20.5, y: 66, z: 0.5 };
    // 盘旋：相位角随时间推进
    const a0 = dragon.dragonAngle ?? 0;
    tickMobs(w, 0.5, player, () => undefined);
    expect(dragon.dragonAngle ?? 0).toBeGreaterThan(a0);
    // 强制进入俯冲：锁定玩家位置并冲撞（超时给足：盘旋轨道对侧距玩家可达 ~60 格，16/s 需 ~4s）
    dragon.dragonPhase = 'strafe';
    dragon.strafeX = player.x;
    dragon.strafeY = player.y + 1;
    dragon.strafeZ = player.z;
    dragon.phaseTimer = 5;
    let dmg = 0;
    for (let i = 0; i < 50 && dmg === 0; i++) tickMobs(w, 0.1, player, (d) => (dmg += d));
    expect(dmg).toBe(8); // 冲撞 8 伤（MC 龙撞击）
  });

  it('栖息祭坛喷龙息：10 格内玩家每秒 3 点 DOT', () => {
    const w = setup();
    const dragon = makeEnderDragon(0.5, 70, 0.5);
    dragon.dragonPhase = 'perch';
    dragon.phaseTimer = 4;
    mobs.push(dragon);
    const ay = w.terrain.heightAt(0, 0);
    const player = { x: 3.5, y: ay + 2, z: 0.5 }; // 祭坛边
    let dmg = 0;
    for (let i = 0; i < 20; i++) tickMobs(w, 0.1, player, (d) => (dmg += d));
    expect(dmg).toBeGreaterThanOrEqual(3);
    // 栖息结束回盘旋
    for (let i = 0; i < 30; i++) tickMobs(w, 0.2, { x: 60.5, y: 66, z: 60.5 }, () => undefined);
    expect(dragon.dragonPhase).toBe('circle');
  });

  it('Boss 血条：龙存活时上报（名字/血量）', () => {
    const w = setup();
    const dragon = makeEnderDragon(0.5, 84, 0.5);
    mobs.push(dragon);
    bossState.name = '';
    tickMobs(w, 0.1, { x: 0.5, y: 66, z: 0.5 }, () => undefined);
    expect(bossState.name).toBe('末影龙');
    expect(bossState.hp).toBe(200);
    expect(bossState.max).toBe(200);
    bossState.name = '';
  });
});

describe('击杀结算', () => {
  it('damageMob 杀龙：标记屠龙、水晶清空、祭坛 3×3 返回门 + 柱顶龙蛋、500 经验', () => {
    const w = setup();
    initEndFight(w);
    const dragon = makeEnderDragon(0.5, 84, 0.5);
    mobs.push(dragon);
    expect(XP_MOB.ender_dragon).toBe(500);
    const killed = damageMob(dragon, 999, undefined, 0, w);
    expect(killed).toBe(true);
    expect(dragonState.slain).toBe(true);
    expect(endCrystals).toHaveLength(0);
    expect(mobs.some((m) => m.type === 'ender_dragon')).toBe(false);
    const ay = w.terrain.heightAt(0, 0);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) expect(w.getBlock(dx, ay + 1, dz)).toBe(K('end_portal'));
    }
    expect(w.getBlock(0, ay + 3, 0)).toBe(K('dragon_egg'));
  });

  it('玩家箭命中水晶即爆（MC 远程击毁标准打法）', () => {
    const w = setup();
    initEndFight(w);
    const c = endCrystals[0];
    // 箭路径经过的 chunk 需已加载（未加载则箭被移除）；柱在 (42,0) 附近 → chunk (2,0) 周边
    const ccx = Math.floor(c.x / 16);
    const ccz = Math.floor(c.z / 16);
    for (let cx = ccx - 1; cx <= ccx + 1; cx++) for (let cz = ccz - 1; cz <= ccz + 1; cz++) w.getChunk(cx, cz);
    // 玩家从柱侧朝水晶水平射箭
    arrows.push({ id: 999, x: c.x - 3, y: c.y, z: c.z, vx: 15, vy: 0, vz: 0, age: 0, fromPlayer: true });
    tickMobs(w, 0.1, { x: c.x - 3, y: c.y, z: c.z }, () => undefined);
    tickMobs(w, 0.1, { x: c.x - 3, y: c.y, z: c.z }, () => undefined);
    expect(c.alive).toBe(false);
  });
});

describe('屠龙标记持久化', () => {
  it('杀龙写入存档；模拟刷新后 initEndFight 恢复：不放水晶、移除误生成的龙', async () => {
    // 独立种子：不与本文件其他用例共享存档键
    const w = endWorld('persist-test');
    void initEndFight(w); // 注册击杀回调（全局一次性）
    mobs.push(makeEnderDragon(0.5, 84, 0.5));
    expect(damageMob(mobs[mobs.length - 1], 999, undefined, 0, w)).toBe(true);
    expect(dragonState.slain).toBe(true);
    // 存档写入落定（onDragonKilled 内 fire-and-forget，这里等它写完）
    await vi.waitFor(async () => expect(await loadDragonSlain('persist-test')).toBe(true));
    // 模拟页面刷新 + 重进末地：内存态清空；World.tsx 流程在恢复完成前同步生成龙
    resetEndFight();
    const restored = initEndFight(w);
    if (!dragonState.slain) mobs.push(makeEnderDragon(0.5, 84, 0.5));
    expect(mobs.some((m) => m.type === 'ender_dragon')).toBe(true); // 恢复前的误生成
    await restored;
    expect(dragonState.slain).toBe(true);
    expect(endCrystals).toHaveLength(0);
    expect(mobs.some((m) => m.type === 'ender_dragon')).toBe(false);
  });
});
