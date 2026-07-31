import { beforeEach, describe, expect, it } from 'vitest';
import { STONE, DIRT } from '../blocks';
import { clearDrops, itemDrops, spawnArmorDrop, spawnBlockDrop, spawnMaterialDrop, spawnToolDrop, tickDrops } from '../items';
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

describe('掉落物合并', () => {
  beforeEach(() => clearDrops());

  it('1 格内同种方块掉落合并 count', () => {
    spawnBlockDrop(STONE, 0.5, 10.5, 0.5, 3);
    spawnBlockDrop(STONE, 1.0, 10.5, 0.5, 2);
    expect(itemDrops.length).toBe(1);
    expect(itemDrops[0].count).toBe(5);
  });

  it('同种材料掉落同样合并', () => {
    spawnMaterialDrop('wheat', 0.5, 10.5, 0.5, 2);
    spawnMaterialDrop('wheat', 0.5, 11.0, 0.5, 1);
    expect(itemDrops.length).toBe(1);
    expect(itemDrops[0].count).toBe(3);
  });

  it('超过合并半径不合并', () => {
    spawnBlockDrop(STONE, 0.5, 10.5, 0.5, 3);
    spawnBlockDrop(STONE, 2.5, 10.5, 0.5, 2);
    expect(itemDrops.length).toBe(2);
  });

  it('不同种掉落不合并', () => {
    spawnBlockDrop(STONE, 0.5, 10.5, 0.5, 3);
    spawnBlockDrop(DIRT, 0.5, 10.5, 0.5, 2);
    spawnMaterialDrop('wheat_seeds', 0.5, 10.5, 0.5, 1);
    expect(itemDrops.length).toBe(3);
  });

  it('堆叠上限 64：超出部分生成新实体', () => {
    spawnBlockDrop(STONE, 0.5, 10.5, 0.5, 60);
    spawnBlockDrop(STONE, 0.5, 10.5, 0.5, 10);
    expect(itemDrops.length).toBe(2);
    expect(itemDrops[0].count).toBe(64);
    expect(itemDrops[1].count).toBe(6);
  });

  it('合并保留被并入堆的原年龄（Java：不刷新消失计时，防止合并续命）', () => {
    spawnBlockDrop(STONE, 0.5, 10.5, 0.5, 1);
    itemDrops[0].age = 100;
    spawnBlockDrop(STONE, 0.5, 10.5, 0.5, 1);
    expect(itemDrops.length).toBe(1);
    expect(itemDrops[0].age).toBe(100);
  });

  it('工具/装备有个体差异（耐久/附魔），不合并', () => {
    spawnToolDrop('wooden_pickaxe', 0.5, 10.5, 0.5, 30);
    spawnToolDrop('wooden_pickaxe', 0.5, 10.5, 0.5, 58);
    spawnArmorDrop('chestplate', 0.5, 10.5, 0.5, 80, 'iron');
    spawnArmorDrop('chestplate', 0.5, 10.5, 0.5, 240, 'iron');
    expect(itemDrops.length).toBe(4);
  });
});
