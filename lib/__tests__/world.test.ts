import { describe, expect, it } from 'vitest';
import { AIR, BLOCK_BY_KEY, GRASS, STONE } from '../blocks';
import { SEA_LEVEL, VOID_TERRAIN, type Terrain } from '../noise';
import { generateChunk, World, CHUNK_SIZE, CHUNK_VOLUME, localIndex } from '../world';

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
    w.setBlock(0, 200, 0, STONE);
    expect(w.getBlock(0, -1, 0)).toBe(AIR);
    expect(w.getBlock(0, 200, 0)).toBe(AIR);
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
    w.updateAround(0, 0, 2, 10_000);
    expect(w.chunks.has('20,0')).toBe(false);
    expect(w.chunks.has('0,0')).toBe(true);
    expect(removed).toContain('20,0'); // 修改过的 chunk 卸载前触发存档回调
    expect(removed).not.toContain('0,0');
  });

  it('修改过的 chunk 卸载后重进，编辑不丢失', () => {
    const w = voidWorld();
    w.setBlock(20 * 16 + 1, 5, 5, STONE);
    w.updateAround(0, 0, 2, 10_000); // 卸载 (20,0)
    expect(w.chunks.has('20,0')).toBe(false);
    // 玩家走回来，重建后编辑仍在
    w.updateAround(20 * 16, 0, 2, 10_000);
    expect(w.getBlock(20 * 16 + 1, 5, 5)).toBe(STONE);
  });

  it('updateAround 毫秒时间片：预算耗尽留待下次，至少生成 1 个并返回剩余数', () => {
    const w = voidWorld();
    // 预算 0：仍保证生成 1 个（由近及远），其余留给下一帧
    expect(w.updateAround(0, 0, 2, 0)).toBe(24);
    expect(w.chunks.size).toBe(1);
    expect(w.chunks.has('0,0')).toBe(true); // 最近的中心 chunk 优先生成
    // 大预算：一次铺满，返回 0 表示周围已完整（加载完成判定依据）
    expect(w.updateAround(0, 0, 2, 10_000)).toBe(0);
    expect(w.chunks.size).toBe(25);
  });

  it('updateAround 记忆化：同位置同视距早退不重扫，跨边界/失效后重扫', () => {
    const w = voidWorld();
    expect(w.updateAround(0, 0, 2, 10_000)).toBe(0); // 铺满，缓存生效
    // 同位置重复调用：早退返回 0，不重扫——半径外的游离 chunk 不会被卸载（卸载只随重扫做）
    w.getChunk(10, 0); // 半径+2 之外的游离 chunk
    expect(w.updateAround(0, 0, 2, 10_000)).toBe(0);
    expect(w.chunks.has('10,0')).toBe(true);
    // invalidateAround 强制重扫：游离 chunk 被卸载
    w.invalidateAround();
    expect(w.updateAround(0, 0, 2, 10_000)).toBe(0);
    expect(w.chunks.has('10,0')).toBe(false);
    // 跨 chunk 边界（坐标变化）自动触发重扫，无需 invalidate
    w.getChunk(10, 0);
    expect(w.updateAround(16, 0, 2, 10_000)).toBe(0);
    expect(w.chunks.has('10,0')).toBe(false);
    // 视距变化同样触发重扫
    w.getChunk(10, 0);
    expect(w.updateAround(16, 0, 3, 10_000)).toBe(0);
    expect(w.chunks.has('10,0')).toBe(false);
    // 加载期（未铺满）不缓存：预算耗尽的帧之后同位置调用仍继续推进生成
    const w2 = voidWorld();
    expect(w2.updateAround(0, 0, 2, 0)).toBe(24);
    expect(w2.updateAround(0, 0, 2, 0)).toBe(23); // 同位置但仍在生成，未被早退吞掉
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
    const saved = new Map([['0,0', new Uint16Array(w1.getChunk(0, 0).data)]]);
    const w2 = new World('save-seed', saved);
    expect(w2.getBlock(5, 40, 5)).toBe(STONE);
  });

  it('applySavedChunk 三种到达时序', () => {
    const saved = new Uint16Array(CHUNK_VOLUME);
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
    const data = new Uint16Array(CHUNK_VOLUME);
    generateChunk((new World('fill-test')).terrain, 0, 0, data);
    expect(data.some((v) => v !== AIR)).toBe(true);
    expect(Array.from(data)).toContain(STONE); // 任何地形列底部都有石头
    const again = new Uint16Array(CHUNK_VOLUME);
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

  it('甘蔗可长在贴水的 chunk 边界列（消除 16 格周期空缺线）', () => {
    // 西侧水域、东侧恰好海平面高度的岸滩：甘蔗只能贴着 x=0 这条 chunk 边界列生长
    const shore: Terrain = {
      ...VOID_TERRAIN,
      heightAt: (x) => (x < 0 ? SEA_LEVEL - 3 : SEA_LEVEL),
    };
    const w = new World('veg-edge-cane', undefined, shore);
    let cane = 0;
    for (let cz = 0; cz < 4; cz++) {
      const data = w.getChunk(0, cz).data;
      for (let y = SEA_LEVEL + 1; y <= SEA_LEVEL + 3; y++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
          if (data[localIndex(0, y, z)] === BLOCK_BY_KEY.sugar_cane.id) cane++;
        }
      }
    }
    expect(cane).toBeGreaterThan(0); // 旧逻辑 x>0 守卫使边界列永不生成
  });

  it('仙人掌可长在 chunk 边界列（邻格按邻列地形高度推断为空）', () => {
    const desert: Terrain = { ...VOID_TERRAIN, heightAt: () => 45, biomeAt: () => 'desert' };
    const w = new World('veg-edge-cactus', undefined, desert);
    let edgeCactus = 0;
    for (let cx = 0; cx < 3; cx++) {
      for (let cz = 0; cz < 3; cz++) {
        const data = w.getChunk(cx, cz).data;
        for (let y = 46; y <= 49; y++) {
          for (let x = 0; x < CHUNK_SIZE; x++) {
            for (let z = 0; z < CHUNK_SIZE; z++) {
              const onEdge = x === 0 || x === CHUNK_SIZE - 1 || z === 0 || z === CHUNK_SIZE - 1;
              if (onEdge && data[localIndex(x, y, z)] === BLOCK_BY_KEY.cactus.id) edgeCactus++;
            }
          }
        }
      }
    }
    expect(edgeCactus).toBeGreaterThan(0); // 旧逻辑边界一圈永不生成仙人掌
  });
});
