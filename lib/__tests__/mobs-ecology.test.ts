// 生物生态（MC 规则）：距离消失、洞穴刷怪与亮度门控、史莱姆区块、幻翼（失眠惩罚）、
// 铁傀儡（村庄守卫）、生物摔落伤害、鸡下蛋、掉落表修正、末影之眼飞行距离、烈焰人三连发

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STONE } from '../blocks';
import { worldClock } from '../game';
import { clearDrops, itemDrops } from '../items';
import {
  arrows,
  clearMobs,
  damageMob,
  fireEyeOfEnder,
  isSlimeChunk,
  MOB_DEFS,
  mobs,
  phantomState,
  spawnLightAt,
  spawnMobAt,
  tickMobs,
  trySpawn,
  type Mob,
  type MobType,
} from '../mobs';
import { createTerrain, hashString, VOID_TERRAIN, type Terrain } from '../noise';
import { structureAt } from '../structures';
import { emptySlots } from '../slots';
import { useGameStore } from '../store';
import { weather } from '../weather';
import { World } from '../world';

/** 构造测试生物（hp 默认取物种定义值） */
function mkMob(partial: Partial<Mob> & { type: MobType; x: number; y: number; z: number }): Mob {
  return {
    id: Math.random(),
    velY: 0,
    hp: MOB_DEFS[partial.type].hp,
    attackCd: 0,
    onGround: true,
    wanderDir: 0,
    wanderTimer: 0,
    wanderMoving: false,
    fleeTimer: 0,
    fleeFromX: 0,
    fleeFromZ: 0,
    arrowCd: 1,
    ignite: -1,
    ...partial,
  };
}

/** 石板地面（y=40）的虚空测试世界 */
function floorWorld(size = 32): World {
  const w = new World('ecology', undefined, VOID_TERRAIN);
  for (let x = -size; x < size; x++) for (let z = -size; z < size; z++) w.setBlock(x, 40, z, STONE);
  return w;
}

/** 海洋群系虚空（排除村庄/结构对刷怪测试的干扰） */
const OCEAN_VOID: Terrain = { ...VOID_TERRAIN, biomeAt: () => 'ocean' };

/** 洞穴世界：y=10 洞底 + y=40 封顶（洞穴层只有 y=10 可站：11/12 为空气） */
function caveWorld(seed: string): World {
  const w = new World(seed, undefined, OCEAN_VOID);
  for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) w.getChunk(cx, cz);
  for (let x = -48; x < 64; x++) {
    for (let z = -48; z < 64; z++) {
      w.setBlock(x, 10, z, STONE);
      w.setBlock(x, 40, z, STONE);
    }
  }
  // 封闭洞穴无自然光：显式置零（setBlock 的光照重算是异步的，测试里不等它；不依赖史莱姆区块运气）
  for (const c of w.chunks.values()) {
    c.sky.fill(0);
    c.light.fill(0);
  }
  return w;
}

/** 全部 chunk 方块光填充为 v（模拟白昼照明/灯火） */
function fillLight(w: World, v: number): void {
  for (const c of w.chunks.values()) c.light.fill(v);
}

function slimeChunksInRange(sh: number): number {
  let n = 0;
  for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) if (isSlimeChunk(sh, cx, cz)) n++;
  return n;
}

function seedScan(pred: (sh: number) => boolean): string {
  for (let i = 0; ; i++) {
    const s = `cave-seed-${i}`;
    if (pred(hashString(s))) return s;
  }
}

/** 刷怪环带（chunk -3..3）内无史莱姆区块的种子 / 含 ≥2 个的种子 */
const NO_SLIME_SEED = seedScan((sh) => slimeChunksInRange(sh) === 0);
const WITH_SLIME_SEED = seedScan((sh) => slimeChunksInRange(sh) >= 2);

const player = { x: 8.5, y: 41, z: 8.5 };

beforeEach(() => {
  clearMobs();
  clearDrops();
  phantomState.insomniaDays = 0;
  phantomState.timer = 0;
  worldClock.t = 0.3;
  weather.kind = 'clear';
  useGameStore.setState({ worldMode: 'survival', xpTotal: 0, hotbarSlots: emptySlots(), selectedSlot: 0 });
});

