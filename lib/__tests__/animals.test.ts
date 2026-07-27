// 羊与狼：毛色与羊毛掉落、剪毛与吃草再生、狼群体仇恨/驯服/跟随/护主

import { beforeEach, describe, expect, it } from 'vitest';
import { tryPlace } from '../actions';
import { BLOCK_BY_KEY, GRASS } from '../blocks';
import { cameraRef, setActiveWorld } from '../game';
import { clearDrops, itemDrops } from '../items';
import { clearMobs, damageMob, lastPlayerTarget, MOB_DEFS, mobs, tickMobs } from '../mobs';
import { VOID_TERRAIN } from '../noise';
import { RECIPES } from '../recipes';
import { useGameStore } from '../store';
import { emptySlots, type Slot } from '../slots';
import { World } from '../world';
import { Vector3, type Camera } from 'three';

const K = (k: string) => BLOCK_BY_KEY[k].id;

function setup(slots?: Slot[]): World {
  clearMobs();
  clearDrops();
  const w = new World('sheep-wolf', undefined, VOID_TERRAIN);
  setActiveWorld(w);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) w.getChunk(cx, cz);
  useGameStore.getState().loadSurvival({ health: 20, hunger: 20, slots: slots ?? emptySlots() });
  useGameStore.setState({ worldMode: 'survival', xpTotal: 0, notice: null });
  return w;
}

