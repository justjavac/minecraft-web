// 重力方块（MC）：沙子/沙砾/混凝土粉末/铁砧/龙蛋失去支撑时下落；自然悬空沙仅在方块更新时坠落

import { afterEach, describe, expect, it } from 'vitest';
import { BLOCK_BY_KEY } from '../blocks';
import { checkGravityAt, clearGravity, tickGravity } from '../gravity';
import { clearDrops, itemDrops } from '../items';
import { VOID_TERRAIN } from '../noise';
import { World } from '../world';

afterEach(() => {
  clearGravity();
  clearDrops();
});

describe('重力方块下落', () => {
  it('挖掉支撑后沙子坠落到底；悬空沙子不更新不落', () => {
    const w = new World('gravity', undefined, VOID_TERRAIN);
    w.setBlock(4, 30, 4, BLOCK_BY_KEY.stone.id); // 地面
    w.setBlock(4, 33, 4, BLOCK_BY_KEY.sand.id); // 悬空沙（无支撑——自然状态可悬空）
    // 不触发更新：悬空保持
    tickGravity(w, 0.2);
    expect(w.getBlock(4, 33, 4)).toBe(BLOCK_BY_KEY.sand.id);
    // 触发支撑检查（模拟挖掉下方方块/方块更新）
    checkGravityAt(w, 4, 33, 4);
    for (let i = 0; i < 30; i++) tickGravity(w, 0.1);
    expect(w.getBlock(4, 33, 4)).toBe(0);
    expect(w.getBlock(4, 31, 4)).toBe(BLOCK_BY_KEY.sand.id); // 落在石头顶面
  });

  it('混凝土粉末/铁砧/龙蛋同样受重力；落在实心面停住', () => {
    const w = new World('gravity2', undefined, VOID_TERRAIN);
    w.setBlock(4, 30, 4, BLOCK_BY_KEY.stone.id);
    w.setBlock(4, 31, 4, BLOCK_BY_KEY.anvil.id); // 铁砧直接放在石头上：不落
    checkGravityAt(w, 4, 31, 4);
    tickGravity(w, 0.2);
    expect(w.getBlock(4, 31, 4)).toBe(BLOCK_BY_KEY.anvil.id);
    // 悬在更高的位置：落下
    w.setBlock(4, 35, 4, BLOCK_BY_KEY.white_concrete_powder.id);
    checkGravityAt(w, 4, 35, 4);
    for (let i = 0; i < 40; i++) tickGravity(w, 0.1);
    expect(w.getBlock(4, 32, 4)).toBe(BLOCK_BY_KEY.white_concrete_powder.id); // 落在铁砧顶
  });

  it('连锁失撑：整柱沙子依次落下', () => {
    const w = new World('gravity3', undefined, VOID_TERRAIN);
    w.setBlock(4, 30, 4, BLOCK_BY_KEY.stone.id);
    for (let y = 33; y <= 35; y++) w.setBlock(4, y, 4, BLOCK_BY_KEY.sand.id);
    checkGravityAt(w, 4, 33, 4); // 只查底格，连锁由下落触发
    for (let i = 0; i < 60; i++) tickGravity(w, 0.1);
    expect(w.getBlock(4, 31, 4)).toBe(BLOCK_BY_KEY.sand.id);
    expect(w.getBlock(4, 32, 4)).toBe(BLOCK_BY_KEY.sand.id);
    expect(w.getBlock(4, 33, 4)).toBe(BLOCK_BY_KEY.sand.id);
    expect(w.getBlock(4, 34, 4)).toBe(0);
  });
});

