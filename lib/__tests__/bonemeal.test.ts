// 骨粉催熟小麦：+2~5 阶段（Java；旧版 +1~2 是偏差），第 7 阶段封顶

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Vector3, type Camera } from 'three';
import { tryPlace } from '../actions';
import { BLOCK_BY_KEY, WHEAT_CROP_0 } from '../blocks';
import { cameraRef, playerPosition, setActiveWorld } from '../game';
import { VOID_TERRAIN } from '../noise';
import { emptySlots } from '../slots';
import { useGameStore } from '../store';
import { World } from '../world';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 站在 (4.5, 31, 7.5) 朝 -z 俯视 (4,30,4) 的作物 */
function mockCamera(): Camera {
  return {
    position: new Vector3(4.5, 31, 7.5),
    getWorldDirection: (v: Vector3) => v.set(0, -0.28, -1).normalize(),
  } as unknown as Camera;
}

function setupCrop(stage: number): World {
  const w = new World('bonemeal-test', undefined, VOID_TERRAIN);
  w.setBlock(4, 29, 4, BLOCK_BY_KEY.farmland.id);
  w.setBlock(4, 30, 4, WHEAT_CROP_0 + stage);
  setActiveWorld(w);
  cameraRef.current = mockCamera();
  playerPosition.x = 4.5;
  playerPosition.y = 31;
  playerPosition.z = 7.5;
  const hotbarSlots = emptySlots();
  hotbarSlots[0] = { kind: 'material', material: 'bonemeal', count: 10 };
  useGameStore.setState({ worldMode: 'survival', hotbarSlots, selectedSlot: 0, notice: null });
  return w;
}

afterEach(() => {
  setActiveWorld(null);
  cameraRef.current = null;
  vi.restoreAllMocks();
});

describe('骨粉催熟', () => {
  it('随机下限 +2 阶段（Math.random = 0）', async () => {
    const w = setupCrop(0);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    await wait(160);
    expect(tryPlace()).toBe(true);
    expect(w.getBlock(4, 30, 4)).toBe(WHEAT_CROP_0 + 2);
    expect(useGameStore.getState().hotbarSlots[0]).toEqual({ kind: 'material', material: 'bonemeal', count: 9 });
  });

  it('随机上限 +5 阶段（Math.random → 1）', async () => {
    const w = setupCrop(0);
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    await wait(160);
    expect(tryPlace()).toBe(true);
    expect(w.getBlock(4, 30, 4)).toBe(WHEAT_CROP_0 + 5);
  });

  it('封顶第 7 阶段：6 期 + 骨粉 = 7 期成熟', async () => {
    const w = setupCrop(6);
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    await wait(160);
    expect(tryPlace()).toBe(true);
    expect(w.getBlock(4, 30, 4)).toBe(WHEAT_CROP_0 + 7);
  });

  it('已成熟（7 期）不消耗骨粉', async () => {
    const w = setupCrop(7);
    await wait(160);
    tryPlace();
    expect(w.getBlock(4, 30, 4)).toBe(WHEAT_CROP_0 + 7);
    expect(useGameStore.getState().hotbarSlots[0]).toEqual({ kind: 'material', material: 'bonemeal', count: 10 });
  });
});
