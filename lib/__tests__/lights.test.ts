// 方块光照：火把衰减 / 遮挡 / 移除消退 / 跨 chunk 接力

import { describe, expect, it } from 'vitest';
import { BLOCK_BY_KEY, STONE } from '../blocks';
import { flushLight } from '../lights';
import { VOID_TERRAIN } from '../noise';
import { localIndex, World } from '../world';

describe('方块光照', () => {
  it('火把点亮并向四周逐级衰减', () => {
    const w = new World('light', undefined, VOID_TERRAIN);
    w.setBlock(8, 10, 8, BLOCK_BY_KEY.torch.id);
    flushLight(w);
    const c = w.getChunk(0, 0);
    expect(c.light[localIndex(8, 10, 8)]).toBe(14);
    expect(c.light[localIndex(9, 10, 8)]).toBe(13);
    expect(c.light[localIndex(12, 10, 8)]).toBe(10);
    expect(c.light[localIndex(8, 11, 8)]).toBe(13);
  });

  it('单个障碍会被绕路衰减（MC 光照规则）', () => {
    const w = new World('light-block', undefined, VOID_TERRAIN);
    w.setBlock(8, 11, 8, BLOCK_BY_KEY.torch.id);
    w.setBlock(8, 12, 8, STONE); // 正上方单块石头
    flushLight(w);
    const c = w.getChunk(0, 0);
    // 光从侧路绕上去：14 - 4 步 = 10
    expect(c.light[localIndex(8, 13, 8)]).toBe(10);
  });

  it('全包围时光照不外泄', () => {
    const w = new World('light-sealed', undefined, VOID_TERRAIN);
    w.setBlock(8, 10, 8, BLOCK_BY_KEY.torch.id);
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
      w.setBlock(8 + dx, 10 + dy, 8 + dz, STONE);
    }
    flushLight(w);
    const c = w.getChunk(0, 0);
    expect(c.light[localIndex(8, 10, 8)]).toBe(14); // 火把自身
    expect(c.light[localIndex(9, 10, 8)]).toBe(0); // 石墙（不透明）无光
    expect(c.light[localIndex(10, 10, 8)]).toBe(0); // 墙外也无光
  });

  it('移除光源后光照消退', () => {
    const w = new World('light-remove', undefined, VOID_TERRAIN);
    w.setBlock(8, 10, 8, BLOCK_BY_KEY.torch.id);
    flushLight(w);
    expect(w.getChunk(0, 0).light[localIndex(10, 10, 8)]).toBeGreaterThan(0);
    w.setBlock(8, 10, 8, 0);
    flushLight(w);
    expect(w.getChunk(0, 0).light[localIndex(10, 10, 8)]).toBe(0);
  });

  it('跨 chunk 边界接力传播', () => {
    const w = new World('light-border', undefined, VOID_TERRAIN);
    w.setBlock(15, 10, 8, BLOCK_BY_KEY.torch.id); // (0,0) chunk 的 x=15 边缘
    flushLight(w);
    const c1 = w.getChunk(1, 0);
    expect(c1.light[localIndex(0, 10, 8)]).toBe(13);
    expect(c1.light[localIndex(3, 10, 8)]).toBe(10);
  });

  it('天空光：露天全亮，遮挡下方变暗但侧面渗透', () => {
    const w = new World('sky-light', undefined, VOID_TERRAIN);
    // 石头平台遮住 (8,20,8) 的正上方
    for (let x = 6; x <= 10; x++) {
      for (let z = 6; z <= 10; z++) w.setBlock(x, 30, z, STONE);
    }
    flushLight(w);
    const c = w.getChunk(0, 0);
    expect(c.sky[localIndex(2, 10, 2)]).toBe(15); // 远处露天全亮
    const under = c.sky[localIndex(8, 20, 8)];
    expect(under).toBeLessThan(15); // 平台下方变暗
    expect(under).toBeGreaterThan(0); // 侧面仍有渗透光
  });
});
