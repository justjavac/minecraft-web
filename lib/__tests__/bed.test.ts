// 床：夜晚睡觉跳日出 + 设重生点 + 睡醒放晴；白天只设重生点（Java 1.15+）；雷暴白天可睡；
// 附近有怪物拒绝入睡；下界/末地右击爆炸

import { afterEach, describe, expect, it } from 'vitest';
import { Vector3, type Camera } from 'three';
import { tryPlace } from '../actions';
import { BLOCK_BY_KEY } from '../blocks';
import { cameraRef, playerPosition, setActiveWorld, worldClock } from '../game';
import { clearMobs, spawnMobAt } from '../mobs';
import { VOID_TERRAIN } from '../noise';
import { useGameStore } from '../store';
import { weather } from '../weather';
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
  useGameStore.setState({ worldMode: 'creative', respawnPoint: null, notice: null });
  return w;
}

afterEach(() => {
  setActiveWorld(null);
  cameraRef.current = null;
  clearMobs();
  weather.kind = 'clear';
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
    expect(useGameStore.getState().respawnPoint).toEqual({ x: 4.5, y: 31, z: 4.5 });
    expect(useGameStore.getState().notice).toBe('重生点已设置');
  });

  it('正午右键：只设重生点不睡觉（Java 1.15+），不跳时间', async () => {
    setup();
    worldClock.t = 0.25; // 正午
    await wait(160);
    tryPlace();
    expect(worldClock.t).toBe(0.25); // 不跳时间
    expect(useGameStore.getState().respawnPoint).toEqual({ x: 4.5, y: 31, z: 4.5 });
    expect(useGameStore.getState().notice).toBe('重生点已设置');
  });

  it('雷暴白天可睡（Java）：跳日出并放晴', async () => {
    setup();
    worldClock.t = 0.25; // 正午，平时不能睡
    weather.kind = 'thunder';
    await wait(160);
    tryPlace();
    expect(worldClock.t).toBe(0);
    expect(useGameStore.getState().respawnPoint).toEqual({ x: 4.5, y: 31, z: 4.5 });
    expect(weather.kind).toBe('clear'); // 睡醒放晴
  });

  it('夜晚睡觉时正在下雨：睡醒放晴（MC）', async () => {
    setup();
    worldClock.t = 0.75;
    weather.kind = 'rain';
    await wait(160);
    tryPlace();
    expect(worldClock.t).toBe(0);
    expect(weather.kind).toBe('clear');
  });

  it('夜晚水平 8 格/垂直 5 格内有敌对生物：拒绝入睡并提示（Java），不跳时间不设重生点', async () => {
    setup();
    worldClock.t = 0.75;
    spawnMobAt('zombie', 8.5, 30, 7.5); // 床边 4 格，在射线背后不被 mob 交互抢先
    await wait(160);
    tryPlace();
    expect(worldClock.t).toBe(0.75);
    expect(useGameStore.getState().respawnPoint).toBeNull();
    expect(useGameStore.getState().notice).toBe('你现在不能休息，附近有怪物在游荡');
  });

  it('远处的敌对生物（>8 格）不拦入睡；被动生物不拦', async () => {
    setup();
    worldClock.t = 0.75;
    spawnMobAt('zombie', 20.5, 30, 4.5); // 16 格外
    spawnMobAt('pig', 8.5, 30, 7.5); // 床边被动生物（在准星射线侧后方，不会被 mob 交互抢先）
    await wait(160);
    tryPlace();
    expect(worldClock.t).toBe(0);
    expect(useGameStore.getState().respawnPoint).toEqual({ x: 4.5, y: 31, z: 4.5 });
  });

  it('下界右击床：立刻爆炸（MC 维度规则），不跳时间、不设重生点、伤到玩家', async () => {
    const w = new World('bed-nether', undefined, { ...VOID_TERRAIN, kind: 'nether' });
    w.setBlock(4, 30, 4, BLOCK_BY_KEY.red_bed.id);
    setActiveWorld(w);
    cameraRef.current = mockCamera();
    // 玩家站在床边（与相机一致），否则伤害按 game.ts 默认 (0,0,0) 距离结算不到
    playerPosition.x = 4.5;
    playerPosition.y = 31;
    playerPosition.z = 7.5;
    useGameStore.setState({ worldMode: 'survival', respawnPoint: null, notice: null, health: 20, dead: false });
    worldClock.t = 0.25; // 维度判定优先于昼夜
    await wait(160);
    tryPlace();
    expect(w.getBlock(4, 30, 4)).toBe(0); // 床被炸掉
    expect(worldClock.t).toBe(0.25);
    expect(useGameStore.getState().respawnPoint).toBeNull();
    expect(useGameStore.getState().health).toBeLessThan(20); // 贴脸爆炸伤到玩家
  });
});
