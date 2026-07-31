// 重力方块（MC）：沙子/沙砾/混凝土粉末/铁砧/龙蛋失去支撑时下落；自然悬空沙仅在方块更新时坠落

import { afterEach, describe, expect, it } from 'vitest';
import { BLOCK_BY_KEY } from '../blocks';
import { checkGravityAt, clearGravity, tickGravity } from '../gravity';
import { VOID_TERRAIN } from '../noise';
import { World } from '../world';

afterEach(() => clearGravity());

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