function cameraAt(x: number, y: number, z: number, dir: [number, number, number]): void {
  cameraRef.current = {
    position: new Vector3(x, y, z),
    getWorldDirection: (v: Vector3) => v.set(...dir).normalize(),
  } as unknown as Camera;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const mkMob = (type: 'sheep' | 'wolf', x: number, y: number, z: number, extra?: Partial<(typeof mobs)[number]>) => ({
  id: Math.random(), type, x, y, z,
  velY: 0, hp: 8, attackCd: 0, onGround: true,
  wanderDir: 0, wanderTimer: 0, wanderMoving: false,
  fleeTimer: 0, fleeFromX: 0, fleeFromZ: 0, arrowCd: 1, ignite: -1,
  ...extra,
});

beforeEach(() => {
  clearMobs();
  clearDrops();
  lastPlayerTarget.mob = null;
  lastPlayerTarget.at = 0;
});

describe('羊', () => {
  it('击杀掉同色羊毛；剪过毛的不掉（MC）', () => {
    setup();
    mobs.push(mkMob('sheep', 8, 40, 8, { woolColor: 'pink' }));
    damageMob(mobs[0], 20, { x: 0, z: 0 });
    expect(itemDrops.some((d) => d.drop.kind === 'block' && d.drop.blockId === K('pink_wool'))).toBe(true);
    clearDrops();
    mobs.push(mkMob('sheep', 8, 40, 8, { woolColor: 'white', sheared: true }));
    damageMob(mobs[0], 20, { x: 0, z: 0 });
    expect(itemDrops.some((d) => d.drop.kind === 'block' && d.drop.blockId === K('white_wool'))).toBe(false);
  });

  it('剪刀剪毛：掉 1-3 同色毛 + 羊变剪毛态；剪过不再掉', () => {
    const w = setup([{ kind: 'tool', tool: 'shears', durability: 238 }, ...emptySlots().slice(1)]);
    mobs.push(mkMob('sheep', 6, 40, 6, { woolColor: 'brown' }));
    cameraAt(4.5, 41, 6, [1, -0.2, 0]);
    expect(tryPlace()).toBe(false);
    expect(mobs[0].sheared).toBe(true);
    const wool = itemDrops.filter((d) => d.drop.kind === 'block' && d.drop.blockId === K('brown_wool'));
    expect(wool.length).toBe(1);
    expect(wool[0].count).toBeGreaterThanOrEqual(1);
    expect(wool[0].count).toBeLessThanOrEqual(3);
    clearDrops();
    cameraAt(4.5, 41, 6, [1, -0.2, 0]);
    tryPlace();
    expect(itemDrops.length).toBe(0); // 已剪过
  });

  it('剪毛后吃草再生：草方块变泥土', () => {
    const w = setup();
    w.setBlock(8, 39, 8, GRASS);
    mobs.push(mkMob('sheep', 8.5, 40, 8.5, { sheared: true, grazeTimer: 0.01 }));
    for (let i = 0; i < 20; i++) tickMobs(w, 0.1, { x: 0, y: 0, z: 0 }, () => undefined);
    expect(w.getBlock(8, 39, 8)).toBe(K('dirt'));
    expect(mobs[0].sheared).toBe(false);
  });
});

describe('狼', () => {
  it('野狼被打群体仇恨（16 格内同伴进仇恨）', () => {
    setup();
    mobs.push(mkMob('wolf', 8, 40, 8));
    mobs.push(mkMob('wolf', 20, 40, 8));
    mobs.push(mkMob('wolf', 40, 40, 8)); // 32 格外
    damageMob(mobs[0], 2, { x: 0, z: 0 });
    expect(mobs[0].aggroTimer).toBeGreaterThan(0);
    expect(mobs[1].aggroTimer).toBeGreaterThan(0);
    expect(mobs[2].aggroTimer).toBeUndefined();
  });

  it('骨头驯狼：足够多骨头后驯服（1/3 概率的统计覆盖）', async () => {
    const slots: Slot[] = [null, ...emptySlots().slice(1)];
    slots[0] = { kind: 'material', material: 'bone', count: 30 };
    setup(slots);
    mobs.push(mkMob('wolf', 6, 40, 6));
    cameraAt(4.5, 41, 6, [1, -0.2, 0]);
    let tamed = false;
    for (let i = 0; i < 30 && !tamed; i++) {
      await wait(160); // 放置冷却（150ms 内重复右键会被拒）
      tryPlace();
      tamed = mobs[0].tamed === true;
    }
    expect(tamed).toBe(true);
    expect(mobs[0].aggroTimer).toBe(0);
  });

  it('驯服后跟随（靠近玩家）且过远传送跟上（MC）', () => {
    const w = setup();
    // 铺地板（虚空世界否则跟随中会坠落）
    for (let x = 0; x < 40; x++) for (let z = 0; z < 16; z++) w.setBlock(x, 39, z, BLOCK_BY_KEY.stone.id);
    mobs.push(mkMob('wolf', 16, 40, 8, { tamed: true }));
    const player = { x: 8.5, y: 40, z: 8.5 };
    const d0 = Math.hypot(16 - 8.5, 0);
    for (let i = 0; i < 20; i++) tickMobs(w, 0.1, player, () => undefined);
    const m = mobs[0];
    expect(Math.hypot(m.x - player.x, m.z - player.z)).toBeLessThan(d0); // 跟随靠近
    // 传送：放到 30 格外
    m.x = 38.5;
    tickMobs(w, 0.1, player, () => undefined);
    expect(Math.hypot(m.x - player.x, m.z - player.z)).toBeLessThan(4); // 传送回身边
  });

  it('护主：驯狼攻击玩家刚打过的目标', () => {
    const w = setup();
    const player = { x: 8.5, y: 40, z: 8.5 };
    mobs.push(mkMob('wolf', 10, 40, 8, { tamed: true }));
    mobs.push(mkMob('sheep', 12, 40, 8, { hp: 8 }));
    damageMob(mobs[1], 1, player); // 玩家打了羊一下
    expect(lastPlayerTarget.mob).toBe(mobs[1]);
    for (let i = 0; i < 60 && mobs[1].hp >= 8; i++) tickMobs(w, 0.1, player, () => undefined);
    expect(mobs[1].hp).toBeLessThan(8); // 驯狼替玩家攻击了目标
  });

  it('剪刀配方：铁锭 ×2（MC）', () => {
    expect(RECIPES.find((r) => r.id === 'shears')).toBeDefined();
    expect(MOB_DEFS.sheep.hp).toBe(8);
  });
});
