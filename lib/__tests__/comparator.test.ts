// 红石比较器：比较模式（背向≥两侧→背向电平）、减法模式、侧向、模式切换、分级输出

import { beforeEach, describe, expect, it } from 'vitest';
import { BLOCK_BY_KEY, STONE } from '../blocks';
import { VOID_TERRAIN } from '../noise';
import { clearRedstone, dustPowerAt, tickRedstone, toggleComparatorMode, toggleLever } from '../redstone';
import { RECIPES } from '../recipes';
import { World } from '../world';

const K = (k: string) => BLOCK_BY_KEY[k].id;
const DUST = () => K('redstone_dust');

function setup(): World {
  clearRedstone();
  const w = new World('comparator-test', undefined, VOID_TERRAIN);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) w.getChunk(cx, cz);
  return w;
}

beforeEach(clearRedstone);

/** 粉链：火把 (0) → 粉 (1..n)，比较器朝东在 n+1，输出粉 n+2/n+3 */
function chainWithComparator(w: World, dustLen: number): void {
  w.setBlock(0, 30, 4, STONE);
  w.setBlock(0, 31, 4, K('redstone_torch'));
  for (let x = 1; x <= dustLen; x++) {
    w.setBlock(x, 30, 4, STONE);
    w.setBlock(x, 31, 4, DUST());
  }
  w.setBlock(dustLen + 1, 30, 4, STONE);
  w.setBlock(dustLen + 1, 31, 4, K('comparator_e'));
  w.setBlock(dustLen + 2, 30, 4, STONE);
  w.setBlock(dustLen + 2, 31, 4, DUST());
  w.setBlock(dustLen + 3, 30, 4, STONE);
  w.setBlock(dustLen + 3, 31, 4, DUST());
}

describe('比较器', () => {
  it('比较模式：背向电平原样输出（9 进 9 出，MC）', () => {
    const w = setup();
    chainWithComparator(w, 7); // 末端功率 9（火把 x0，粉 x1=15 逐格 -1）
    expect(dustPowerAt(7, 31, 4)).toBe(9);
    tickRedstone(w, 0.1);
    tickRedstone(w, 0.1); // 结算重播
    expect(w.getBlock(8, 31, 4)).toBe(K('comparator_on_e'));
    expect(dustPowerAt(9, 31, 4)).toBe(9);
    expect(dustPowerAt(10, 31, 4)).toBe(8);
  });

  it('侧向 ≥ 背向时比较模式输出 0（MC）', () => {
    const w = setup();
    chainWithComparator(w, 7); // 背向 8
    // 南侧向供 10（火把经粉接到比较器侧面）
    w.setBlock(8, 30, 6, STONE);
    w.setBlock(8, 31, 6, K('redstone_torch'));
    w.setBlock(8, 30, 5, STONE);
    w.setBlock(8, 31, 5, DUST()); // 侧向粉 = 15
    tickRedstone(w, 0.1);
    tickRedstone(w, 0.1);
    expect(dustPowerAt(9, 31, 4)).toBe(0); // 9 < 15 → 输出 0
    // 撤掉侧向：恢复输出 9
    w.setBlock(8, 31, 5, 0);
    w.setBlock(8, 31, 6, 0);
    tickRedstone(w, 0.1);
    tickRedstone(w, 0.1);
    expect(dustPowerAt(9, 31, 4)).toBe(9);
  });

  it('减法模式：输出 = 背向 − 侧向（9 − 0 → 9；9 − 15 → 0；9 − 6 → 3）', () => {
    const w = setup();
    chainWithComparator(w, 7); // 背向 9
    toggleComparatorMode(8, 31, 4); // 切减法
    tickRedstone(w, 0.1);
    tickRedstone(w, 0.1);
    expect(dustPowerAt(9, 31, 4)).toBe(9); // 无侧向：9 - 0 = 9
    // 侧向 15：火把直连比较器侧格
    w.setBlock(8, 30, 5, STONE);
    w.setBlock(8, 31, 5, DUST());
    w.setBlock(8, 30, 6, STONE);
    w.setBlock(8, 31, 6, K('redstone_torch'));
    tickRedstone(w, 0.1);
    tickRedstone(w, 0.1);
    expect(dustPowerAt(9, 31, 4)).toBe(0); // 9 - 15 → 0
    // 侧向降到 6（火把经 9 格粉衰减到侧面）：9 - 6 = 3
    w.setBlock(8, 31, 6, 0);
    w.setBlock(8, 31, 5, 0);
    w.setBlock(8, 30, 15, STONE);
    w.setBlock(8, 31, 15, K('redstone_torch'));
    for (let zz = 14; zz >= 5; zz--) {
      w.setBlock(8, 30, zz, STONE);
      w.setBlock(8, 31, zz, DUST());
    }
    tickRedstone(w, 0.1);
    tickRedstone(w, 0.1);
    expect(dustPowerAt(9, 31, 4)).toBe(3); // 9 - 6 = 3
  });

  it('拉杆经比较器点灯（端到端分级通过）', () => {
    const w = setup();
    w.setBlock(0, 30, 4, K('lever'));
    w.setBlock(1, 30, 4, K('comparator_e'));
    w.setBlock(2, 30, 4, STONE);
    w.setBlock(2, 31, 4, DUST());
    w.setBlock(3, 31, 4, K('redstone_lamp'));
    toggleLever(w, 0, 30, 4);
    tickRedstone(w, 0.1);
    tickRedstone(w, 0.1);
    expect(w.getBlock(3, 31, 4)).toBe(K('redstone_lamp_lit'));
  });

  it('比较器配方（MC：3 火把 + 1 石英 + 3 石头）', () => {
    const r = RECIPES.find((x) => x.id === 'comparator')!;
    expect(r.cost).toContainEqual({ item: `block:${K('redstone_torch')}`, count: 3 });
    expect(r.cost).toContainEqual({ item: 'material:quartz', count: 1 });
  });
});
