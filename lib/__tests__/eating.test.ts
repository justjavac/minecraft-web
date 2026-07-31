// 进食读条（MC Java：按住右键 1.61s 吃完；松手/换槽/换物取消，受伤不打断）与腐肉/生鸡肉饥饿效果

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Vector3, type Camera } from 'three';
import { cancelEating, EAT_DURATION, eatState, tickEating, tryPlace, useButton } from '../actions';
import { effects, tickEffects } from '../effects';
import { cameraRef, playerPosition, setActiveWorld, survivalStats } from '../game';
import { VOID_TERRAIN } from '../noise';
import { emptySlots } from '../slots';
import { MAX_HUNGER, useGameStore } from '../store';
import { tickSurvival, type SurvivalMem } from '../survival';
import { World } from '../world';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mockCamera(): Camera {
  return {
    position: new Vector3(4.5, 31, 7.5),
    getWorldDirection: (v: Vector3) => v.set(0, 0, -1),
  } as unknown as Camera;
}

function setupFood(material: string, count = 3, hunger = 10): World {
  const w = new World('eat-test', undefined, VOID_TERRAIN);
  setActiveWorld(w);
  cameraRef.current = mockCamera();
  playerPosition.x = 4.5;
  playerPosition.y = 31;
  playerPosition.z = 7.5;
  const hotbarSlots = emptySlots();
  hotbarSlots[0] = { kind: 'material', material, count };
  useGameStore.setState({ worldMode: 'survival', hotbarSlots, selectedSlot: 0, hunger, saturation: 5, notice: null });
  cancelEating();
  useButton.held = false;
  return w;
}

/** 模拟松开使用键：桌面 useButton=false 且触屏连发续期超时 */
function releaseUse(): void {
  useButton.held = false;
  eatState.nudgedAt = performance.now() - 1000;
}

afterEach(() => {
  setActiveWorld(null);
  cameraRef.current = null;
  cancelEating();
  useButton.held = false;
  effects.hunger = 0;
  survivalStats.exhaustion = 0;
  vi.restoreAllMocks();
});

describe('进食读条', () => {
  it('右键手持食物：启动读条，不立即进食', async () => {
    setupFood('bread');
    await wait(160); // 放置冷却
    tryPlace();
    expect(eatState.active).toBe(true);
    expect(eatState.progress).toBe(0);
    expect(eatState.material).toBe('bread');
    const s = useGameStore.getState();
    expect(s.hunger).toBe(10); // 尚未吃到
    expect(s.hotbarSlots[0]).toEqual({ kind: 'material', material: 'bread', count: 3 });
  });

  it('读满 1.61s 才完成进食：恢复饥饿并消耗食物', async () => {
    setupFood('bread', 3, 18); // 18+5 封顶 20：吃饱后不自动续吃
    await wait(160);
    tryPlace();
    useButton.held = true; // 桌面按住
    tickEating(EAT_DURATION / 2);
    expect(useGameStore.getState().hunger).toBe(18); // 半途还没吃到
    tickEating(EAT_DURATION / 2);
    const s = useGameStore.getState();
    expect(s.hunger).toBe(20); // min(20, 18+5)
    expect(s.hotbarSlots[0]).toEqual({ kind: 'material', material: 'bread', count: 2 });
    expect(eatState.active).toBe(false); // 吃饱自动停（Java）
  });

  it('中途松手：读条取消，不消耗食物', async () => {
    setupFood('bread');
    await wait(160);
    tryPlace();
    tickEating(0.5);
    releaseUse();
    tickEating(0.1);
    expect(eatState.active).toBe(false);
    const s = useGameStore.getState();
    expect(s.hunger).toBe(10);
    expect(s.hotbarSlots[0]).toEqual({ kind: 'material', material: 'bread', count: 3 });
  });

  it('中途换槽：读条取消', async () => {
    setupFood('bread');
    await wait(160);
    tryPlace();
    useGameStore.setState({ selectedSlot: 1 });
    tickEating(0.1);
    expect(eatState.active).toBe(false);
    expect(useGameStore.getState().hunger).toBe(10);
  });

  it('触屏按住「放」的连发调用：续期不重启读条', async () => {
    setupFood('bread');
    await wait(160);
    tryPlace();
    tickEating(0.5);
    const before = eatState.progress;
    eatState.nudgedAt = performance.now() - 200; // 快超时了
    await wait(160); // 过放置冷却，连发的下一次 tryPlace 才能走到进食分支
    tryPlace(); // 连发 nudge
    expect(eatState.active).toBe(true);
    expect(eatState.progress).toBe(before); // 没有重启
    expect(performance.now() - eatState.nudgedAt).toBeLessThan(200); // 续期成功
    tickEating(EAT_DURATION); // 继续推进可完成
    expect(useGameStore.getState().hunger).toBe(15); // 10+5
  });

  it('满饥饿右键：不启动读条，提示「还不饿」（MC）', async () => {
    setupFood('bread', 3, MAX_HUNGER);
    await wait(160);
    tryPlace();
    expect(eatState.active).toBe(false);
    expect(useGameStore.getState().notice).toBe('还不饿');
  });
});

describe('腐肉/生鸡肉饥饿效果（MC Hunger）', () => {
  it('腐肉 80%：roll 命中获得 30s 饥饿效果', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // < 0.8 命中
    setupFood('rotten_flesh', 3, 10);
    await wait(160);
    tryPlace();
    useButton.held = true;
    tickEating(EAT_DURATION);
    expect(useGameStore.getState().hunger).toBe(14); // 10+4
    expect(effects.hunger).toBe(30);
  });

  it('腐肉 80%：roll 未命中无效果', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9); // >= 0.8
    setupFood('rotten_flesh', 3, 10);
    await wait(160);
    tryPlace();
    useButton.held = true;
    tickEating(EAT_DURATION);
    expect(effects.hunger).toBe(0);
  });

  it('生鸡肉 30%：roll 命中获得 30s 饥饿效果', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.2); // < 0.3 命中
    setupFood('raw_chicken', 3, 10);
    await wait(160);
    tryPlace();
    useButton.held = true;
    tickEating(EAT_DURATION);
    expect(effects.hunger).toBe(30);
  });

  it('生鸡肉 30%：roll 未命中无效果；普通食物永不触发', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // >= 0.3
    setupFood('raw_chicken', 3, 10);
    await wait(160);
    tryPlace();
    useButton.held = true;
    tickEating(EAT_DURATION);
    expect(effects.hunger).toBe(0);

    vi.spyOn(Math, 'random').mockReturnValue(0.01); // 即使必中也只限腐肉/生鸡肉
    setupFood('bread', 3, 10);
    await wait(160);
    tryPlace();
    useButton.held = true;
    tickEating(EAT_DURATION);
    expect(effects.hunger).toBe(0);
  });

  it('饥饿效果期间 exhaustion 每秒额外 +0.1；效果随时间递减消失', () => {
    effects.hunger = 30;
    survivalStats.exhaustion = 0;
    const mem: SurvivalMem = { fallDist: 0, air: 15, regenTick: 0, witherTick: 0, regenPotionTick: 0 };
    tickSurvival(
      { dt: 1, flying: false, inWater: false, headInWater: false, onGround: true, velY: 0 },
      mem,
      { worldMode: 'survival', health: 20, hunger: 20, saturation: 5 },
      { damagePlayer: () => {}, setHealth: () => {}, setHunger: () => {}, setSaturation: () => {} },
    );
    expect(survivalStats.exhaustion).toBeCloseTo(0.1);
    tickEffects(30);
    expect(effects.hunger).toBe(0);
  });
});
