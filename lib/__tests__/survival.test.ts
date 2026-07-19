import { beforeEach, describe, expect, it } from 'vitest';
import { emptyArmorSlots } from '../armor';
import { STONE } from '../blocks';
import { dayFactorAt, hurtState, worldClock } from '../game';
import { clearDrops, itemDrops } from '../items';
import { clearMobs, damageMob, mobInReach, mobs, arrows, tickMobs, trySpawn, type Mob, type MobType } from '../mobs';
import { VOID_TERRAIN } from '../noise';
import { MAX_HEALTH, MAX_HUNGER, MAX_SATURATION, useGameStore } from '../store';
import { emptySlots } from '../slots';
import { World } from '../world';

function resetStore(): void {
  useGameStore.setState({
    worldMode: 'survival',
    health: MAX_HEALTH,
    hunger: MAX_HUNGER,
    saturation: MAX_SATURATION,
    dead: false,
    hotbarSlots: emptySlots(),
    armorSlots: emptyArmorSlots(),
    lastDamageAt: 0,
  });
  hurtState.lastAt = Number.NEGATIVE_INFINITY;
}

/** 64×64 石板地面（y=9）的测试世界 */
function floorWorld(): World {
  const w = new World('mobs', undefined, VOID_TERRAIN);
  for (let x = -32; x < 32; x++) {
    for (let z = -32; z < 32; z++) w.setBlock(x, 9, z, STONE);
  }
  return w;
}

