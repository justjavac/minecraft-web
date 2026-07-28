// 红石供能：电源/粉传播衰减/灯亮灭/拉杆/门开关/TNT 引爆/火把反相/弱充能

import { beforeEach, describe, expect, it } from 'vitest';
import { AIR, BLOCK_BY_KEY, STONE } from '../blocks';
import { VOID_TERRAIN } from '../noise';
import { clearRedstone, dustPowerAt, poweredAt, rescanSources, tickRedstone, toggleLever } from '../redstone';
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

describe('中继器定向供电', () => {
  it('on 态中继器只对输出面朝的邻位供电（MC）；火把/红石块全向', () => {
    const w = setup();
    w.setBlock(4, 31, 4, K('repeater_on_e')); // 输出朝 +x
    expect(poweredAt(5, 31, 4)).toBe(true); // 输出面
    expect(poweredAt(3, 31, 4)).toBe(false); // 背面不供
    expect(poweredAt(4, 31, 5)).toBe(false); // 侧面不供
    expect(poweredAt(4, 32, 4)).toBe(false); // 顶面不供
    // 全向电源对照：红石块 6 邻位都供电
    w.setBlock(10, 31, 4, K('redstone_block'));
    expect(poweredAt(10, 32, 4)).toBe(true);
    expect(poweredAt(10, 31, 5)).toBe(true);
  });
});

describe('长链路', () => {
  it('按建造顺序布 30 格链（粉15+中继器+粉15）：远端不被误清；上游断开后远端清零（无幽灵信号）', () => {
    const w = setup();
    w.setBlock(0, 30, 4, STONE);
    w.setBlock(0, 31, 4, K('redstone_torch'));
    for (let x = 1; x <= 15; x++) {
      w.setBlock(x, 30, 4, STONE);
      w.setBlock(x, 31, 4, K('redstone_dust'));
    }
    w.setBlock(16, 30, 4, STONE);
    w.setBlock(16, 31, 4, K('repeater_e'));
    for (let x = 17; x <= 31; x++) {
      w.setBlock(x, 30, 4, STONE);
      w.setBlock(x, 31, 4, K('redstone_dust'));
    }
    for (let i = 0; i < 4; i++) tickRedstone(w, 0.1);
    // 远端功率不被局部重算误清：中继器正常翻开，末端带电
    expect(w.getBlock(16, 31, 4)).toBe(K('repeater_on_e'));
    expect(dustPowerAt(31, 31, 4)).toBeGreaterThan(0);
    // 上游断开：功率沿链路级联清零，远端不留幽灵信号
    w.setBlock(0, 31, 4, AIR);
    for (let i = 0; i < 6; i++) tickRedstone(w, 0.1);
    expect(dustPowerAt(15, 31, 4)).toBe(0);
    expect(dustPowerAt(31, 31, 4)).toBe(0);
  });
});

describe('电源重扫持久化', () => {
  it('clearRedstone 后 rescanSources 重建登记：火把/拉杆/中继器恢复供能', () => {
    const w = setup();
    w.setBlock(4, 30, 4, STONE);
    w.setBlock(4, 31, 4, K('redstone_torch'));
    w.setBlock(5, 30, 4, STONE);
    w.setBlock(5, 31, 4, K('redstone_dust'));
    w.setBlock(6, 31, 4, K('redstone_lamp'));
    w.setBlock(8, 31, 4, K('lever'));
    toggleLever(w, 8, 31, 4);
    expect(w.getBlock(6, 31, 4)).toBe(K('redstone_lamp_lit'));
    expect(poweredAt(9, 31, 4)).toBe(true);
    // 模拟换维度/读档：内存供能态清空，方块仍在
    clearRedstone();
    expect(dustPowerAt(5, 31, 4)).toBe(0);
    expect(poweredAt(9, 31, 4)).toBe(false);
    rescanSources(w);
    // 电源恢复登记，粉网络与灯恢复供能
    expect(dustPowerAt(5, 31, 4)).toBe(15);
    expect(poweredAt(9, 31, 4)).toBe(true);
    expect(w.getBlock(6, 31, 4)).toBe(K('redstone_lamp_lit'));
    // 再挖掉火把，灯正常熄灭（登记表在正常工作）
    w.setBlock(4, 31, 4, AIR);
    expect(w.getBlock(6, 31, 4)).toBe(K('redstone_lamp'));
  });
});