describe('落方块砸在非整格方块上碎成掉落物（MC）', () => {
  /** 在 (4,31,4) 放目标方块（下有石头托底），(4,35,4) 落沙子，返回世界 */
  function dropSandOn(targetId: number): World {
    const w = new World('gravity-shatter', undefined, VOID_TERRAIN);
    w.setBlock(4, 30, 4, BLOCK_BY_KEY.stone.id);
    w.setBlock(4, 31, 4, targetId);
    w.setBlock(4, 35, 4, BLOCK_BY_KEY.sand.id);
    checkGravityAt(w, 4, 35, 4);
    for (let i = 0; i < 30; i++) tickGravity(w, 0.1);
    return w;
  }

  function expectSandDrop(): void {
    expect(itemDrops.length).toBe(1);
    expect(itemDrops[0].drop).toEqual({ kind: 'block', blockId: BLOCK_BY_KEY.sand.id });
  }

  it('沙子砸火把：碎成掉落物，火把保留', () => {
    const w = dropSandOn(BLOCK_BY_KEY.torch.id);
    expect(w.getBlock(4, 31, 4)).toBe(BLOCK_BY_KEY.torch.id); // 火把不被穿过/覆盖
    expect(w.getBlock(4, 32, 4)).toBe(0); // 沙子没有放置
    expect(w.getBlock(4, 35, 4)).toBe(0);
    expectSandDrop();
  });

  it('沙子砸半砖（实心下半砖）：同样碎成掉落物', () => {
    const w = dropSandOn(BLOCK_BY_KEY.stone_slab.id);
    expect(w.getBlock(4, 31, 4)).toBe(BLOCK_BY_KEY.stone_slab.id);
    expect(w.getBlock(4, 32, 4)).toBe(0);
    expectSandDrop();
  });

  it('沙子砸积雪层：碎成掉落物', () => {
    const w = dropSandOn(BLOCK_BY_KEY.snow_layer.id);
    expect(w.getBlock(4, 31, 4)).toBe(BLOCK_BY_KEY.snow_layer.id);
    expect(w.getBlock(4, 32, 4)).toBe(0);
    expectSandDrop();
  });

  it('穿过空气/水行为不变：落到水底实心面正常放置，无掉落物', () => {
    const w = new World('gravity-water', undefined, VOID_TERRAIN);
    w.setBlock(4, 30, 4, BLOCK_BY_KEY.stone.id);
    w.setBlock(4, 31, 4, BLOCK_BY_KEY.water.id);
    w.setBlock(4, 32, 4, BLOCK_BY_KEY.water.id);
    w.setBlock(4, 35, 4, BLOCK_BY_KEY.sand.id);
    checkGravityAt(w, 4, 35, 4);
    for (let i = 0; i < 30; i++) tickGravity(w, 0.1);
    expect(w.getBlock(4, 31, 4)).toBe(BLOCK_BY_KEY.sand.id); // 穿过水落在石头顶面
    expect(itemDrops.length).toBe(0);
  });

  it('落实心格正常放置（不碎）', () => {
    const w = dropSandOn(BLOCK_BY_KEY.stone.id);
    expect(w.getBlock(4, 32, 4)).toBe(BLOCK_BY_KEY.sand.id); // 落在石头柱顶
    expect(itemDrops.length).toBe(0);
  });
});

describe('下落加速（MC 掉落实体持续加速的离散近似）', () => {
  it('连续下落步进间隔逐格递减至 0.06s 下限；高落差远快于原匀速 0.4s/格', () => {
    const w = new World('gravity-accel', undefined, VOID_TERRAIN);
    w.setBlock(4, 10, 4, BLOCK_BY_KEY.stone.id); // 地面
    w.setBlock(4, 40, 4, BLOCK_BY_KEY.sand.id); // 30 格高落差
    checkGravityAt(w, 4, 40, 4);
    const sandId = BLOCK_BY_KEY.sand.id;
    const sandY = (): number => {
      for (let y = 40; y >= 11; y--) if (w.getBlock(4, y, 4) === sandId) return y;
      return -1;
    };
    // 逐步推进并记录每格下落完成的时间
    const moveTimes: number[] = [];
    let lastY = 40;
    let t = 0;
    const dt = 0.02;
    while (t < 8 && lastY !== 11) {
      tickGravity(w, dt);
      t += dt;
      const y = sandY();
      if (y !== lastY) {
        moveTimes.push(t);
        lastY = y;
      }
    }
    expect(lastY).toBe(11); // 落满 29 格停在石头顶面
    expect(moveTimes.length).toBe(29);
    // 首格间隔 ≈0.4s（与原匀速节奏一致，起落不变快）
    expect(moveTimes[0]).toBeGreaterThanOrEqual(0.38);
    expect(moveTimes[0]).toBeLessThan(0.44);
    const gaps = moveTimes.slice(1).map((mt, i) => mt - moveTimes[i]);
    // 间隔递减：第二格（≈0.28s）明显快于首格（0.4s）
    expect(gaps[0]).toBeLessThan(0.34);
    // 单调不增（允许一个 dt 的量化误差）
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeLessThanOrEqual(gaps[i - 1] + dt + 1e-9);
    // 末段达到下限 ~0.06s/格
    expect(Math.min(...gaps)).toBeLessThanOrEqual(0.08);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(0.04);
    // 高落差整体远快于匀速：29 格匀速需 29×0.4=11.6s，加速后 <4s
    expect(moveTimes[28]).toBeLessThan(4);
  });

  it('中断重置：落地后再次失撑重新下落时回到首格慢节奏', () => {
    const w = new World('gravity-accel-reset', undefined, VOID_TERRAIN);
    w.setBlock(4, 10, 4, BLOCK_BY_KEY.stone.id);
    w.setBlock(4, 20, 4, BLOCK_BY_KEY.sand.id);
    checkGravityAt(w, 4, 20, 4);
    for (let i = 0; i < 100; i++) tickGravity(w, 0.05); // 落定到 y=11
    expect(w.getBlock(4, 11, 4)).toBe(BLOCK_BY_KEY.sand.id);
    // 挖掉脚下石头 → 再次失撑下落：首步仍需 ~0.4s（不延续上次的加速状态）
    w.setBlock(4, 10, 4, 0);
    checkGravityAt(w, 4, 11, 4);
    tickGravity(w, 0.2);
    expect(w.getBlock(4, 11, 4)).toBe(BLOCK_BY_KEY.sand.id); // 0.2s < 0.4s：尚未起步
    for (let i = 0; i < 30; i++) tickGravity(w, 0.05);
    expect(w.getBlock(4, 11, 4)).toBe(0); // 已坠落出世界/落到更深处
  });
});