/** 构造测试生物（新字段默认值） */
function mkMob(partial: Partial<Mob> & { id: number; type: MobType; x: number; y: number; z: number }): Mob {
  return {
    velY: 0,
    hp: 10,
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

describe('槽位背包', () => {
  beforeEach(resetStore);

  it('添加物品先合并堆叠，再占空槽', () => {
    useGameStore.getState().addStack({ kind: 'block', id: STONE }, 3);
    useGameStore.getState().addStack({ kind: 'block', id: STONE }, 2);
    expect(useGameStore.getState().hotbarSlots[0]).toEqual({ kind: 'block', id: STONE, count: 5 });
  });

  it('放不下的部分作为剩余返回（热键栏+背包全满）', () => {
    const leftover = useGameStore.getState().addStack({ kind: 'block', id: STONE }, 64 * 36 + 10);
    expect(leftover).toBe(10);
  });

  it('consumeSelectedBlock 消耗选中槽位', () => {
    useGameStore.getState().addStack({ kind: 'block', id: STONE }, 2);
    expect(useGameStore.getState().consumeSelectedBlock()).toBe(STONE);
    expect(useGameStore.getState().consumeSelectedBlock()).toBe(STONE);
    expect(useGameStore.getState().consumeSelectedBlock()).toBeNull();
  });

  it('工具占独立槽位且不可堆叠', () => {
    expect(useGameStore.getState().addTool('wooden_pickaxe')).toBe(true);
    const slot = useGameStore.getState().hotbarSlots[0];
    expect(slot).toEqual({ kind: 'tool', tool: 'wooden_pickaxe', durability: 59 });
  });
});

describe('生命系统', () => {
  beforeEach(resetStore);

  it('受伤扣血，无敌帧内不重复扣', () => {
    expect(useGameStore.getState().damagePlayer(5)).toBe(true);
    expect(useGameStore.getState().health).toBe(15);
    expect(useGameStore.getState().damagePlayer(5)).toBe(false);
    expect(useGameStore.getState().health).toBe(15);
  });

  it('扣到 0 触发死亡', () => {
    useGameStore.getState().damagePlayer(20);
    expect(useGameStore.getState().health).toBe(0);
    expect(useGameStore.getState().dead).toBe(true);
  });

  it('死亡时热键栏物品全部以掉落物实体散落并清空', () => {
    clearDrops();
    useGameStore.getState().addStack({ kind: 'block', id: STONE }, 5);
    useGameStore.getState().addTool('wooden_pickaxe');
    useGameStore.getState().damagePlayer(20);
    const s = useGameStore.getState();
    expect(s.dead).toBe(true);
    expect(s.hotbarSlots.every((x) => x === null)).toBe(true);
    expect(itemDrops.length).toBe(2); // 方块堆叠 + 工具各一个实体
    clearDrops();
  });
});

describe('昼夜系数', () => {
  it('正午最亮、午夜最暗', () => {
    expect(dayFactorAt(0.25)).toBeGreaterThan(0.9);
    expect(dayFactorAt(0.75)).toBeLessThan(0.1);
  });
});

describe('僵尸', () => {
  beforeEach(() => {
    clearMobs();
    worldClock.t = 0.75; // 午夜
  });

  it('夜晚在玩家周围地表生成', { timeout: 20000 }, () => {
    const w = floorWorld();
    let ok = false;
    for (let i = 0; i < 20 && !ok; i++) ok = trySpawn(w, 0, 0);
    expect(ok).toBe(true);
    const m = mobs[0];
    expect(m.y).toBe(10); // 地板 y=9 之上一格
    expect(Math.hypot(m.x, m.z)).toBeGreaterThanOrEqual(23);
  });

  it('追击时与玩家距离缩短', { timeout: 20000 }, () => {
    const w = floorWorld();
    mobs.push(mkMob({ id: 1, type: 'zombie', x: 5, y: 10, z: 0 }));
    tickMobs(w, 0.5, { x: 0, y: 10, z: 0 }, () => {});
    expect(Math.hypot(mobs[0].x, mobs[0].z)).toBeLessThan(5);
  });

  it('近身攻击玩家并进入冷却', () => {
    const w = floorWorld();
    mobs.push(mkMob({ id: 2, type: 'zombie', x: 1, y: 10, z: 0 }));
    let dmg = 0;
    tickMobs(w, 0.1, { x: 0, y: 10, z: 0 }, (d) => (dmg += d));
    expect(dmg).toBe(4); // MC 普通难度僵尸近战 2 心
    dmg = 0;
    tickMobs(w, 0.1, { x: 0, y: 10, z: 0 }, (d) => (dmg += d));
    expect(dmg).toBe(0); // 冷却中不再攻击
  });

  it('白天燃烧死亡', () => {
    const w = floorWorld();
    mobs.push(mkMob({ id: 3, type: 'zombie', x: 30, y: 10, z: 30, hp: 1 }));
    worldClock.t = 0.25; // 正午
    tickMobs(w, 1, { x: 0, y: 10, z: 0 }, () => {});
    expect(mobs.length).toBe(0);
  });

  it('mobInReach 命中视线上的僵尸，背后不中、隔墙不中', () => {
    const w = floorWorld();
    mobs.push(mkMob({ id: 4, type: 'zombie', x: 0.5, y: 10, z: 3 }));
    expect(mobInReach(w, 0.5, 11.6, 0, 0, 0, 1, 6)?.id).toBe(4);
    expect(mobInReach(w, 0.5, 11.6, 0, 0, 0, -1, 6)).toBeNull();
    // 隔墙：视线与僵尸之间放一堵墙
    w.setBlock(0, 11, 1, STONE);
    w.setBlock(0, 12, 1, STONE);
    expect(mobInReach(w, 0.5, 11.6, 0, 0, 0, 1, 6)).toBeNull();
  });

  it('damageMob 击杀后移除', () => {
    mobs.push(mkMob({ id: 5, type: 'zombie', x: 0, y: 10, z: 0, hp: 4 }));
    expect(damageMob(mobs[0], 4)).toBe(true);
    expect(mobs.length).toBe(0);
  });
});

describe('更多生物', () => {
  beforeEach(() => {
    clearMobs();
    worldClock.t = 0.75; // 午夜
  });

  it('被动生物不追击玩家（游走随机）', () => {
    const w = floorWorld();
    mobs.push(mkMob({ id: 10, type: 'pig', x: 5, y: 10, z: 0, wanderTimer: -1, wanderMoving: false }));
    const d0 = Math.hypot(mobs[0].x - 0, mobs[0].z - 0);
    tickMobs(w, 0.5, { x: 0, y: 10, z: 0 }, () => {});
    const d1 = Math.hypot(mobs[0].x - 0, mobs[0].z - 0);
    expect(Math.abs(d1 - d0)).toBeLessThan(1.5); // 不定向追击
  });

  it('杀猪掉落生猪排', () => {
    mobs.push(mkMob({ id: 11, type: 'pig', x: 1, y: 10, z: 1, hp: 1 }));
    clearDrops();
    expect(damageMob(mobs[0], 4)).toBe(true);
    expect(itemDrops.some((d) => d.drop.kind === 'material' && d.drop.material === 'raw_pork')).toBe(true);
    clearDrops();
  });

  it('骷髅在射程内射出箭，箭命中玩家扣血', () => {
    const w = floorWorld();
    mobs.push(mkMob({ id: 12, type: 'skeleton', x: 8, y: 10, z: 0, arrowCd: 0 }));
    tickMobs(w, 0.1, { x: 0, y: 10, z: 0 }, () => {});
    expect(arrows.length).toBe(1);
    // 箭飞向玩家：推进到命中
    let dmg = 0;
    for (let i = 0; i < 200 && dmg === 0; i++) {
      tickMobs(w, 0.05, { x: 0, y: 10, z: 0 }, (d) => (dmg += d));
    }
    expect(dmg).toBeGreaterThan(0);
  });

  it('苦力怕近身引爆：破坏方块并伤害玩家', { timeout: 20000 }, () => {
    const w = floorWorld();
    const player = { x: 0, y: 10, z: 0 };
    mobs.push(mkMob({ id: 13, type: 'creeper', x: 1.5, y: 10, z: 0 }));
    let dmg = 0;
    // 进入引爆流程（1.5s 引信）
    for (let i = 0; i < 40; i++) tickMobs(w, 0.1, player, (d) => (dmg += d));
    expect(dmg).toBeGreaterThan(0);
    expect(mobs.find((m) => m.id === 13)).toBeUndefined();
    // 爆炸破坏了地面
    let holes = 0;
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) if (w.getBlock(x, 9, z) === 0) holes++;
    expect(holes).toBeGreaterThan(0);
  });

  it('蜘蛛白天中立不追击', { timeout: 20000 }, () => {
    const w = floorWorld();
    worldClock.t = 0.25; // 正午
    mobs.push(mkMob({ id: 14, type: 'spider', x: 5, y: 10, z: 0, wanderTimer: 99, wanderMoving: false }));
    tickMobs(w, 0.5, { x: 0, y: 10, z: 0 }, () => {});
    expect(Math.hypot(mobs[0].x, mobs[0].z)).toBeGreaterThan(4.5); // 基本没动
  });
});