describe('红石火把反相（NOT 门）', () => {
  it('附着方块被拉杆充能时火把熄灭断供，失去充能复亮（MC）', () => {
    const w = setup();
    w.setBlock(4, 30, 4, STONE); // 火把的支撑块
    w.setBlock(4, 31, 4, K('redstone_torch'));
    w.setBlock(5, 30, 4, STONE);
    w.setBlock(5, 31, 4, K('redstone_dust'));
    w.setBlock(3, 30, 4, K('lever')); // 拉杆贴着支撑块
    expect(dustPowerAt(5, 31, 4)).toBe(15); // 初始火把供电
    toggleLever(w, 3, 30, 4); // 开：支撑块被充能 → 火把反相熄灭
    expect(w.getBlock(4, 31, 4)).toBe(K('redstone_torch_off'));
    tickRedstone(w, 0.1); // 结算重播：下游粉断供（等价 MC 火把延迟）
    expect(dustPowerAt(5, 31, 4)).toBe(0);
    toggleLever(w, 3, 30, 4); // 关：支撑块失能 → 火把复亮
    expect(w.getBlock(4, 31, 4)).toBe(K('redstone_torch'));
    tickRedstone(w, 0.1);
    expect(dustPowerAt(5, 31, 4)).toBe(15);
  });

  it('附着块被带电粉充能同样反相（粉驱动的 NOT 门）', () => {
    const w = setup();
    w.setBlock(0, 30, 4, K('redstone_torch')); // 火把 A（悬空直接写）
    w.setBlock(1, 30, 4, K('redstone_dust'));
    w.setBlock(2, 30, 4, STONE); // 火把 B 的支撑，贴着带电粉
    w.setBlock(2, 31, 4, K('redstone_torch')); // 火把 B
    expect(w.getBlock(0, 30, 4)).toBe(K('redstone_torch')); // A 支撑是空气，不受影响
    expect(w.getBlock(2, 31, 4)).toBe(K('redstone_torch_off')); // B 反相熄灭
    w.setBlock(1, 30, 4, AIR); // 撤粉
    expect(w.getBlock(2, 31, 4)).toBe(K('redstone_torch')); // B 复亮
  });

  it('火把塔交替：下火把充能正上方块，坐在上面的火把熄灭（MC 弱充能上传）', () => {
    const w = setup();
    w.setBlock(4, 30, 4, STONE);
    w.setBlock(4, 31, 4, K('redstone_torch')); // T1
    w.setBlock(4, 32, 4, STONE); // T1 正上方块（被弱充能）
    w.setBlock(4, 33, 4, K('redstone_torch')); // T2 坐在其上 → 熄灭
    expect(w.getBlock(4, 33, 4)).toBe(K('redstone_torch_off'));
    expect(w.getBlock(4, 31, 4)).toBe(K('redstone_torch')); // T1 支撑未被充能，保持亮
  });
});

describe('固体方块弱充能', () => {
  it('拉杆→方块→粉 链路导通；关断即断供（MC）', () => {
    const w = setup();
    w.setBlock(4, 30, 4, STONE); // 拉杆的支撑块
    w.setBlock(4, 31, 4, K('lever'));
    w.setBlock(5, 29, 4, STONE);
    w.setBlock(5, 30, 4, K('redstone_dust')); // 贴着石块，不贴着拉杆
    w.setBlock(6, 29, 4, STONE);
    w.setBlock(6, 30, 4, K('redstone_dust'));
    expect(dustPowerAt(5, 30, 4)).toBe(0);
    toggleLever(w, 4, 31, 4);
    expect(dustPowerAt(5, 30, 4)).toBe(15); // 石块弱充能 → 邻接粉 15
    expect(dustPowerAt(6, 30, 4)).toBe(14); // 沿粉衰减
    toggleLever(w, 4, 31, 4);
    expect(dustPowerAt(5, 30, 4)).toBe(0);
  });

  it('弱充能方块驱动邻接元件（灯），且弱充能不链式外传（方块→方块不传）', () => {
    const w = setup();
    w.setBlock(4, 30, 4, STONE); // A：拉杆支撑
    w.setBlock(4, 31, 4, K('lever'));
    w.setBlock(4, 29, 4, STONE); // B：贴着 A
    w.setBlock(5, 28, 4, STONE);
    w.setBlock(5, 29, 4, K('redstone_dust')); // 贴着 B，不贴着 A
    w.setBlock(3, 30, 4, K('redstone_lamp')); // 贴着 A，不贴着拉杆
    toggleLever(w, 4, 31, 4);
    expect(w.getBlock(3, 30, 4)).toBe(K('redstone_lamp_lit')); // A 弱充能 → 灯亮
    expect(dustPowerAt(5, 29, 4)).toBe(0); // B 不被充能：弱充能只一层（MC 简化）
    expect(poweredAt(3, 30, 4)).toBe(true);
    toggleLever(w, 4, 31, 4);
    expect(w.getBlock(3, 30, 4)).toBe(K('redstone_lamp'));
  });

  it('中继器输出充能前方实心块，块外粉导通（MC 强充能简化同层处理）', () => {
    const w = setup();
    w.setBlock(4, 31, 4, K('repeater_on_e')); // 输出 +x
    w.setBlock(5, 31, 4, STONE); // 被弱充能
    w.setBlock(6, 30, 4, STONE);
    w.setBlock(6, 31, 4, K('redstone_dust')); // 贴着石块
    expect(dustPowerAt(6, 31, 4)).toBe(15);
    expect(poweredAt(5, 32, 4)).toBe(true); // 石块邻位视为供能
  });
});
