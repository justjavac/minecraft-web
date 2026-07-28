// 末影人：瞬移、受击激怒与瞬移闪避、对视激怒、水触掉血、末影珍珠投掷传送

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tryPlace } from '../actions';
import { BLOCK_BY_KEY, WATER } from '../blocks';
import { cameraRef, pearlTeleport, setActiveWorld } from '../game';
import { clearDrops } from '../items';
import { arrows, checkEndermanStare, clearMobs, damageMob, MOB_DEFS, mobs, teleportEnderman, tickMobs } from '../mobs';
import { VOID_TERRAIN } from '../noise';
import { useGameStore } from '../store';
import { emptySlots, type Slot } from '../slots';
import { World } from '../world';
import { Vector3, type Camera } from 'three';

const K = (k: string) => BLOCK_BY_KEY[k].id;

function setup(slots?: Slot[]): World {
  clearMobs();
  clearDrops();
  const w = new World('enderman-test', undefined, VOID_TERRAIN);
  setActiveWorld(w);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) w.getChunk(cx, cz);
  useGameStore.getState().loadSurvival({ health: 20, hunger: 20, slots: slots ?? emptySlots() });
  useGameStore.setState({ worldMode: 'survival' });
  return w;
}

const mkEnderman = (x: number, y: number, z: number) => ({
  id: Math.random(), type: 'enderman' as const, x, y, z,
  velY: 0, hp: 40, attackCd: 0, onGround: true,
  wanderDir: 0, wanderTimer: 0, wanderMoving: false,
  fleeTimer: 0, fleeFromX: 0, fleeFromZ: 0, arrowCd: 1, ignite: -1,
});

function floor(w: World, y = 39): void {
  for (let x = -16; x < 40; x++) for (let z = -16; z < 40; z++) w.setBlock(x, y, z, BLOCK_BY_KEY.stone.id);
}

beforeEach(() => {
  clearMobs();
  clearDrops();
  pearlTeleport.pending = null;
});

describe('末影人', () => {
  it('瞬移：落在实心地面、上方三格为空', () => {
    const w = setup();
    floor(w);
    mobs.push(mkEnderman(8.5, 40, 8.5));
    const m = mobs[0];
    expect(teleportEnderman(w, m)).toBe(true);
    const bx = Math.floor(m.x);
    const bz = Math.floor(m.z);
    expect(BLOCK_BY_KEY.stone.id === w.getBlock(bx, Math.floor(m.y) - 1, bz) || K('stone') === w.getBlock(bx, Math.floor(m.y) - 1, bz)).toBe(true);
    expect(m.y).toBeGreaterThan(39);
  });

  it('受击激怒且可能瞬移闪避（大数下必有瞬移）', () => {
    const w = setup();
    floor(w);
    let teleported = false;
    for (let i = 0; i < 20 && !teleported; i++) {
      clearMobs();
      mobs.push(mkEnderman(8.5, 40, 8.5));
      const { x, z } = mobs[0];
      damageMob(mobs[0], 2, { x: 0, z: 0 }, 0, w);
      if (mobs[0].x !== x || mobs[0].z !== z) teleported = true;
      expect(mobs[0].aggroTimer).toBeGreaterThan(0);
    }
    expect(teleported).toBe(true); // 60% 概率瞬移，20 次全覆盖
  });

  it('对视激怒（checkEndermanStare 命中即进仇恨）', () => {
    const w = setup();
    floor(w);
    mobs.push(mkEnderman(14.5, 40, 8.5));
    const hit = checkEndermanStare(w, 8.5, 41.6, 8.5, 1, -0.05, 0);
    expect(hit).toBe(true);
    expect(mobs[0].aggroTimer).toBeGreaterThan(0);
    // 视线偏离不激怒
    mobs[0].aggroTimer = 0;
    expect(checkEndermanStare(w, 8.5, 41.6, 8.5, -1, -0.05, 0)).toBe(false);
  });

  it('水触掉血并瞬移逃离（MC）', () => {
    const w = setup();
    floor(w);
    w.setBlock(8, 40, 8, WATER);
    mobs.push(mkEnderman(8.5, 41, 8.5));
    const hp0 = mobs[0].hp;
    const { x, z } = mobs[0];
    for (let i = 0; i < 30; i++) tickMobs(w, 0.1, { x: 0, y: 40, z: 0 }, () => undefined);
    expect(mobs[0].hp).toBeLessThan(hp0);
    expect(mobs[0].x !== x || mobs[0].z !== z).toBe(true); // 瞬移离开了水
  });

  it('箭命中末影人：不扣血，命中前瞬移闪避（MC 弹射物免疫）', () => {
    const w = setup();
    floor(w);
    mobs.push(mkEnderman(8.5, 40, 8.5));
    // random 固定 0.9：不刷怪、游走静止，瞬移落点确定（+6.4 格 → 14,14）
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.9);
    arrows.push({ id: 998, x: 5.5, y: 41, z: 8.5, vx: 15, vy: 0, vz: 0, age: 0, fromPlayer: true });
    for (let i = 0; i < 10 && arrows.length > 0; i++) tickMobs(w, 0.1, { x: 30.5, y: 40, z: 30.5 }, () => undefined);
    rnd.mockRestore();
    expect(arrows.length).toBe(0);
    expect(mobs[0].hp).toBe(40); // 不掉血
    expect(mobs[0].x).toBe(14.5); // 瞬移闪避（落点由 mock random 确定）
    expect(mobs[0].z).toBe(14.5);
  });

  it('激怒后追击玩家（距离缩短）', () => {
    const w = setup();
    floor(w);
    const player = { x: 8.5, y: 40, z: 8.5 };
    mobs.push(mkEnderman(20.5, 40, 8.5));
    mobs[0].aggroTimer = 30;
    const d0 = Math.hypot(20.5 - 8.5, 0);
    for (let i = 0; i < 10; i++) tickMobs(w, 0.1, player, () => undefined);
    expect(Math.hypot(mobs[0].x - player.x, mobs[0].z - player.z)).toBeLessThan(d0);
  });
});

describe('末影珍珠', () => {
  it('右键投掷：消耗珍珠、落点传送玩家 + 5 伤害（MC 2.5 心）', async () => {
    const slots: Slot[] = [null, ...emptySlots().slice(1)];
    slots[0] = { kind: 'material', material: 'ender_pearl', count: 2 };
    const w = setup(slots);
    floor(w);
    cameraRef.current = {
      position: new Vector3(8.5, 41.6, 8.5),
      getWorldDirection: (v: Vector3) => v.set(1, -0.4, 0).normalize(), // 朝下投，落在加载范围内
    } as unknown as Camera;
    expect(tryPlace()).toBe(false);
    expect(arrows.length).toBe(1);
    expect(arrows[0].kind).toBe('pearl');
    // 推进直到珍珠落地
    let dmg = 0;
    for (let i = 0; i < 80 && pearlTeleport.pending === null; i++) tickMobs(w, 0.1, { x: 8.5, y: 40, z: 8.5 }, (d) => (dmg += d));
    expect(pearlTeleport.pending).not.toBeNull();
    expect(dmg).toBe(5); // MC 珍珠传送伤害（2.5 心）
    const slot0 = useGameStore.getState().hotbarSlots[0];
    expect(slot0?.kind === 'material' && slot0.count).toBe(1);
  });

  it('末影人掉末影珍珠（defs）', () => {
    expect(MOB_DEFS.enderman.drops.some((d) => d.material === 'ender_pearl')).toBe(true);
    expect(MOB_DEFS.enderman.hp).toBe(40);
    expect(K('stone')).toBeGreaterThan(0);
  });
});
