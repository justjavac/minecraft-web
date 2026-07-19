// 非立方体形状：碰撞盒 / 网格面数（台阶合并剔除、楼梯面数、栅栏臂、十字面片）

import { describe, expect, it } from 'vitest';
import { BLOCK_BY_KEY, STONE } from '../blocks';
import { buildChunkGeometry } from '../mesher';
import { VOID_TERRAIN } from '../noise';
import { aabbFree, blockBox } from '../physics';
import { World } from '../world';

function voidWorld(): World {
  return new World('shapes', undefined, VOID_TERRAIN);
}

describe('形状碰撞盒', () => {
  it('台阶底 [0,0.5] / 台阶顶 [0.5,1] / 栅栏 [0,1.5] / 花草无碰撞', () => {
    expect(blockBox(BLOCK_BY_KEY.stone_slab.id)).toEqual([0, 0, 0, 1, 0.5, 1]);
    expect(blockBox(BLOCK_BY_KEY.stone_slab_top.id)).toEqual([0, 0.5, 0, 1, 1, 1]);
    expect(blockBox(BLOCK_BY_KEY.oak_fence.id)).toEqual([0, 0, 0, 1, 1.5, 1]);
    expect(blockBox(BLOCK_BY_KEY.dandelion.id)).toBeNull();
    expect(blockBox(STONE)).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it('底台阶上可站立：0.5 以上为空，踩进 0.5 有碰撞', () => {
    const w = voidWorld();
    w.setBlock(4, 4, 4, BLOCK_BY_KEY.stone_slab.id);
    expect(aabbFree(w, 4.5, 4.5, 4.5, 0.3, 1.8)).toBe(true);
    expect(aabbFree(w, 4.5, 4.2, 4.5, 0.3, 1.8)).toBe(false);
  });

  it('注册序：台阶底/顶相邻、顶掉底、楼梯各朝向掉 0 朝向', () => {
    expect(BLOCK_BY_KEY.stone_slab_top.id).toBe(BLOCK_BY_KEY.stone_slab.id + 1);
    expect(BLOCK_BY_KEY.stone_slab_top.dropBlock).toBe(BLOCK_BY_KEY.stone_slab.id);
    expect(BLOCK_BY_KEY.cobble_stairs_e.dropBlock).toBe(BLOCK_BY_KEY.cobble_stairs.id);
    expect(BLOCK_BY_KEY.cobble_stairs.facing).toBe(0);
    expect(BLOCK_BY_KEY.cobble_stairs_s.facing).toBe(2);
  });
});

describe('形状网格化', () => {
  it('底台阶 6 面；同型相邻侧面剔除', () => {
    const w = voidWorld();
    w.setBlock(4, 4, 4, BLOCK_BY_KEY.stone_slab.id);
    expect(buildChunkGeometry(w, w.getChunk(0, 0)).solid.indices.length).toBe(6 * 6);
    w.setBlock(5, 4, 4, BLOCK_BY_KEY.stone_slab.id);
    expect(buildChunkGeometry(w, w.getChunk(0, 0)).solid.indices.length).toBe(10 * 6);
  });

  it('楼梯孤立 11 面（底 5 + 顶 5 + 前缘顶面 1）', () => {
    const w = voidWorld();
    w.setBlock(4, 4, 4, BLOCK_BY_KEY.cobble_stairs.id);
    expect(buildChunkGeometry(w, w.getChunk(0, 0)).solid.indices.length).toBe(11 * 6);
  });

  it('栅栏孤立 6 面；同型相邻出 1 臂（4 面）', () => {
    const w = voidWorld();
    w.setBlock(4, 4, 4, BLOCK_BY_KEY.oak_fence.id);
    expect(buildChunkGeometry(w, w.getChunk(0, 0)).solid.indices.length).toBe(6 * 6);
    w.setBlock(5, 4, 4, BLOCK_BY_KEY.oak_fence.id);
    expect(buildChunkGeometry(w, w.getChunk(0, 0)).solid.indices.length).toBe(16 * 6);
  });

  it('花草：双面十字 4 面片', () => {
    const w = voidWorld();
    w.setBlock(4, 4, 4, BLOCK_BY_KEY.dandelion.id);
    expect(buildChunkGeometry(w, w.getChunk(0, 0)).solid.indices.length).toBe(4 * 6);
  });

  it('门：面板盒在朝向边、打开转垂直边、id 每朝向 4 连', () => {
    const b = BLOCK_BY_KEY;
    expect(b.oak_door_bottom_n.box3).toEqual([0, 0, 0, 1, 1, 0.1875]);
    expect(b.oak_door_open_bottom_n.box3).toEqual([0, 0, 0, 0.1875, 1, 1]);
    expect(b.oak_door_top_n.id).toBe(b.oak_door_bottom_n.id + 1);
    expect(b.oak_door_open_bottom_n.id).toBe(b.oak_door_bottom_n.id + 2);
    expect(b.oak_door_open_top_n.id).toBe(b.oak_door_bottom_n.id + 3);
    expect(b.oak_door_bottom_e.id).toBe(b.oak_door_bottom_n.id + 4);
    expect(b.oak_door_top_n.dropBlock).toBe(b.oak_door_bottom_n.id);
  });

  it('门：网格化为薄面板 6 面', () => {
    const w = voidWorld();
    w.setBlock(4, 4, 4, BLOCK_BY_KEY.oak_door_bottom_n.id);
    expect(buildChunkGeometry(w, w.getChunk(0, 0)).solid.indices.length).toBe(6 * 6);
  });
});