describe('距离消失（despawn）', () => {
  it('敌对生物距玩家 >64 格立即消失', () => {
    const w = floorWorld(8);
    mobs.push(mkMob({ type: 'zombie', x: 100.5, y: 41, z: 8.5 }));
    tickMobs(w, 0.1, player, () => undefined);
    expect(mobs).toHaveLength(0);
  });

  it('32-64 格：短暂远离不消失，计时耗尽才消失（MC 随机刻简版）', () => {
    const w = floorWorld(8);
    const z = mkMob({ type: 'zombie', x: 48.5, y: 41, z: 8.5 }); // 距玩家 40 格
    mobs.push(z);
    for (let i = 0; i < 10; i++) tickMobs(w, 0.1, player, () => undefined);
    expect(mobs).toHaveLength(1); // 计时器 20-40s，1s 不会消失
    z.despawnTimer = 0.05;
    tickMobs(w, 0.1, player, () => undefined);
    expect(mobs).toHaveLength(0); // 计时耗尽消失
  });

  it('被动生物、驯服狼、铁傀儡、Boss 不消失', () => {
    const w = floorWorld(8);
    mobs.push(mkMob({ type: 'pig', x: 100.5, y: 41, z: 8.5 }));
    mobs.push(mkMob({ type: 'villager', x: 100.5, y: 41, z: 10.5 }));
    mobs.push(mkMob({ type: 'wolf', x: 48.5, y: 41, z: 8.5, tamed: true, despawnTimer: 0.01 }));
    mobs.push(mkMob({ type: 'iron_golem', x: 48.5, y: 41, z: 12.5, despawnTimer: 0.01 }));
    mobs.push(mkMob({ type: 'wither', x: 48.5, y: 60, z: 20.5, despawnTimer: 0.01 }));
    tickMobs(w, 0.1, player, () => undefined);
    expect(mobs).toHaveLength(5); // 全部存活
  });
});

describe('刷怪亮度门控与洞穴刷怪', () => {
  it('spawnLightAt：天空光按昼夜折算，方块光不变', () => {
    const w = floorWorld();
    const c = w.chunks.get('0,0')!;
    c.sky.fill(15);
    worldClock.t = 0.25; // 正午
    expect(spawnLightAt(w, 8, 41, 8)).toBe(15);
    worldClock.t = 0.75; // 午夜（昼夜系数 0）
    expect(spawnLightAt(w, 8, 41, 8)).toBe(0);
    c.light.fill(10);
    expect(spawnLightAt(w, 8, 41, 8)).toBe(10); // 方块光不受昼夜影响
  });

  it('白天可在黑暗洞穴刷敌对生物（MC：洞穴恒暗）', { timeout: 20000 }, () => {
    const w = caveWorld('cave-day');
    worldClock.t = 0.25; // 正午
    let ok = false;
    for (let i = 0; i < 60 && !ok; i++) ok = trySpawn(w, 8, 8);
    expect(ok).toBe(true);
    for (const m of mobs) {
      expect(MOB_DEFS[m.type].hostile).toBe(true);
      expect(m.y).toBe(11); // 洞底 y=10 之上
    }
  });

  it('亮度 >7 的洞穴白天不刷（亮度门控）', () => {
    const w = caveWorld(NO_SLIME_SEED);
    fillLight(w, 15);
    worldClock.t = 0.25;
    for (let i = 0; i < 20; i++) expect(trySpawn(w, 8, 8)).toBe(false);
    expect(mobs).toHaveLength(0);
  });

  it('夜晚地表可刷敌对（深夜露天 ≈0），点亮后不再刷', { timeout: 20000 }, () => {
    const w = caveWorld(NO_SLIME_SEED);
    worldClock.t = 0.75; // 午夜
    // 等地表（y=41）刷出敌对；洞穴刷（y=11）清掉不等
    let ok = false;
    for (let i = 0; i < 60 && !ok; i++) {
      trySpawn(w, 8, 8);
      ok = mobs.some((m) => MOB_DEFS[m.type].hostile && m.y === 41);
      if (!ok) clearMobs();
    }
    expect(ok).toBe(true); // 封顶 y=40 之上一格
    // 全场点亮 15：夜晚也不再刷
    clearMobs();
    fillLight(w, 15);
    for (let i = 0; i < 20; i++) expect(trySpawn(w, 8, 8)).toBe(false);
    expect(mobs).toHaveLength(0);
  });
});

