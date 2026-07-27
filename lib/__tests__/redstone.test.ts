// 红石供能：电源/粉传播衰减/灯亮灭/拉杆/门开关/TNT 引爆

import { beforeEach, describe, expect, it } from 'vitest';
import { AIR, BLOCK_BY_KEY, STONE } from '../blocks';
import { VOID_TERRAIN } from '../noise';
import { clearRedstone, dustPowerAt, poweredAt, toggleLever } from '../redstone';
import { clearTnt, primedTnt } from '../tnt';
import { World } from '../world';

const K = (k: string) => BLOCK_BY_KEY[k].id;

function setup(): World {
  clearRedstone();
  clearTnt();
  return new World('rs-test', undefined, VOID_TERRAIN);
}

beforeEach(() => {
  clearRedstone();
  clearTnt();
});

describe('红石粉传播', () => {
  it('红石火把供能邻接粉 15 级，沿粉逐级衰减', () => {
    const w = setup();
    w.setBlock(4, 30, 4, STONE);
    w.setBlock(4, 31, 4, K('redstone_torch'));
    // 粉链：(5..9, 31, 4)，下方垫石头（放粉规则无关，直接写）
    for (let x = 5; x <= 9; x++) {
      w.setBlock(x, 30, 4, STONE);
      w.setBlock(x, 31, 4, K('redstone_dust'));
    }
    expect(dustPowerAt(5, 31, 4)).toBe(15);
    expect(dustPowerAt(6, 31, 4)).toBe(14);
    expect(dustPowerAt(9, 31, 4)).toBe(11);
  });

  it('粉断开后功率清零', () => {
    const w = setup();
    w.setBlock(4, 30, 4, STONE);
    w.setBlock(4, 31, 4, K('redstone_torch'));
    for (let x = 5; x <= 9; x++) {
      w.setBlock(x, 30, 4, STONE);
      w.setBlock(x, 31, 4, K('redstone_dust'));
    }
    expect(dustPowerAt(7, 31, 4)).toBeGreaterThan(0);
    w.setBlock(6, 31, 4, AIR); // 截断粉链
    expect(dustPowerAt(7, 31, 4)).toBe(0);
    expect(dustPowerAt(5, 31, 4)).toBe(15); // 火把侧仍在
  });
});

describe('红石灯', () => {
  it('粉供能点亮，断能熄灭', () => {
    const w = setup();
    w.setBlock(4, 30, 4, STONE);
    w.setBlock(4, 31, 4, K('redstone_torch'));
    w.setBlock(5, 30, 4, STONE);
    w.setBlock(5, 31, 4, K('redstone_dust'));
    w.setBlock(6, 31, 4, K('redstone_lamp'));
    expect(w.getBlock(6, 31, 4)).toBe(K('redstone_lamp_lit'));
    w.setBlock(4, 31, 4, AIR); // 挖掉火把
    expect(w.getBlock(6, 31, 4)).toBe(K('redstone_lamp'));
  });

  it('红石块邻接直接点亮', () => {
    const w = setup();
    w.setBlock(6, 31, 4, K('redstone_lamp'));
    w.setBlock(5, 31, 4, K('redstone_block'));
    expect(w.getBlock(6, 31, 4)).toBe(K('redstone_lamp_lit'));
  });
});

describe('拉杆', () => {
  it('右击切换供能，灯随之亮灭', () => {
    const w = setup();
    w.setBlock(4, 31, 4, K('lever'));
    w.setBlock(5, 31, 4, K('redstone_lamp'));
    expect(w.getBlock(5, 31, 4)).toBe(K('redstone_lamp')); // 关着不供能
    expect(toggleLever(w, 4, 31, 4)).toBe(true);
    expect(w.getBlock(5, 31, 4)).toBe(K('redstone_lamp_lit'));
    expect(toggleLever(w, 4, 31, 4)).toBe(false);
    expect(w.getBlock(5, 31, 4)).toBe(K('redstone_lamp'));
  });
});

describe('门与 TNT', () => {
  it('供能开门、断能关门（上下两格同步）', () => {
    const w = setup();
    w.setBlock(4, 30, 4, STONE);
    const base = K('oak_door_bottom_n');
    w.setBlock(4, 31, 4, base);
    w.setBlock(4, 32, 4, base + 1);
    w.setBlock(3, 31, 4, K('redstone_torch'));
    expect(w.getBlock(4, 31, 4)).toBe(base + 2); // open_bottom
    expect(w.getBlock(4, 32, 4)).toBe(base + 3); // open_top
    w.setBlock(3, 31, 4, AIR);
    expect(w.getBlock(4, 31, 4)).toBe(base);
    expect(w.getBlock(4, 32, 4)).toBe(base + 1);
  });

  it('供能引爆 TNT（方块消失，生成引信实体）', () => {
    const w = setup();
    w.setBlock(4, 31, 4, K('tnt'));
    w.setBlock(3, 31, 4, K('redstone_torch'));
    expect(w.getBlock(4, 31, 4)).toBe(AIR);
    expect(primedTnt.length).toBe(1);
  });

  it('poweredAt 判定：邻接电源或有功率粉', () => {
    const w = setup();
    w.setBlock(4, 30, 4, STONE);
    w.setBlock(4, 31, 4, K('redstone_torch'));
    expect(poweredAt(5, 31, 4)).toBe(true);
    expect(poweredAt(8, 31, 8)).toBe(false);
  });
});
