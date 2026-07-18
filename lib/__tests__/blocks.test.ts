// 方块注册表完整性 + 矿石生成器（确定性 / 虚空安全 / 基岩与矿脉）

import { describe, expect, it } from 'vitest';
import { AIR, BLOCKS, BLOCK_BY_KEY, HOTBAR_BLOCKS, ICON_TILE_START, TILE_STEMS } from '../blocks';
import { VOID_TERRAIN, createTerrain } from '../noise';
import { applyOres } from '../oregen';
import { CHUNK_VOLUME, World } from '../world';

describe('方块注册表', () => {
  it('id 连续且与下标一致，key 唯一', () => {
    const keys = new Set<string>();
    for (const [i, d] of BLOCKS.entries()) {
      expect(d.id).toBe(i);
      expect(keys.has(d.key)).toBe(false);
      keys.add(d.key);
    }
  });

  it('贴图索引有效（-1 空气专用 或 [0, ICON_TILE_START) 或图标格）', () => {
    for (const d of BLOCKS) {
      for (const tile of [d.top, d.side, d.bottom]) {
        if (d.id === AIR) {
          expect(tile).toBe(-1);
        } else {
          expect(tile).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('规模：主世界全立方体 ≥ 240 种（约原版 1/3）', () => {
    expect(BLOCKS.length).toBeGreaterThanOrEqual(240);
    expect(TILE_STEMS.length).toBeLessThan(ICON_TILE_START);
  });

  it('BLOCK_BY_KEY 覆盖全部 key，热键栏均为固体方块', () => {
    expect(Object.keys(BLOCK_BY_KEY).length).toBe(BLOCKS.length);
    for (const id of HOTBAR_BLOCKS) {
      expect(BLOCKS[id].solid).toBe(true);
    }
  });

  it('每种木材都有 原木/木板/树叶', () => {
    for (const w of ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry']) {
      const log = w === 'oak' ? 'log' : `${w}_log`;
      const planks = w === 'oak' ? 'planks' : `${w}_planks`;
      const leaves = w === 'oak' ? 'leaves' : `${w}_leaves`;
      expect(BLOCK_BY_KEY[log], log).toBeDefined();
      expect(BLOCK_BY_KEY[planks], planks).toBeDefined();
      expect(BLOCK_BY_KEY[leaves], leaves).toBeDefined();
    }
  });
});

describe('矿石生成器', () => {
  const flatTerrain = { heightAt: () => 30, treeAt: () => false };

  it('虚空地形不产生任何方块', () => {
    const data = new Uint16Array(CHUNK_VOLUME);
    applyOres(42, VOID_TERRAIN, 3, -5, data);
    expect(data.every((v) => v === 0)).toBe(true);
  });

  it('同参数输出一致（确定性）', () => {
    const a = new Uint16Array(CHUNK_VOLUME);
    const b = new Uint16Array(CHUNK_VOLUME);
    applyOres(42, flatTerrain, 7, 9, a);
    applyOres(42, flatTerrain, 7, 9, b);
    expect(a).toEqual(b);
  });

  it('y=0 全为基岩，且矿脉只出现在石头/深板岩宿主中', () => {
    const data = new Uint16Array(CHUNK_VOLUME);
    data.fill(BLOCK_BY_KEY.stone.id);
    applyOres(42, flatTerrain, 0, 0, data);
    const bedrock = BLOCK_BY_KEY.bedrock.id;
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        expect(data[(0 * 16 + z) * 16 + x]).toBe(bedrock);
      }
    }
  });

  it('真实地形 chunk 含矿石（多 chunk 汇总）', () => {
    const terrain = createTerrain('ore-test');
    const found = new Set<number>();
    for (let c = 0; c < 16; c++) {
      const data = new Uint16Array(CHUNK_VOLUME);
      data.fill(BLOCK_BY_KEY.stone.id);
      applyOres(123, terrain, c, c, data);
      for (const v of data) found.add(v);
    }
    expect(found.has(BLOCK_BY_KEY.coal_ore.id)).toBe(true);
    expect(found.has(BLOCK_BY_KEY.iron_ore.id)).toBe(true);
  });

  it('World 生成的 chunk 含基岩', () => {
    const w = new World('ore-e2e', undefined, { heightAt: () => 30, treeAt: () => false });
    const c = w.getChunk(0, 0);
    expect(c.data[0]).toBe(BLOCK_BY_KEY.bedrock.id);
  });
});