describe('史莱姆区块', () => {
  it('哈希确定性 + 约 1/10 区块占比', () => {
    const sh = hashString('slime-chunk-rate');
    expect(isSlimeChunk(sh, 3, 4)).toBe(isSlimeChunk(sh, 3, 4)); // 同参数同结果
    let n = 0;
    for (let cx = 0; cx < 20; cx++) for (let cz = 0; cz < 20; cz++) if (isSlimeChunk(sh, cx, cz)) n++;
    expect(n).toBeGreaterThan(20); // 400 区块期望 40（10%）
    expect(n).toBeLessThan(70);
  });

  it('史莱姆区块内 y<40 无视亮度刷史莱姆（MC）', { timeout: 20000 }, () => {
    const w = caveWorld(WITH_SLIME_SEED);
    fillLight(w, 15); // 全场点亮：普通洞穴刷怪被门控，只剩史莱姆区块
    worldClock.t = 0.25;
    for (let i = 0; i < 600 && mobs.length === 0; i++) trySpawn(w, 8, 8);
    expect(mobs.length).toBeGreaterThan(0);
    for (const m of mobs) {
      expect(m.type).toBe('slime');
      expect(m.y).toBe(11); // y<40
      expect(isSlimeChunk(w.seedHash, Math.floor(m.x) >> 4, Math.floor(m.z) >> 4)).toBe(true);
    }
  });
});

describe('幻翼（失眠惩罚）', () => {
  it('defs：HP 20、伤害 4、白天自燃、掉 0-1 羽毛', () => {
    expect(MOB_DEFS.phantom.hp).toBe(20);
    expect(MOB_DEFS.phantom.damage).toBe(4);
    expect(MOB_DEFS.phantom.burnsAtDay).toBe(true);
    expect(MOB_DEFS.phantom.drops).toContainEqual({ material: 'feather', count: [0, 1] });
  });

  it('失眠计时：自然跨日 +1，睡觉（时钟回拨日出）清零', () => {
    const w = floorWorld();
    worldClock.t = 0.95;
    tickMobs(w, 0.1, player, () => undefined); // 基准时刻 0.95
    worldClock.t = 0.02;
    tickMobs(w, 0.1, player, () => undefined); // 自然跨日（绕回）
    expect(phantomState.insomniaDays).toBe(1);
    worldClock.t = 0.7;
    tickMobs(w, 0.1, player, () => undefined); // 入夜，无变化
    expect(phantomState.insomniaDays).toBe(1);
    worldClock.t = 0;
    tickMobs(w, 0.1, player, () => undefined); // 睡觉回拨到日出
    expect(phantomState.insomniaDays).toBe(0);
  });

  it('失眠 ≥3 天的夜晚：头顶高空刷 1-3 只幻翼', () => {
    const w = floorWorld();
    phantomState.insomniaDays = 3;
    worldClock.t = 0.75;
    tickMobs(w, 0.1, player, () => undefined);
    const ps = mobs.filter((m) => m.type === 'phantom');
    expect(ps.length).toBeGreaterThanOrEqual(1);
    expect(ps.length).toBeLessThanOrEqual(3);
    for (const p of ps) {
      expect(p.y).toBeGreaterThanOrEqual(player.y + 19);
      expect(p.y).toBeLessThanOrEqual(player.y + 27);
    }
  });

  it('失眠 <3 天不刷；白天不刷', () => {
    const w = floorWorld();
    phantomState.insomniaDays = 2;
    worldClock.t = 0.75;
    for (let i = 0; i < 5; i++) tickMobs(w, 0.1, player, () => undefined);
    expect(mobs.filter((m) => m.type === 'phantom')).toHaveLength(0);
    phantomState.insomniaDays = 3;
    worldClock.t = 0.25; // 白天
    for (let i = 0; i < 5; i++) tickMobs(w, 0.1, player, () => undefined);
    expect(mobs.filter((m) => m.type === 'phantom')).toHaveLength(0);
  });

  it('盘旋后俯冲攻击玩家（4 伤），命中后拉升', () => {
    const w = floorWorld();
    const p = spawnMobAt('phantom', 8.5, 65, 8.5);
    p.phantomPhase = 'circle';
    p.phantomAngle = 0;
    p.phaseTimer = 0.01; // 立即转入俯冲
    let dmg = 0;
    for (let i = 0; i < 60; i++) tickMobs(w, 0.05, player, (d) => (dmg += d));
    expect(dmg).toBe(4); // MC 普通难度幻翼 2 心
    expect(p.phantomPhase).toBe('climb');
  });

  it('白天自燃（同僵尸规则）', () => {
    const w = floorWorld();
    worldClock.t = 0.25; // 正午
    const p = spawnMobAt('phantom', 8.5, 80, 8.5);
    tickMobs(w, 1, player, () => undefined);
    expect(p.hp).toBeLessThan(20);
  });
});

