import { describe, expect, it } from 'vitest';
import { AIR, GRASS, STONE } from '../blocks';
import { VOID_TERRAIN } from '../noise';
import { generateChunk, World, CHUNK_VOLUME } from '../world';

function voidWorld(): World {
  return new World('test', undefined, VOID_TERRAIN);
}

describe('World 方块读写', () => {
  it('set/get 往返一致', () => {
    const w = voidWorld();
    w.setBlock(1, 2, 3, STONE);
    expect(w.getBlock(1, 2, 3)).toBe(STONE);
    expect(w.getBlock(1, 2, 4)).toBe(AIR);
  });

  it('y 越界读写安全', () => {
    const w = voidWorld();
    w.setBlock(0, -1, 0, STONE);
    w.setBlock(0, 64, 0, STONE);
    expect(w.getBlock(0, -1, 0)).toBe(AIR);
    expect(w.getBlock(0, 64, 0)).toBe(AIR);
  });

  it('修改标记脏 chunk 与待存档 chunk', () => {
    const w = voidWorld();
    w.getChunk(0, 0);
    w.dirtyChunks.clear();
    w.setBlock(1, 1, 1, STONE);
    expect(w.dirtyChunks.has('0,0')).toBe(true);
    expect(w.modifiedChunks.has('0,0')).toBe(true);
  });

  it('边界修改同时标记相邻 chunk', () => {
    const w = voidWorld();
    w.getChunk(-1, 0);
    w.getChunk(0, 0);
    w.dirtyChunks.clear();
    w.setBlock(0, 5, 5, STONE);
    expect(w.dirtyChunks.has('-1,0')).toBe(true);
    expect(w.dirtyChunks.has('0,0')).toBe(true);
  });

  it('updateAround 卸载远处 chunk 并回调', () => {
    const w = voidWorld();
    w.getChunk(0, 0);
    w.setBlock(20 * 16 + 1, 1, 1, STONE); // 在远处 chunk (20,0) 内制造修改
    const removed: string[] = [];
    w.onChunkRemoved = (c) => removed.push(`${c.cx},${c.cz}`);
    w.updateAround(0, 0, 2);
    expect(w.chunks.has('20,0')).toBe(false);
    expect(w.chunks.has('0,0')).toBe(true);
    expect(removed).toContain('20,0'); // 修改过的 chunk 卸载前触发存档回调
    expect(removed).not.toContain('0,0');
  });

  it('修改过的 chunk 卸载后重进，编辑不丢失', () => {
    const w = voidWorld();
    w.setBlock(20 * 16 + 1, 5, 5, STONE);
    w.updateAround(0, 0, 2); // 卸载 (20,0)
    expect(w.chunks.has('20,0')).toBe(false);
    // 玩家走回来，重建后编辑仍在
    w.updateAround(20 * 16, 0, 2);
    expect(w.getBlock(20 * 16 + 1, 5, 5)).toBe(STONE);
  });
});

describe('地形生成', () => {
  it('虚空地形不生成任何方块', () => {
    const w = voidWorld();
    const c = w.getChunk(0, 0);
    expect(c.data.every((v) => v === AIR)).toBe(true);
  });

  it('同种子两次生成结果一致', () => {
    const a = new World('gen-seed');
    const b = new World('gen-seed');
    const ca = a.getChunk(3, -2);
    const cb = b.getChunk(3, -2);
    expect(Buffer.from(ca.data).equals(Buffer.from(cb.data))).toBe(true);
  });

  it('存档数据覆盖重新生成的地形', () => {
    const w1 = new World('save-seed');
    w1.setBlock(5, 40, 5, STONE);
    const saved = new Map([['0,0', new Uint8Array(w1.getChunk(0, 0).data)]]);
    const w2 = new World('save-seed', saved);
    expect(w2.getBlock(5, 40, 5)).toBe(STONE);
  });

  it('applySavedChunk 三种到达时序', () => {
    const saved = new Uint8Array(CHUNK_VOLUME);
    saved[0] = STONE;

    // chunk 未创建：stash 后创建时生效
    const w1 = voidWorld();
    w1.applySavedChunk('0,0', saved);
    expect(w1.getBlock(0, 0, 0)).toBe(STONE);

    // chunk 已创建且本局未修改：替换为存档版本并标记重建
    const w2 = voidWorld();
    w2.getChunk(0, 0);
    w2.applySavedChunk('0,0', saved);
    expect(w2.getBlock(0, 0, 0)).toBe(STONE);
    expect(w2.dirtyChunks.has('0,0')).toBe(true);

    // chunk 已被本局修改：玩家版本优先，存档被忽略
    const w3 = voidWorld();
    w3.setBlock(1, 1, 1, STONE);
    w3.applySavedChunk('0,0', saved);
    expect(w3.getBlock(0, 0, 0)).toBe(AIR);
    expect(w3.getBlock(1, 1, 1)).toBe(STONE);
  });

  it('默认地形生成非空且幂等', () => {
    const data = new Uint8Array(16 * 16 * 64);
    generateChunk((new World('fill-test')).terrain, 0, 0, data);
    expect(data.some((v) => v !== AIR)).toBe(true);
    expect(Array.from(data)).toContain(STONE); // 任何地形列底部都有石头
    const again = new Uint8Array(16 * 16 * 64);
    generateChunk((new World('fill-test')).terrain, 0, 0, again);
    expect(Buffer.from(data).equals(Buffer.from(again))).toBe(true);
  });

  it('大范围地形同时包含陆地与草地', () => {
    const w = new World('terrain-mix');
    const ids = new Set<number>();
    for (let cx = 0; cx < 5; cx++) {
      for (let cz = 0; cz < 5; cz++) {
        w.getChunk(cx, cz).data.forEach((v) => ids.add(v));
      }
    }
    expect(ids.has(GRASS)).toBe(true);
    expect(ids.has(STONE)).toBe(true);
  });
});
