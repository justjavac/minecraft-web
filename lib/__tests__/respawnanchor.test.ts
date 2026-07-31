// 重生锚（MC）：荧石粉充能（上限 4 档）；下界已充能右键设重生点；死亡重生耗档、档尽/锚被挖失效；
// 主世界/末地右键爆炸（威力 5，同床的维度规则）；worldScope 注册（会话级，不落盘）

import { afterEach, describe, expect, it } from 'vitest';
import { Vector3, type Camera } from 'three';
import { breakBlock, tryPlace } from '../actions';
import { AIR, BLOCK_BY_KEY } from '../blocks';
import { cameraRef, playerPosition, setActiveWorld } from '../game';
import { VOID_TERRAIN } from '../noise';
import {
  clearAnchors,
  getAnchorCharge,
  MAX_ANCHOR_CHARGE,
  resolveAnchorRespawn,
  setAnchorCharge,
} from '../respawnanchor';
import { emptySlots, type Slot } from '../slots';
import { useGameStore } from '../store';
import { World } from '../world';
import { restoreWorldScopes, snapshotWorldScopes, worldScopeNames } from '../worldScope';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 站在 (4.5, 31, 7.5) 朝 -z 俯视 (4,30,4) 的重生锚 */
function mockCamera(): Camera {
  return {
    position: new Vector3(4.5, 31, 7.5),
    getWorldDirection: (v: Vector3) => v.set(0, -0.28, -1).normalize(),
  } as unknown as Camera;
}

function setup(held: Slot, dim: 'overworld' | 'nether' = 'overworld'): World {
  const terrain = dim === 'nether' ? { ...VOID_TERRAIN, kind: 'nether' as const } : VOID_TERRAIN;
  const w = new World(`anchor-${dim}`, undefined, terrain);
  w.setBlock(4, 30, 4, BLOCK_BY_KEY.respawn_anchor.id);
  setActiveWorld(w);
  cameraRef.current = mockCamera();
  playerPosition.x = 4.5;
  playerPosition.y = 31;
  playerPosition.z = 7.5;
  const hotbarSlots = emptySlots();
  hotbarSlots[0] = held;
  useGameStore.setState({ worldMode: 'survival', hotbarSlots, selectedSlot: 0, respawnPoint: null, notice: null, health: 20, dead: false });
  clearAnchors();
  return w;
}

afterEach(() => {
  setActiveWorld(null);
  cameraRef.current = null;
  clearAnchors();
});

describe('重生锚', () => {
  it('荧石粉右键充能：每次 +1，最多 4 档，充满后不再消耗', async () => {
    setup({ kind: 'material', material: 'glowstone_dust', count: 10 });
    for (let i = 1; i <= 4; i++) {
      await wait(160); // 放置冷却
      tryPlace();
      expect(getAnchorCharge(4, 30, 4)).toBe(i);
      expect(useGameStore.getState().notice).toBe(`重生锚充能 ${i}/4`);
    }
    expect(useGameStore.getState().hotbarSlots[0]).toEqual({ kind: 'material', material: 'glowstone_dust', count: 6 });
    await wait(160);
    tryPlace(); // 第 5 次：已充满
    expect(getAnchorCharge(4, 30, 4)).toBe(MAX_ANCHOR_CHARGE);
    expect(useGameStore.getState().hotbarSlots[0]).toEqual({ kind: 'material', material: 'glowstone_dust', count: 6 }); // 不再扣
    expect(useGameStore.getState().notice).toBe('重生锚已充满能量');
  });

  it('下界已充能时右键（空手/非荧石）：设重生点', async () => {
    setup(null, 'nether');
    setAnchorCharge(4, 30, 4, 3);
    await wait(160);
    tryPlace();
    expect(useGameStore.getState().respawnPoint).toEqual({ x: 4.5, y: 31, z: 4.5 });
    expect(useGameStore.getState().notice).toBe('重生点已设置');
    expect(getAnchorCharge(4, 30, 4)).toBe(3); // 设点不耗档（MC：死亡重生才耗）
  });

  it('下界未充能时右键：提示需要荧石粉充能，不设点不爆炸', async () => {
    const w = setup(null, 'nether');
    await wait(160);
    tryPlace();
    expect(useGameStore.getState().respawnPoint).toBeNull();
    expect(useGameStore.getState().notice).toBe('重生锚需要荧石粉充能');
    expect(w.getBlock(4, 30, 4)).toBe(BLOCK_BY_KEY.respawn_anchor.id); // 锚还在
  });

  it('主世界右键：爆炸（威力 5，同床维度规则），锚被炸掉并伤到玩家', async () => {
    const w = setup(null, 'overworld');
    setAnchorCharge(4, 30, 4, 2);
    await wait(160);
    tryPlace();
    expect(w.getBlock(4, 30, 4)).toBe(AIR); // 锚被炸掉
    expect(getAnchorCharge(4, 30, 4)).toBe(0); // 档位清空
    expect(useGameStore.getState().health).toBeLessThan(20); // 贴脸爆炸伤到玩家
    expect(useGameStore.getState().respawnPoint).toBeNull();
  });

  it('死亡重生耗档：有档耗 1 档（ok），耗掉最后一档 exhausted，0 档 depleted，非锚 not-anchor', () => {
    const w = setup(null, 'nether');
    const sp = { x: 4.5, y: 31, z: 4.5 };
    setAnchorCharge(4, 30, 4, 3);
    expect(resolveAnchorRespawn(w, sp)).toBe('ok');
    expect(getAnchorCharge(4, 30, 4)).toBe(2);
    setAnchorCharge(4, 30, 4, 1);
    expect(resolveAnchorRespawn(w, sp)).toBe('exhausted'); // 本次仍可回锚旁，但重生点失效
    expect(getAnchorCharge(4, 30, 4)).toBe(0);
    expect(resolveAnchorRespawn(w, sp)).toBe('depleted'); // 0 档：回世界出生点
    w.setBlock(4, 30, 4, AIR);
    expect(resolveAnchorRespawn(w, sp)).toBe('not-anchor'); // 锚没了：走床等原逻辑
  });

  it('锚被挖：档位清空且重生点失效（同床的 MC 规则）', () => {
    const w = setup(null, 'nether');
    setAnchorCharge(4, 30, 4, 2);
    useGameStore.getState().setRespawnPoint({ x: 4.5, y: 31, z: 4.5 });
    breakBlock(w, 4, 30, 4);
    expect(getAnchorCharge(4, 30, 4)).toBe(0);
    expect(useGameStore.getState().respawnPoint).toBeNull();
  });

  it('worldScope 注册：随维度切换暂存/恢复（会话级，存档 dims 不落盘）', () => {
    expect(worldScopeNames()).toContain('respawnanchor');
    setAnchorCharge(1, 2, 3, 2);
    const snap = snapshotWorldScopes();
    clearAnchors();
    expect(getAnchorCharge(1, 2, 3)).toBe(0);
    restoreWorldScopes(snap);
    expect(getAnchorCharge(1, 2, 3)).toBe(2);
  });
});