describe('铁傀儡（村庄守卫）', () => {
  it('defs：HP 100、掉 1-2 铁锭', () => {
    expect(MOB_DEFS.iron_golem.hp).toBe(100);
    expect(MOB_DEFS.iron_golem.drops).toContainEqual({ material: 'iron_ingot', count: [1, 2] });
  });

  it('真实村庄附近刷 1 只铁傀儡并锚定村庄（不重复刷）', { timeout: 30000 }, () => {
    const seed = 'golem-village';
    const terrain = createTerrain(seed);
    const seedHash = hashString(seed);
    let spot: { x: number; z: number } | null = null;
    for (let rx = -16; rx < 16 && !spot; rx++) {
      for (let rz = -16; rz < 16 && !spot; rz++) {
        const s = structureAt(seedHash, terrain, rx, rz);
        if (s?.kind.endsWith('village')) spot = { x: s.x, z: s.z };
      }
    }
    expect(spot).not.toBeNull();
    const w = new World(seed);
    for (let cx = (spot!.x >> 4) - 3; cx <= (spot!.x >> 4) + 3; cx++) {
      for (let cz = (spot!.z >> 4) - 3; cz <= (spot!.z >> 4) + 3; cz++) w.getChunk(cx, cz);
    }
    worldClock.t = 0.3;
    let spawned = false;
    for (let i = 0; i < 120 && !spawned; i++) {
      trySpawn(w, spot!.x, spot!.z);
      spawned = mobs.some((m) => m.type === 'iron_golem');
    }
    expect(spawned).toBe(true);
    for (let i = 0; i < 40; i++) trySpawn(w, spot!.x, spot!.z);
    expect(mobs.filter((m) => m.type === 'iron_golem')).toHaveLength(1); // 每村 1 只
    const g = mobs.find((m) => m.type === 'iron_golem')!;
    expect(g.homeX).toBe(spot!.x);
    expect(g.homeZ).toBe(spot!.z);
  });

  it('中立：不攻击玩家；猎杀靠近的敌对怪（僵尸死、猪无伤）', () => {
    const w = floorWorld();
    worldClock.t = 0.3;
    mobs.push(mkMob({ type: 'iron_golem', x: 10.5, y: 41, z: 8.5 }));
    mobs.push(mkMob({ type: 'zombie', x: 12.5, y: 41, z: 8.5 }));
    mobs.push(mkMob({ type: 'pig', x: 12.5, y: 41, z: 10.5 }));
    let playerDmg = 0;
    for (let i = 0; i < 80 && mobs.some((m) => m.type === 'zombie'); i++) {
      tickMobs(w, 0.1, player, (d) => (playerDmg += d));
    }
    expect(mobs.some((m) => m.type === 'zombie')).toBe(false); // 僵尸被铁傀儡击杀
    expect(mobs.find((m) => m.type === 'pig')?.hp).toBe(10); // 被动生物不受攻击
    expect(playerDmg).toBeLessThan(7); // 铁傀儡未攻击玩家（可能吃到僵尸一两下）
    // 无目标时保持中立
    clearMobs();
    mobs.push(mkMob({ type: 'iron_golem', x: 10.5, y: 41, z: 8.5 }));
    let dmg = 0;
    for (let i = 0; i < 10; i++) tickMobs(w, 0.1, player, (d) => (dmg += d));
    expect(dmg).toBe(0);
  });

  it('玩家攻击村民：32 格内铁傀儡仇恨玩家并反击（7-14 伤）', () => {
    const w = floorWorld();
    const g = mkMob({ type: 'iron_golem', x: 10.5, y: 41, z: 8.5 });
    const v = mkMob({ type: 'villager', x: 12.5, y: 41, z: 8.5 });
    mobs.push(g);
    mobs.push(v);
    damageMob(v, 1, { x: player.x, z: player.z }); // 玩家打了村民
    expect(g.aggroTimer).toBeGreaterThan(0);
    let first = 0;
    for (let i = 0; i < 60 && first === 0; i++) tickMobs(w, 0.1, player, (d) => (first = d));
    expect(first).toBeGreaterThanOrEqual(7);
    expect(first).toBeLessThanOrEqual(14);
  });

  it('玩家攻击铁傀儡：它仇恨玩家', () => {
    const w = floorWorld();
    const g = mkMob({ type: 'iron_golem', x: 10.5, y: 41, z: 8.5 });
    mobs.push(g);
    damageMob(g, 1, { x: player.x, z: player.z });
    expect(g.aggroTimer).toBeGreaterThan(0);
    let dmg = 0;
    for (let i = 0; i < 60 && dmg === 0; i++) tickMobs(w, 0.1, player, (d) => (dmg += d));
    expect(dmg).toBeGreaterThan(0);
  });
});

