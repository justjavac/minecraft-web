// 凋灵：T 形召唤、Boss 弹幕（爆炸 + 凋零 DOT）、半血箭免、破坏方块、Boss 血条、下界之星

import { beforeEach, describe, expect, it } from 'vitest';
import { AIR, BLOCK_BY_KEY, STONE, WATER } from '../blocks';
import { bossState, survivalStats } from '../game';
import { clearDrops, itemDrops } from '../items';
import { arrows, clearMobs, damageMob, MOB_DEFS, mobs, tickMobs } from '../mobs';
import { VOID_TERRAIN } from '../noise';
import { trySummonWither } from '../wither';
import { World } from '../world';

const K = (k: string) => BLOCK_BY_KEY[k].id;
const SOUL = () => K('soul_sand');
const SKULL = () => K('wither_skeleton_skull');

function setup(): World {
  clearMobs();
  clearDrops();
  survivalStats.wither = 0;
  bossState.name = '';
  const w = new World('wither-test', undefined, VOID_TERRAIN);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) w.getChunk(cx, cz);
  return w;
}

/** 搭 T 形：顶行 3 灵魂沙 + 3 头骨（沿 x），中列向下 2 灵魂沙 */
function buildT(w: World, ox: number, oz: number): void {
  for (let a = 0; a < 3; a++) {
    w.setBlock(ox + a, 41, oz, SOUL());
    w.setBlock(ox + a, 42, oz, SKULL());
  }
  w.setBlock(ox + 1, 40, oz, SOUL());
  w.setBlock(ox + 1, 39, oz, SOUL());
}

beforeEach(() => {
  clearMobs();
  clearDrops();
  survivalStats.wither = 0;
  bossState.name = '';
});

describe('T 形召唤', () => {
  it('灵魂沙 T + 三头骨：消耗方块并生成凋灵（满血激怒）', () => {
    const w = setup();
    buildT(w, 4, 4);
    expect(trySummonWither(w, 5, 42, 4, () => undefined)).toBe(true);
    // 方块被消耗
    expect(w.getBlock(4, 41, 4)).toBe(AIR);
    expect(w.getBlock(5, 42, 4)).toBe(AIR);
    expect(w.getBlock(5, 40, 4)).toBe(AIR);
    expect(w.getBlock(5, 39, 4)).toBe(AIR);
    expect(mobs.length).toBe(1);
    expect(mobs[0].type).toBe('wither');
    expect(mobs[0].hp).toBe(300);
    expect(bossState.name).toBe('凋灵');
    expect(bossState.hp).toBe(300);
  });

  it('沿 z 的 T 形同样成立；缺一块则失败', () => {
    const w = setup();
    for (let a = 0; a < 3; a++) {
      w.setBlock(8, 41, 4 + a, SOUL());
      w.setBlock(8, 42, 4 + a, SKULL());
    }
    w.setBlock(8, 40, 5, SOUL());
    w.setBlock(8, 39, 5, SOUL());
    expect(trySummonWither(w, 8, 42, 5, () => undefined)).toBe(true);
    expect(mobs.length).toBe(1);
    // 缺一个头骨
    const w2 = setup();
    buildT(w2, 4, 4);
    w2.setBlock(5, 42, 4, AIR);
    expect(trySummonWither(w2, 5, 42, 4, () => undefined)).toBe(false);
    expect(mobs.length).toBe(0);
  });
});

describe('凋灵战斗', () => {
  const mkWither = (x: number, y: number, z: number) => ({
    id: Math.random(), type: 'wither' as const, x, y, z,
    velY: 0, hp: 300, attackCd: 0, onGround: false,
    wanderDir: 0, wanderTimer: 0, wanderMoving: false,
    fleeTimer: 0, fleeFromX: 0, fleeFromZ: 0, arrowCd: 0, ignite: -1,
    aggroTimer: Number.MAX_SAFE_INTEGER,
  });

  it('悬浮不坠，弹幕射凋灵骷髅弹（爆炸 + 玩家凋零 DOT）', () => {
    const w = setup();
    const player = { x: 8.5, y: 60, z: 8.5 };
    mobs.push(mkWither(18.5, 62, 8.5));
    const y0 = mobs[0].y;
    let dmg = 0;
    for (let i = 0; i < 60; i++) tickMobs(w, 0.1, player, (d) => (dmg += d));
    expect(Math.abs(mobs[0].y - y0)).toBeLessThan(2);
    expect(dmg).toBeGreaterThan(0); // 弹幕命中过
    expect(survivalStats.wither).toBeGreaterThan(0); // 凋零 DOT 已上
  });

  it('半血以下免疫箭矢（MC）', () => {
    const w = setup();
    mobs.push(mkWither(12.5, 60, 8.5));
    mobs[0].hp = 100; // < 150
    // 玩家箭从左侧迎头射向凋灵（避免离散步进错身）
    arrows.push({ id: 1, x: 6, y: 61, z: 8.5, vx: 10, vy: 0, vz: 0, age: 0, fromPlayer: true });
    for (let i = 0; i < 10; i++) tickMobs(w, 0.1, { x: 8.5, y: 60, z: 8.5 }, () => undefined);
    expect(mobs[0].hp).toBe(100); // 箭免：不掉血
    // 半血以上则正常掉血
    mobs[0].hp = 200;
    arrows.push({ id: 2, x: 6, y: 61, z: 8.5, vx: 10, vy: 0, vz: 0, age: 0, fromPlayer: true });
    for (let i = 0; i < 10; i++) tickMobs(w, 0.1, { x: 8.5, y: 60, z: 8.5 }, () => undefined);
    expect(mobs[0].hp).toBeLessThan(200);
  });

  it('每 4s 粉碎周围方块（防爆除外）', () => {
    const w = setup();
    mobs.push(mkWither(8.5, 40, 8.5));
    mobs[0].smashTimer = 0.01;
    w.setBlock(8, 40, 8, STONE);
    w.setBlock(9, 40, 8, K('obsidian')); // 防爆
    w.setBlock(7, 40, 8, WATER); // 流体免疫
    for (let i = 0; i < 5; i++) tickMobs(w, 0.1, { x: 20, y: 60, z: 20 }, () => undefined);
    expect(w.getBlock(8, 40, 8)).toBe(AIR);
    expect(w.getBlock(9, 40, 8)).toBe(K('obsidian'));
    expect(w.getBlock(7, 40, 8)).toBe(WATER);
  });

  it('击杀掉下界之星（defs 校验 + damageMob 掉落实体）', () => {
    expect(MOB_DEFS.wither.drops.some((d) => d.material === 'nether_star' && d.count[0] === 1)).toBe(true);
    const w = setup();
    void w;
    mobs.push(mkWither(8.5, 40, 8.5));
    damageMob(mobs[0], 300, { x: 0, z: 0 }, 0, w);
    expect(itemDrops.some((d) => d.drop.kind === 'material' && d.drop.material === 'nether_star')).toBe(true);
    expect(mobs.length).toBe(0);
  });
});
