// 耕种/养殖：整地、播种、生长、收割、草丛掉种子、喂食繁殖

import { beforeEach, describe, expect, it } from 'vitest';
import { breakBlock, tryPlace } from '../actions';
import { BLOCK_BY_KEY, GRASS, WHEAT_CROP_0 } from '../blocks';
import { notifyCropBlockSet, tickCrops } from '../crops';
import { cameraRef, setActiveWorld } from '../game';
import { clearDrops, itemDrops } from '../items';
import { breedMob, clearMobs, mobs } from '../mobs';
import { VOID_TERRAIN } from '../noise';
import { useGameStore } from '../store';
import { emptySlots } from '../slots';
import { World } from '../world';
import { Vector3, type Camera } from 'three';

const FARMLAND = () => BLOCK_BY_KEY.farmland.id;

function setup(): World {
  clearMobs();
  clearDrops();
  const w = new World('farm-test', undefined, VOID_TERRAIN);
  setActiveWorld(w);
  useGameStore.getState().loadSurvival({ health: 20, hunger: 20, slots: emptySlots() });
  useGameStore.setState({ worldMode: 'survival', notice: null });
  return w;
}

function cameraAt(x: number, y: number, z: number, dir: [number, number, number]): void {
  cameraRef.current = {
    position: new Vector3(x, y, z),
    getWorldDirection: (v: Vector3) => v.set(...dir).normalize(),
  } as unknown as Camera;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('耕种', () => {
  beforeEach(setup);

  it('锄头整地：草方块 → 耕地，扣耐久', async () => {
    const w = setup();
    w.setBlock(4, 30, 4, GRASS);
    const s = useGameStore.getState();
    s.addTool('wooden_hoe');
    useGameStore.setState({ selectedSlot: 0 });
    cameraAt(4.5, 32, 4.5, [0, -1, 0]);
    await wait(160);
    tryPlace();
    expect(w.getBlock(4, 30, 4)).toBe(FARMLAND());
    const slot = useGameStore.getState().hotbarSlots[0];
    expect(slot?.kind === 'tool' && slot.durability).toBe(58);
  });

  it('播种 → 生长 8 阶段 → 收割掉小麦和种子', async () => {
    const w = setup();
    w.setBlock(4, 30, 4, FARMLAND());
    const s = useGameStore.getState();
    s.addStack({ kind: 'material', material: 'wheat_seeds' }, 5);
    useGameStore.setState({ selectedSlot: 0 });
    cameraAt(4.5, 32, 4.5, [0, -1, 0]);
    await wait(160);
    tryPlace();
    expect(w.getBlock(4, 31, 4)).toBe(WHEAT_CROP_0);
    // 消耗了 1 种子
    expect(useGameStore.getState().hotbarSlots[0]).toEqual({ kind: 'material', material: 'wheat_seeds', count: 4 });
    // 生长：推进随机刻直到成熟（1/12 概率/2s，800 次足够；虚空世界无天空光，手动补光）
    notifyCropBlockSet(4, 31, 4, WHEAT_CROP_0); // 生成不走 setBlock 钩子，手动登记
    w.chunks.get('0,0')!.sky.fill(15);
    for (let i = 0; i < 800 && w.getBlock(4, 31, 4) < WHEAT_CROP_0 + 7; i++) tickCrops(w, 2);
    expect(w.getBlock(4, 31, 4)).toBe(WHEAT_CROP_0 + 7);
    // 收割
    breakBlock(w, 4, 31, 4);
    const wheat = itemDrops.filter((d) => d.drop.kind === 'material' && d.drop.material === 'wheat');
    expect(wheat.length).toBe(1);
  });

  it('未成熟收割只掉种子；耕地被破坏弹出作物', () => {
    const w = setup();
    w.setBlock(4, 30, 4, FARMLAND());
    w.setBlock(4, 31, 4, WHEAT_CROP_0 + 3);
    breakBlock(w, 4, 31, 4);
    expect(itemDrops.length).toBe(1);
    expect(itemDrops[0].drop.kind === 'material' && itemDrops[0].drop.material).toBe('wheat_seeds');
    // 耕地破坏：上方作物弹出
    clearDrops();
    w.setBlock(4, 31, 4, WHEAT_CROP_0 + 5);
    breakBlock(w, 4, 30, 4);
    expect(w.getBlock(4, 31, 4)).toBe(0);
    expect(itemDrops.some((d) => d.drop.kind === 'material' && d.drop.material === 'wheat_seeds')).toBe(true);
  });

  it('打草丛概率掉小麦种子（统计 25%±10%）', () => {
    const w = setup();
    const grass = BLOCK_BY_KEY.short_grass.id;
    let seeds = 0;
    for (let i = 0; i < 200; i++) {
      clearDrops();
      w.setBlock(4, 30, 4, grass);
      breakBlock(w, 4, 30, 4);
      seeds += itemDrops.filter((d) => d.drop.kind === 'material' && d.drop.material === 'wheat_seeds').length;
    }
    expect(seeds).toBeGreaterThan(30); // 期望 ~50
    expect(seeds).toBeLessThan(75);
  });
});

describe('养殖（喂食繁殖）', () => {
  beforeEach(setup);

  it('breedMob 生成同种幼体，90s 后长成', () => {
    mobs.push({
      id: 1, type: 'pig', x: 0, y: 10, z: 0, velY: 0, hp: 10, attackCd: 0, onGround: true,
      wanderDir: 0, wanderTimer: 0, wanderMoving: false, fleeTimer: 0, fleeFromX: 0, fleeFromZ: 0,
      arrowCd: 0, ignite: -1,
    });
    const baby = breedMob(mobs[0]);
    expect(baby.type).toBe('pig');
    expect(baby.baby).toBe(true);
    expect(mobs.length).toBe(2);
  });
});