describe('生物摔落伤害', () => {
  it('与玩家同公式：>3 格每格 1 点（fallDist 8 → 5 点）', () => {
    const w = floorWorld();
    w.setBlock(8, 44, 8, STONE); // 顶棚：遮蔽天空防白天自燃干扰
    const z = mkMob({ type: 'zombie', x: 8.5, y: 41.05, z: 8.5, onGround: false, velY: -1, fallDist: 8 });
    mobs.push(z);
    tickMobs(w, 0.05, player, () => undefined);
    expect(mobs[0].hp).toBe(20 - 5); // floor(8 - 3)
    expect(mobs[0].fallDist).toBe(0); // 落地清零
  });

  it('高处坠落按累计距离结算；可摔死', () => {
    const w = floorWorld();
    w.setBlock(8, 52, 8, STONE); // 顶棚：遮蔽天空防白天自燃干扰
    mobs.push(mkMob({ type: 'zombie', x: 8.5, y: 50, z: 8.5, onGround: false }));
    for (let i = 0; i < 30; i++) tickMobs(w, 0.05, player, () => undefined);
    expect(mobs[0].onGround).toBe(true);
    expect(mobs[0].hp).toBeGreaterThanOrEqual(12); // 约 6-8 点摔伤
    expect(mobs[0].hp).toBeLessThan(20);
    // 摔死
    clearMobs();
    w.setBlock(8, 44, 8, STONE);
    mobs.push(mkMob({ type: 'zombie', x: 8.5, y: 41.05, z: 8.5, onGround: false, velY: -1, fallDist: 30, hp: 5 }));
    tickMobs(w, 0.05, player, () => undefined);
    expect(mobs).toHaveLength(0);
  });

  it('鸡缓降（限速 -2）且摔落免疫（MC）', () => {
    const w = floorWorld();
    const c = mkMob({ type: 'chicken', x: 8.5, y: 50, z: 8.5, onGround: false });
    mobs.push(c);
    for (let i = 0; i < 10; i++) tickMobs(w, 0.05, player, () => undefined);
    expect(mobs[0].velY).toBe(-2); // 扑翼缓降
    mobs[0].y = 41.05;
    mobs[0].velY = -1;
    mobs[0].fallDist = 8;
    tickMobs(w, 0.05, player, () => undefined);
    expect(mobs[0].hp).toBe(4); // 免疫摔伤
  });
});

describe('鸡下蛋', () => {
  it('成年鸡到点下蛋（5-10 分钟周期），蛋落在脚下', () => {
    const w = floorWorld();
    const c = mkMob({ type: 'chicken', x: 8.5, y: 41, z: 8.5, eggTimer: 0.05 });
    mobs.push(c);
    tickMobs(w, 0.1, player, () => undefined);
    const egg = itemDrops.find((d) => d.drop.kind === 'material' && d.drop.material === 'egg');
    expect(egg).toBeDefined();
    expect(egg!.x).toBe(8.5);
    expect(egg!.z).toBe(8.5);
    expect(mobs[0].eggTimer).toBeGreaterThanOrEqual(300); // 重置到 5-10 分钟
    expect(mobs[0].eggTimer).toBeLessThanOrEqual(600);
  });

  it('幼鸡不下蛋', () => {
    const w = floorWorld();
    mobs.push(mkMob({ type: 'chicken', x: 8.5, y: 41, z: 8.5, baby: true, growUp: 90, eggTimer: 0.05 }));
    tickMobs(w, 0.1, player, () => undefined);
    expect(itemDrops.some((d) => d.drop.kind === 'material' && d.drop.material === 'egg')).toBe(false);
  });
});

