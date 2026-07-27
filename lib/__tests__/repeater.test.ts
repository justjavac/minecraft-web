// 红石中继器：信号再生（满 15 级）、定向输出、延迟翻转、去抖、调档

import { beforeEach, describe, expect, it } from 'vitest';
import { BLOCK_BY_KEY, STONE } from '../blocks';
import { VOID_TERRAIN } from '../noise';
import { clearRedstone, cycleRepeaterDelay, dustPowerAt, tickRedstone, toggleLever } from '../redstone';
import { RECIPES } from '../recipes';
import { World } from '../world';

const K = (k: string) => BLOCK_BY_KEY[k].id;
const DUST = () => K('redstone_dust');

function setup(): World {
  clearRedstone();
  const w = new World('repeater-test', undefined, VOID_TERRAIN);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) w.getChunk(cx, cz);
  return w;
}

beforeEach(clearRedstone);

/** 摆一条 x 向粉链：火把 (x0) → 粉 (x0+1..x1)，末端接中继器（朝东输出） */
function chainWithRepeater(w: World, dustLen: number): void {
  w.setBlock(0, 30, 4, STONE);
  w.setBlock(0, 31, 4, K('redstone_torch'));
  for (let x = 1; x <= dustLen; x++) {
    w.setBlock(x, 30, 4, STONE);
    w.setBlock(x, 31, 4, DUST());
  }
  w.setBlock(dustLen + 1, 30, 4, STONE);
  w.setBlock(dustLen + 1, 31, 4, K('repeater_e')); // 背向 -x 接粉，输出 +x
  w.setBlock(dustLen + 2, 30, 4, STONE);
  w.setBlock(dustLen + 2, 31, 4, DUST());
  w.setBlock(dustLen + 3, 30, 4, STONE);
  w.setBlock(dustLen + 3, 31, 4, DUST());
}

describe('中继器', () => {
  it('信号再生：衰减到 1 的输入，输出恢复满 15 级（MC 核心特性）', () => {
    const w = setup();
    chainWithRepeater(w, 14); // 粉链 14 格，末端功率衰减到 2
    expect(dustPowerAt(14, 31, 4)).toBe(2);
    // 中继器翻转后：输出端满 15
    for (let i = 0; i < 4; i++) tickRedstone(w, 0.1);
    expect(w.getBlock(15, 31, 4)).toBe(K('repeater_on_e'));
    expect(dustPowerAt(16, 31, 4)).toBe(15);
    expect(dustPowerAt(17, 31, 4)).toBe(14);
  });

  it('定向输出：只向输出方向供能，侧向/背向不带电', () => {
    const w = setup();
    chainWithRepeater(w, 5);
    for (let i = 0; i < 4; i++) tickRedstone(w, 0.1);
    expect(w.getBlock(6, 31, 4)).toBe(K('repeater_on_e'));
    // 侧向与背向格无粉可测：在侧向放粉验证不得电
    w.setBlock(6, 30, 5, STONE);
    w.setBlock(6, 31, 5, DUST());
    expect(dustPowerAt(6, 31, 5)).toBe(0);
    expect(dustPowerAt(7, 31, 4)).toBe(15); // 输出端正带 15
  });

  it('延迟翻转：档位内不翻，到期才翻（去抖不回摆）', () => {
    const w = setup();
    chainWithRepeater(w, 5);
    // 立即检查：尚未到 1 档（0.1s）延迟 → 还是关
    expect(w.getBlock(6, 31, 4)).toBe(K('repeater_e'));
    tickRedstone(w, 0.2); // 过 1 档
    expect(w.getBlock(6, 31, 4)).toBe(K('repeater_on_e'));
    // 调到 4 档后关断输入：0.2s 内不翻，0.5s 后翻回
    cycleRepeaterDelay(6, 31, 4);
    cycleRepeaterDelay(6, 31, 4);
    cycleRepeaterDelay(6, 31, 4); // 1→2→3→4
    w.setBlock(0, 31, 4, STONE); // 挖掉火把（同时换掉红石火把）
    tickRedstone(w, 0.2);
    expect(w.getBlock(6, 31, 4)).toBe(K('repeater_on_e')); // 4 档未到
    for (let i = 0; i < 4; i++) tickRedstone(w, 0.1);
    expect(w.getBlock(6, 31, 4)).toBe(K('repeater_e')); // 到期翻回关
  });

  it('调档循环 1→2→3→4→1', () => {
    expect(cycleRepeaterDelay(1, 2, 3)).toBe(2);
    expect(cycleRepeaterDelay(1, 2, 3)).toBe(3);
    expect(cycleRepeaterDelay(1, 2, 3)).toBe(4);
    expect(cycleRepeaterDelay(1, 2, 3)).toBe(1);
  });

  it('拉杆经中继器点灯（端到端）', () => {
    const w = setup();
    w.setBlock(0, 30, 4, K('lever'));
    w.setBlock(1, 30, 4, K('repeater_e'));
    w.setBlock(2, 30, 4, STONE);
    w.setBlock(2, 31, 4, DUST());
    w.setBlock(3, 31, 4, K('redstone_lamp'));
    toggleLever(w, 0, 30, 4); // 开
    for (let i = 0; i < 4; i++) tickRedstone(w, 0.1);
    expect(w.getBlock(3, 31, 4)).toBe(K('redstone_lamp_lit'));
    toggleLever(w, 0, 30, 4); // 关
    for (let i = 0; i < 4; i++) tickRedstone(w, 0.1);
    expect(w.getBlock(3, 31, 4)).toBe(K('redstone_lamp'));
  });

  it('中继器配方（MC：2 火把 + 1 红石 + 3 石头）', () => {
    const r = RECIPES.find((x) => x.id === 'repeater')!;
    expect(r.cost).toContainEqual({ item: `block:${K('redstone_torch')}`, count: 2 });
    expect(r.cost).toContainEqual({ item: 'material:redstone', count: 1 });
  });
});
