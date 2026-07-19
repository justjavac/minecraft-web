// 床：夜晚右键睡觉跳日出 + 设重生点；白天拒绝

import { afterEach, describe, expect, it } from 'vitest';
import { Vector3, type Camera } from 'three';
import { tryPlace } from '../actions';
import { BLOCK_BY_KEY } from '../blocks';
import { cameraRef, setActiveWorld, worldClock } from '../game';
import { VOID_TERRAIN } from '../noise';
import { useGameStore } from '../store';
import { World } from '../world';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 站在 (4.5, 31, 7.5) 朝 -z 看 (4,30,4) 的床 */
function mockCamera(): Camera {
  return {
    position: new Vector3(4.5, 31, 7.5),
    getWorldDirection: (v: Vector3) => v.set(0, -0.28, -1).normalize(),
  } as unknown as Camera;
}

function setup(): World {
  const w = new World('bed-test', undefined, VOID_TERRAIN);
  w.setBlock(4, 30, 4, BLOCK_BY_KEY.red_bed.id);
  setActiveWorld(w);
  cameraRef.current = mockCamera();
  useGameStore.setState({ worldMode: 'creative', spawnPoint: null, notice: null });
  return w;
}

afterEach(() => {
  setActiveWorld(null);
  cameraRef.current = null;
});

describe('床', () => {
  it('方块定义：半高台阶形，不参与台阶合并', () => {
    const def = BLOCK_BY_KEY.red_bed;
    expect(def.shape).toBe('slab');
    expect(def.fullBlock).toBeUndefined();
  });

  it('午夜右键：跳到日出并设置重生点', async () => {
    setup();
    worldClock.t = 0.75; // 午夜
    await wait(160); // 放置冷却
    tryPlace();
    expect(worldClock.t).toBe(0);
    expect(useGameStore.getState().spawnPoint).toEqual({ x: 4.5, y: 31, z: 4.5 });
    expect(useGameStore.getState().notice).toBe('重生点已设置');
  });

  it('正午右键：拒绝并提示', async () => {
    setup();
    worldClock.t = 0.25; // 正午
    await wait(160);
    tryPlace();
    expect(worldClock.t).toBe(0.25);
    expect(useGameStore.getState().spawnPoint).toBeNull();
    expect(useGameStore.getState().notice).toBe('只能在夜晚睡觉');
  });
});