describe('掉落表修正（MC）', () => {
  it('蜘蛛加掉 0-1 蜘蛛眼', () => {
    expect(MOB_DEFS.spider.drops).toContainEqual({ material: 'spider_eye', count: [0, 1] });
    mobs.push(mkMob({ type: 'spider', x: 1, y: 41, z: 1, hp: 1 }));
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    damageMob(mobs[0], 4);
    rnd.mockRestore();
    expect(itemDrops.some((d) => d.drop.kind === 'material' && d.drop.material === 'spider_eye')).toBe(true);
    expect(itemDrops.some((d) => d.drop.kind === 'material' && d.drop.material === 'string')).toBe(true);
  });

  it('僵尸猪灵掉腐肉 + 金粒（不再掉骨头/金锭）', () => {
    const drops = MOB_DEFS.zombified_piglin.drops;
    expect(drops).toContainEqual({ material: 'rotten_flesh', count: [0, 1] });
    expect(drops).toContainEqual({ material: 'gold_nugget', count: [0, 1] });
    expect(drops.some((d) => d.material === 'bone' || d.material === 'gold_ingot')).toBe(false);
    mobs.push(mkMob({ type: 'zombified_piglin', x: 1, y: 41, z: 1, hp: 1 }));
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    damageMob(mobs[0], 4);
    rnd.mockRestore();
    expect(itemDrops.some((d) => d.drop.kind === 'material' && d.drop.material === 'rotten_flesh')).toBe(true);
    expect(itemDrops.some((d) => d.drop.kind === 'material' && d.drop.material === 'gold_nugget')).toBe(true);
  });

  it('猪灵掉 0-2 金粒（不再掉金锭）', () => {
    const drops = MOB_DEFS.piglin.drops;
    expect(drops).toContainEqual({ material: 'gold_nugget', count: [0, 2] });
    expect(drops.some((d) => d.material === 'gold_ingot')).toBe(false);
    mobs.push(mkMob({ type: 'piglin', x: 1, y: 41, z: 1, hp: 1 }));
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    damageMob(mobs[0], 4);
    rnd.mockRestore();
    const nugget = itemDrops.find((d) => d.drop.kind === 'material' && d.drop.material === 'gold_nugget');
    expect(nugget?.count).toBe(2);
  });
});

describe('末影之眼飞行距离', () => {
  it('直飞约 60-80 格后悬停掉落（MC 远距指向要塞）', () => {
    const w = floorWorld();
    fireEyeOfEnder({ x: 8.5, y: 62, z: 8.5 }, 208.5, 8.5); // 正东 200 格
    expect(arrows).toHaveLength(1);
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // ≥0.2 → 掉落
    for (let i = 0; i < 40; i++) tickMobs(w, 0.1, { x: 8.5, y: 62, z: 8.5 }, () => undefined);
    expect(arrows).toHaveLength(0); // 3.2s 结算
    const drop = itemDrops.find((d) => d.drop.kind === 'material' && d.drop.material === 'eye_of_ender');
    expect(drop).toBeDefined();
    const dist = drop!.x - 8.5;
    expect(dist).toBeGreaterThanOrEqual(60);
    expect(dist).toBeLessThanOrEqual(80);
    vi.restoreAllMocks();
  });
});

describe('烈焰人三连发', () => {
  it('蓄力停顿后快速三连发，再冷却（MC 节奏）', () => {
    const w = new World('blaze-burst', undefined, VOID_TERRAIN);
    for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) w.getChunk(cx, cz);
    mobs.push(mkMob({ type: 'blaze', x: 21.5, y: 60, z: 8.5, arrowCd: 0 })); // 13 格（射程 14 内）
    const p = { x: 8.5, y: 60, z: 8.5 };
    const shots: number[] = [];
    let prev = 0;
    let t = 0;
    for (let i = 0; i < 70; i++) {
      tickMobs(w, 0.05, p, () => undefined);
      t += 0.05;
      if (arrows.length > prev) shots.push(t);
      prev = arrows.length;
    }
    expect(shots).toHaveLength(3); // 3.5s 内只有一波三连（下一波蓄力约 3.8s）
    expect(shots[0]).toBeGreaterThanOrEqual(0.45); // 蓄力停顿 0.5s
    expect(shots[0]).toBeLessThan(0.7);
    expect(shots[2] - shots[0]).toBeLessThan(0.4); // 三连紧凑（间隔 0.15s）
  });
});

describe('spawnMobAt 定点生成', () => {
  it('在指定位置生成一只鸡并加入世界', () => {
    const c = spawnMobAt('chicken', 1.5, 42, 3.5);
    expect(c.type).toBe('chicken');
    expect(c.hp).toBe(MOB_DEFS.chicken.hp);
    expect(mobs).toContain(c);
    expect([c.x, c.y, c.z]).toEqual([1.5, 42, 3.5]);
  });
});
