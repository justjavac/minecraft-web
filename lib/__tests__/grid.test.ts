// grid.put：世界坐标 → chunk 局部坐标换算、正常写入、负坐标与越界守卫

import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, CHUNK_VOLUME, WORLD_HEIGHT, localIndex, put } from '../grid';

const ID = 42;

/** 全零 chunk；返回数据与“非零格子数量”查询 */
function makeChunk(): { data: Uint16Array; written: () => number } {
  const data = new Uint16Array(CHUNK_VOLUME);
  return { data, written: () => data.reduce((n, v) => n + (v !== 0 ? 1 : 0), 0) };
}

describe('put', () => {
  it('正常写入：世界坐标换算为本 chunk 局部索引', () => {
    const { data } = makeChunk();
    put(data, 2, 3, 2 * CHUNK_SIZE + 5, 64, 3 * CHUNK_SIZE + 7, ID);
    expect(data[localIndex(5, 64, 7)]).toBe(ID);
  });

  it('写入 chunk 内四角边界（含 y 上下限）', () => {
    const { data, written } = makeChunk();
    put(data, 0, 0, 0, 0, 0, ID);
    put(data, 0, 0, CHUNK_SIZE - 1, WORLD_HEIGHT - 1, CHUNK_SIZE - 1, ID);
    expect(data[localIndex(0, 0, 0)]).toBe(ID);
    expect(data[localIndex(CHUNK_SIZE - 1, WORLD_HEIGHT - 1, CHUNK_SIZE - 1)]).toBe(ID);
    expect(written()).toBe(2);
  });

  it('负坐标 chunk：世界坐标 -1 属于 chunk -1 的局部 15', () => {
    const { data, written } = makeChunk();
    put(data, -1, -1, -1, 10, -1, ID);
    expect(data[localIndex(CHUNK_SIZE - 1, 10, CHUNK_SIZE - 1)]).toBe(ID);
    expect(written()).toBe(1);
  });

  it('xz 落在相邻 chunk（含负侧）时不写入', () => {
    const { data, written } = makeChunk();
    put(data, 0, 0, CHUNK_SIZE, 10, 0, ID); // 属于 chunk (1, 0)
    put(data, 0, 0, 0, 10, CHUNK_SIZE, ID); // 属于 chunk (0, 1)
    put(data, 0, 0, -1, 10, 0, ID); // 属于 chunk (-1, 0)
    put(data, 0, 0, 0, 10, -1, ID); // 属于 chunk (0, -1)
    expect(written()).toBe(0);
  });

  it('y 越界（-1 与 WORLD_HEIGHT）时不写入', () => {
    const { data, written } = makeChunk();
    put(data, 0, 0, 3, -1, 3, ID);
    put(data, 0, 0, 3, WORLD_HEIGHT, 3, ID);
    expect(written()).toBe(0);
  });

  it('覆盖已有方块（无 onlyAir 语义）', () => {
    const { data } = makeChunk();
    put(data, 0, 0, 1, 2, 3, ID);
    put(data, 0, 0, 1, 2, 3, ID + 1);
    expect(data[localIndex(1, 2, 3)]).toBe(ID + 1);
  });
});
