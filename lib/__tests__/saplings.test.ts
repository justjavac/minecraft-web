// 树苗生长与树叶凋零

import { describe, expect, it } from 'vitest';
import { AIR, BLOCK_BY_KEY } from '../blocks';
import { VOID_TERRAIN } from '../noise';
import { notifyBlockSet, tickSaplings } from '../saplings';
import { World } from '../world';

function fillLeaves(w: World, cx: number, cy: number, cz: number, r: number, leaf: number): void {
  for (let x = cx - r; x <= cx + r; x++) {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let z = cz - r; z <= cz + r; z++) {
        w.setBlock(x, y, z, leaf);
      }
    }
  }
}

describe('树苗与树叶', () => {
  it('树苗到时间会长成树（干 4 高 + 叶）', () => {
    const w = new World('sapling-grow', undefined, VOID_TERRAIN);
    const oak = BLOCK_BY_KEY.oak_sapling.id;
    w.setBlock(8, 30, 8, oak);
    // 触发足够多生长刻（1/25 概率 × 多次 2s tick，统计上必中；失败重试空间有限
    let grown = false;
    for (let i = 0; i < 200 && !grown; i++) {
      tickSaplings(w, 2);
      grown = w.getBlock(8, 30, 8) === BLOCK_BY_KEY.log.id;
    }
    expect(grown).toBe(true);
    expect(w.getBlock(8, 33, 8)).toBe(BLOCK_BY_KEY.log.id);
    expect(w.getBlock(9, 32, 8)).toBe(BLOCK_BY_KEY.leaves.id);
  });

  it('砍光原木后树叶逐级枯萎，远处有原木供养的不枯', () => {
    const w = new World('leaf-decay', undefined, VOID_TERRAIN);
    const log = BLOCK_BY_KEY.log.id;
    const leaf = BLOCK_BY_KEY.leaves.id;
    // 一棵树：干 + 叶
    for (let y = 30; y < 34; y++) w.setBlock(8, y, 8, log);
    fillLeaves(w, 8, 33, 8, 2, leaf);
    // 远处另一棵保叶树
    for (let y = 30; y < 34; y++) w.setBlock(15, y, 8, log);
    fillLeaves(w, 15, 33, 8, 1, leaf);
    // 砍掉近树的干
    for (let y = 30; y < 34; y++) {
      const old = w.getBlock(8, y, 8);
      w.setBlock(8, y, 8, AIR);
      notifyBlockSet(w, 8, y, 8, old, AIR);
    }
    for (let i = 0; i < 40; i++) tickSaplings(w, 2);
    // 近树叶子应全部枯萎
    let left = 0;
    for (let x = 6; x <= 10; x++) {
      for (let z = 6; z <= 10; z++) {
        for (let y = 31; y <= 35; y++) {
          if (w.getBlock(x, y, z) === leaf) left++;
        }
      }
    }
    expect(left).toBe(0);
    // 远树叶子保留
    expect(w.getBlock(14, 33, 8)).toBe(leaf);
  });
});
