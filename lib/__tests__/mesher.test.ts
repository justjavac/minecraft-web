import { describe, expect, it } from 'vitest';
import { BLOCKS, STONE, WATER, GLASS } from '../blocks';
import { buildChunkGeometry } from '../mesher';
import { VOID_TERRAIN } from '../noise';
import { CHUNK_SIZE, WORLD_HEIGHT, World } from '../world';

function voidWorld(): World {
  return new World('test', undefined, VOID_TERRAIN);
}

describe('mesher 面剔除', () => {
  it('孤立方块生成 6 个面', () => {
    const w = voidWorld();
    w.setBlock(8, 8, 8, STONE);
    const g = buildChunkGeometry(w, w.getChunk(0, 0));
    expect(g.solid.indices.length).toBe(6 * 6);
    expect(g.solid.positions.length).toBe(24 * 3);
    expect(g.water.indices.length).toBe(0);
  });

  it('相邻同类方块之间的面被剔除', () => {
    const w = voidWorld();
    w.setBlock(8, 8, 8, STONE);
    w.setBlock(9, 8, 8, STONE);
    const g = buildChunkGeometry(w, w.getChunk(0, 0));
    // 12 面 - 2 共享面 = 10 面
    expect(g.solid.indices.length).toBe(10 * 6);
  });

  it('满 chunk 只渲染外表面', () => {
    const w = voidWorld();
    for (let y = 0; y < WORLD_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          w.setBlock(x, y, z, STONE);
        }
      }
    }
    const g = buildChunkGeometry(w, w.getChunk(0, 0));
    // 4 个侧面 16×64 + 顶/底 16×16
    const faces = 4 * CHUNK_SIZE * WORLD_HEIGHT + 2 * CHUNK_SIZE * CHUNK_SIZE;
    expect(g.solid.indices.length).toBe(faces * 6);
  });

  it('水走透明几何，水-水相邻面剔除', () => {
    const w = voidWorld();
    w.setBlock(4, 4, 4, WATER);
    w.setBlock(5, 4, 4, WATER);
    const g = buildChunkGeometry(w, w.getChunk(0, 0));
    expect(g.solid.indices.length).toBe(0);
    expect(g.water.indices.length).toBe(10 * 6);
  });

  it('相邻玻璃之间不画内部面', () => {
    const w = voidWorld();
    w.setBlock(4, 4, 4, GLASS);
    w.setBlock(4, 4, 5, GLASS);
    const g = buildChunkGeometry(w, w.getChunk(0, 0));
    expect(g.solid.indices.length).toBe(10 * 6);
  });

  it('未知方块 id 按空气处理，不抛错', () => {
    const w = voidWorld();
    w.setBlock(4, 4, 4, BLOCKS.length + 100); // 超出注册表的 id（如旧版本存档残留）
    w.setBlock(5, 4, 4, STONE);
    const g = buildChunkGeometry(w, w.getChunk(0, 0));
    expect(g.solid.indices.length).toBe(6 * 6); // 只剩石头方块的 6 面
  });

  it('AO：孤立方块全亮，有相邻遮挡时顶点变暗', () => {
    const w1 = voidWorld();
    w1.setBlock(8, 8, 8, STONE);
    const g1 = buildChunkGeometry(w1, w1.getChunk(0, 0));
    expect(g1.solid.colors.length).toBe(g1.solid.positions.length); // 每顶点一个 RGB
    expect(Math.min(...g1.solid.colors)).toBe(1);

    const w2 = voidWorld();
    w2.setBlock(8, 8, 8, STONE);
    w2.setBlock(9, 9, 8, STONE); // 挡住 +x 面上角的侧边，产生遮蔽
    const g2 = buildChunkGeometry(w2, w2.getChunk(0, 0));
    expect(Math.min(...g2.solid.colors)).toBeLessThan(1);
  });

  it('水面高度 0.875，水柱内部顶面被剔除', () => {
    const w1 = voidWorld();
    w1.setBlock(4, 4, 4, WATER);
    const g1 = buildChunkGeometry(w1, w1.getChunk(0, 0));
    const ys1 = [...g1.water.positions].filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys1)).toBeCloseTo(4.875);

    const w2 = voidWorld();
    w2.setBlock(4, 4, 4, WATER);
    w2.setBlock(4, 5, 4, WATER);
    const g2 = buildChunkGeometry(w2, w2.getChunk(0, 0));
    const ys2 = [...g2.water.positions].filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys2)).toBeCloseTo(5.875); // 只有上层水的顶面，且同样下沉
    expect(ys2.some((y) => y > 5.875)).toBe(false);
  });
});
