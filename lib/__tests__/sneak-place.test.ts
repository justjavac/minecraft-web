// 潜行右键可交互方块（Java）：手持可放置方块 = 放置而不开界面；手空/手持不可放置物（工具/材料）保持开界面

import { afterEach, describe, expect, it } from 'vitest';
import { Vector3, type Camera } from 'three';
import { tryPlace } from '../actions';
import { BLOCK_BY_KEY, DIRT } from '../blocks';
import { cameraRef, playerPosition, setActiveWorld, touchInput } from '../game';
import { VOID_TERRAIN } from '../noise';
import { emptySlots, type Slot } from '../slots';
import { useGameStore } from '../store';
import { World } from '../world';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 站在 (4.5, 31, 7.5) 朝 -z 俯视 (4,30,4) 的箱子（命中 +z 面，放置位 (4,30,5)） */
function mockCamera(): Camera {
  return {
    position: new Vector3(4.5, 31, 7.5),
    getWorldDirection: (v: Vector3) => v.set(0, -0.28, -1).normalize(),
  } as unknown as Camera;
}

function setupChest(held: Slot): World {
  const w = new World('sneak-test', undefined, VOID_TERRAIN);
  w.setBlock(4, 30, 4, BLOCK_BY_KEY.chest.id);
  setActiveWorld(w);
  cameraRef.current = mockCamera();
  playerPosition.x = 4.5;
  playerPosition.y = 31;
  playerPosition.z = 7.5;
  const hotbarSlots = emptySlots();
  hotbarSlots[0] = held;
  useGameStore.setState({ worldMode: 'survival', hotbarSlots, selectedSlot: 0, storageOpen: null, notice: null });
  return w;
}

afterEach(() => {
  setActiveWorld(null);
  cameraRef.current = null;
  touchInput.sneak = false;
});

describe('潜行右键容器', () => {
  it('潜行 + 手持方块右键箱子：放置方块，不开容器界面（Java）', async () => {
    const w = setupChest({ kind: 'block', id: DIRT, count: 5 });
    touchInput.sneak = true;
    await wait(160); // 放置冷却
    expect(tryPlace()).toBe(true);
    expect(useGameStore.getState().storageOpen).toBeNull(); // 没开界面
    expect(w.getBlock(4, 30, 5)).toBe(DIRT); // 放在箱子 +z 面
    expect(useGameStore.getState().hotbarSlots[0]).toEqual({ kind: 'block', id: DIRT, count: 4 }); // 消耗 1 个
  });

  it('非潜行 + 手持方块右键箱子：开容器界面，不放置', async () => {
    const w = setupChest({ kind: 'block', id: DIRT, count: 5 });
    await wait(160);
    expect(tryPlace()).toBe(false);
    expect(useGameStore.getState().storageOpen).toBe('4,30,4');
    expect(w.getBlock(4, 30, 5)).toBe(0);
    expect(useGameStore.getState().hotbarSlots[0]).toEqual({ kind: 'block', id: DIRT, count: 5 });
  });

  it('潜行 + 空手右键箱子：保持开界面（Java）', async () => {
    setupChest(null);
    touchInput.sneak = true;
    await wait(160);
    expect(tryPlace()).toBe(false);
    expect(useGameStore.getState().storageOpen).toBe('4,30,4');
  });

  it('潜行 + 手持材料（不可放置）右键箱子：保持开界面（Java）', async () => {
    setupChest({ kind: 'material', material: 'iron_ingot', count: 3 });
    touchInput.sneak = true;
    await wait(160);
    expect(tryPlace()).toBe(false);
    expect(useGameStore.getState().storageOpen).toBe('4,30,4');
  });
});
