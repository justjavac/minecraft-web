import { beforeEach, describe, expect, it } from 'vitest';
import { STONE } from '../blocks';
import { clearDrops, itemDrops, spawnBlockDrop, tickDrops } from '../items';
import { VOID_TERRAIN } from '../noise';
import { World } from '../world';

/** 64×64 石板地面（y=9）的测试世界 */
function floorWorld(): World {
  const w = new World('items', undefined, VOID_TERRAIN);
  for (let x = -32; x < 32; x++) {
    for (let z = -32; z < 32; z++) w.setBlock(x, 9, z, STONE);
  }
  return w;
}

const FAR_AWAY = { x: 500, y: 30, z: 500 };

describe('掉落物实体', () => {
  beforeEach(() => clearDrops());

  it('生成掉落物', () => {
    spawnBlockDrop(STONE, 0.5, 12, 0.5, 3);
    expect(itemDrops.length).toBe(1);
    expect(itemDrops[0].drop).toEqual({ kind: 'block', blockId: STONE });
    expect(itemDrops[0].count).toBe(3);
  });

  it('受重力落到地面并停稳', { timeout: 20000 }, () => {
    const w = floorWorld();
    spawnBlockDrop(STONE, 0.5, 14, 0.5);
    for (let i = 0; i < 100; i++) tickDrops(w, 0.05, FAR_AWAY, () => false);
    expect(itemDrops[0].velY).toBe(0);
    expect(itemDrops[0].y).toBeCloseTo(10.125, 2); // 地板 y=9 顶面 + 半格高
  });

  it('0.5 秒拾取延时：刚到不可拾，过了才拾取', () => {
    const w = floorWorld();
    spawnBlockDrop(STONE, 0.5, 10.5, 0.5, 2);
    const player = { x: 0.5, y: 10, z: 0.5 };
    itemDrops[0].age = 0.4;
    tickDrops(w, 0.05, player, () => true);
    expect(itemDrops.length).toBe(1); // 还在延时窗口内
    let picked = 0;
    tickDrops(w, 0.2, player, (d) => {
      picked = d.count;
      return true;
    });
    expect(picked).toBe(2); // 过了 0.5s 且距离够近
    expect(itemDrops.length).toBe(0);
  });

  it('拾取回调拒收时实体保留（背包满场景）', { timeout: 20000 }, () => {
    const w = floorWorld();
    spawnBlockDrop(STONE, 0.5, 10.5, 0.5);
    itemDrops[0].age = 1;
    tickDrops(w, 0.1, { x: 0.5, y: 10, z: 0.5 }, () => false);
    expect(itemDrops.length).toBe(1);
  });

  it('超过 5 分钟自动消失', () => {
    const w = floorWorld();
    spawnBlockDrop(STONE, 0.5, 10.5, 0.5);
    itemDrops[0].age = 299.9;
    tickDrops(w, 0.2, FAR_AWAY, () => false);
    expect(itemDrops.length).toBe(0);
  });
});
