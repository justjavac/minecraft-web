// 下界堡垒与堡垒生物：结构生成、刷怪分布、烈焰人悬浮与火球、凋灵骷髅凋零 DOT

import { beforeEach, describe, expect, it } from 'vitest';
import { BLOCK_BY_KEY } from '../blocks';
import { survivalStats } from '../game';
import { clearMobs, MOB_DEFS, mobs, tickMobs, trySpawn } from '../mobs';
import { createNetherTerrain } from '../nether';
import { applyNetherStructures, fortressAt, fortressNear } from '../netherstructures';
import { hashString, VOID_TERRAIN, type Terrain } from '../noise';
import { clearStorages, getStorage } from '../storage';
import { tickSurvival, type SurvivalMem } from '../survival';
import { CHUNK_VOLUME, World } from '../world';

const K = (k: string) => BLOCK_BY_KEY[k].id;

function findFortress(seedHash: number, t: Terrain): { x: number; y: number; z: number } {
  for (let rx = 0; rx < 40; rx++) {
    for (let rz = 0; rz < 40; rz++) {
      const f = fortressAt(seedHash, t, rx, rz);
      if (f) return f;
    }
  }
  throw new Error('未找到堡垒');
}

beforeEach(() => {
  clearMobs();
  clearStorages();
  survivalStats.wither = 0;
  survivalStats.exhaustion = 0;
});

describe('下界堡垒', () => {
  it('桥廊 + 塔楼 + 地狱疣园 + 宝箱（战利品预填）', () => {
    const t = createNetherTerrain('fortress-test');
    const sh = hashString('fortress-test');
    const f = findFortress(sh, t);
    const ccx = Math.floor(f.x / 16);
    const ccz = Math.floor(f.z / 16);
    const data = new Uint16Array(CHUNK_VOLUME);
    for (let cx = ccx - 1; cx <= ccx + 1; cx++) for (let cz = ccz - 1; cz <= ccz + 1; cz++) applyNetherStructures(sh, t, cx, cz, data);
    const found = new Set<number>();
    for (const v of data) found.add(v);
    expect(found.has(K('nether_bricks'))).toBe(true);
    expect(found.has(K('soul_sand'))).toBe(true);
    expect(found.has(K('nether_wart'))).toBe(true);
    expect(found.has(K('chest'))).toBe(true);
    const loot = getStorage(`${f.x + 3},${f.y + 1},${f.z - 3}`);
    expect(loot.some((s) => s !== null)).toBe(true);
  });

  it('fortressNear 判定：堡垒附近为真，远处为假', () => {
    const t = createNetherTerrain('fortress-test');
    const sh = hashString('fortress-test');
    const f = findFortress(sh, t);
    expect(fortressNear(sh, t, f.x, f.z, 48)).toBe(true);
    expect(fortressNear(sh, t, f.x + 300, f.z + 300, 48)).toBe(false);
  });
});

describe('堡垒生物', () => {
  const mkMob = (type: 'blaze' | 'wither_skeleton', x: number, y: number, z: number) => ({
    id: Math.random(), type, x, y, z,
    velY: 0, hp: 20, attackCd: 0, onGround: true,
    wanderDir: 0, wanderTimer: 0, wanderMoving: false,
    fleeTimer: 0, fleeFromX: 0, fleeFromZ: 0, arrowCd: 0, ignite: -1,
  });

  function netherWorld(): World {
    const w = new World('fort-mob', undefined, createNetherTerrain('fort-mob'));
    for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) w.getChunk(cx, cz);
    return w;
  }

  function voidWorld(): World {
    const w = new World('fort-void', undefined, VOID_TERRAIN);
    for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) w.getChunk(cx, cz);
    return w;
  }

  it('堡垒附近刷怪以凋灵骷髅/烈焰人为主（远处为猪灵/烈焰人）', () => {
    const t = createNetherTerrain('fort-mob');
    const sh = hashString('fort-mob');
    const f = findFortress(sh, t);
    const w = new World('fort-mob', undefined, t);
    // 堡垒位置预载
    for (let cx = (f.x >> 4) - 2; cx <= (f.x >> 4) + 2; cx++) for (let cz = (f.z >> 4) - 2; cz <= (f.z >> 4) + 2; cz++) w.getChunk(cx, cz);
    const types = new Set<string>();
    for (let i = 0; i < 60 && types.size < 2; i++) {
      trySpawn(w, f.x, f.z);
    }
    for (const m of mobs) types.add(m.type);
    expect([...types].every((t2) => t2 === 'wither_skeleton' || t2 === 'blaze' || t2 === 'zombified_piglin')).toBe(true);
    expect(types.has('wither_skeleton') || types.has('blaze')).toBe(true);
  });

  it('烈焰人悬浮（无重力下坠）并射出火球', () => {
    const w = voidWorld(); // 虚空世界：火球弹道无遮挡
    const player = { x: 8.5, y: 60, z: 8.5 };
    mobs.push(mkMob('blaze', 18.5, 60, 8.5)); // 10 格外（射程 14 内）
    const y0 = mobs[0].y;
    let hits = 0;
    for (let i = 0; i < 100; i++) tickMobs(w, 0.1, player, () => hits++);
    // 悬浮：y 在初值附近 ±2（起伏而非坠落）
    expect(Math.abs(mobs[0].y - y0)).toBeLessThan(2);
    expect(hits).toBeGreaterThan(0); // 火球命中过玩家
  });

  it('凋灵骷髅命中附加凋零 DOT（5 秒每秒 1 点）', () => {
    const w = netherWorld();
    const player = { x: 8.5, y: 60, z: 8.5 };
    mobs.push(mkMob('wither_skeleton', 9.5, 60, 8.5));
    let dmg = 0;
    for (let i = 0; i < 40 && survivalStats.wither === 0; i++) tickMobs(w, 0.1, player, () => dmg++);
    expect(survivalStats.wither).toBeGreaterThan(0); // 命中上了凋零
    expect(dmg).toBeGreaterThan(0);
    // DOT 结算：5 秒内持续掉血
    const mem: SurvivalMem = { fallDist: 0, air: 15, regenTick: 0, witherTick: 0 };
    let dot = 0;
    const s = { worldMode: 'survival', health: 20, hunger: 20, saturation: 20 };
    const w0 = survivalStats.wither;
    for (let i = 0; i < 30; i++) {
      tickSurvival({ dt: 0.2, onGround: true, inWater: false, headInWater: false, flying: false, velY: 0 }, mem, s, {
        damagePlayer: () => dot++,
        setHealth: () => undefined,
        setHunger: () => undefined,
        setSaturation: () => undefined,
      });
    }
    expect(dot).toBeGreaterThanOrEqual(Math.floor(w0));
  });

  it('烈焰人掉烈焰棒（defs 校验）', () => {
    expect(MOB_DEFS.blaze.drops.some((d) => d.material === 'blaze_rod')).toBe(true);
  });
});

describe('堡垒生成确定性', () => {
  it('同参数堡垒位置一致', () => {
    const t = createNetherTerrain('det-fort');
    const sh = hashString('det-fort');
    expect(fortressAt(sh, t, 3, 4)).toEqual(fortressAt(sh, t, 3, 4));
  });
});
