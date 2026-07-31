// 下界维度规则（MC）：放水瞬间蒸发（不消耗）；湿海绵在下界被烤成干海绵

import { afterEach, describe, expect, it } from 'vitest';
import { Vector3, type Camera } from 'three';
import { tryPlace } from '../actions';
import { AIR, BLOCK_BY_KEY, WATER } from '../blocks';
import { cameraRef, setActiveWorld } from '../game';
import { VOID_TERRAIN } from '../noise';
import { emptySlots } from '../slots';
import { useGameStore } from '../store';
import { World } from '../world';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 站在 (4.5, 41, 7.5) 朝 -z 看 (4,40,4)（放置目标面；高处避开下界世界生成的岩浆海 y31） */
function mockCamera(): Camera {
  return {
    position: new Vector3(4.5, 41, 7.5),
    getWorldDirection: (v: Vector3) => v.set(0, -0.28, -1).normalize(),
  } as unknown as Camera;
}

function setupNether(): World {
  const w = new World('nether-evap', undefined, { ...VOID_TERRAIN, kind: 'nether' });
  w.setBlock(4, 40, 4, BLOCK_BY_KEY.stone.id); // 地面目标（y40，高于岩浆海）
  setActiveWorld(w);
  cameraRef.current = mockCamera();
  return w;
}

afterEach(() => {
  setActiveWorld(null);
  cameraRef.current = null;
});

describe('下界放水蒸发（MC）', () => {
  it('下界放水：蒸发不放置、不消耗、给提示', async () => {
    const w = setupNether();
    const slots = emptySlots();
    slots[0] = { kind: 'block', id: WATER, count: 2 };
    useGameStore.setState({ worldMode: 'survival', hotbarSlots: slots, selectedSlot: 0, notice: null });
    await wait(160);
    tryPlace();
    expect(w.getBlock(4, 40, 5)).toBe(AIR); // 放置格（命中南面）没有水
    expect(useGameStore.getState().hotbarSlots[0]).toEqual({ kind: 'block', id: WATER, count: 2 }); // 未消耗
    expect(useGameStore.getState().notice).toContain('蒸发');
  });

  it('湿海绵在下界：放下变干海绵（MC）', async () => {
    const w = setupNether();
    const slots = emptySlots();
    slots[0] = { kind: 'block', id: BLOCK_BY_KEY.wet_sponge.id, count: 1 };
    useGameStore.setState({ worldMode: 'survival', hotbarSlots: slots, selectedSlot: 0, notice: null });
    await wait(160);
    tryPlace();
    expect(w.getBlock(4, 40, 5)).toBe(BLOCK_BY_KEY.sponge.id); // 放置格（命中南面）是干海绵
    expect(useGameStore.getState().hotbarSlots[0]).toBeNull(); // 已消耗
  });
});
