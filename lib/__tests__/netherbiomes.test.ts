// 下界群系变体：五群系覆盖、森林菌岩与巨型菌类树、灵魂沙谷化石、三角洲黑石与玄武岩柱

import { describe, expect, it } from 'vitest';
import { BLOCK_BY_KEY } from '../blocks';
import { createNetherTerrain, generateNetherChunk, LAVA_SEA } from '../nether';
import { hashString } from '../noise';
import { CHUNK_VOLUME } from '../world';

const K = (k: string) => BLOCK_BY_KEY[k].id;

function chunkAt(t: ReturnType<typeof createNetherTerrain>, cx: number, cz: number, seed: string): Uint16Array {
  const data = new Uint16Array(CHUNK_VOLUME);
  generateNetherChunk(t, cx, cz, data, hashString(seed));
  return data;
}

describe('下界群系', () => {
  it('大尺度采样覆盖全部 5 群系', () => {
    const t = createNetherTerrain('nether-biomes');
    const seen = new Set<string>();
    for (let x = -3000; x < 3000; x += 7) {
      for (let z = -3000; z < 3000; z += 7) seen.add(t.biomeAt(x, z));
    }
    for (const b of ['nether', 'warped_forest', 'crimson_forest', 'soul_sand_valley', 'basalt_deltas']) {
      expect(seen.has(b), b).toBe(true);
    }
  });

  it('诡异森林：菌岩表层 + 巨型菌类树（菌柄 + 疣块 + 菌光体）与小菌植被', () => {
    const t = createNetherTerrain('nether-biomes');
    // 找诡异森林 chunk
    let found = false;
    for (let cx = -100; cx < 100 && !found; cx++) {
      for (let cz = -100; cz < 100 && !found; cz++) {
        if (t.biomeAt(cx * 16 + 8, cz * 16 + 8) !== 'warped_forest') continue;
        if (t.heightAt(cx * 16 + 8, cz * 16 + 8) <= LAVA_SEA + 1) continue;
        const data = chunkAt(t, cx, cz, 'nether-biomes');
        const found2 = new Set<number>();
        for (const v of data) found2.add(v);
        if (found2.has(K('warped_stem')) && found2.has(K('warped_wart_block'))) {
          found = true;
          expect(found2.has(K('warped_nylium'))).toBe(true);
          expect(found2.has(K('shroomlight')) || found2.has(K('warped_fungus')) || found2.has(K('warped_roots'))).toBe(true);
        }
      }
    }
    expect(found).toBe(true);
  });

  it('绯红森林：绯红菌岩表层与绯红菌柄', () => {
    const t = createNetherTerrain('nether-biomes');
    let found = false;
    for (let cx = -100; cx < 100 && !found; cx++) {
      for (let cz = -100; cz < 100 && !found; cz++) {
        if (t.biomeAt(cx * 16 + 8, cz * 16 + 8) !== 'crimson_forest') continue;
        if (t.heightAt(cx * 16 + 8, cz * 16 + 8) <= LAVA_SEA + 1) continue;
        const data = chunkAt(t, cx, cz, 'nether-biomes');
        const found2 = new Set<number>();
        for (const v of data) found2.add(v);
        if (found2.has(K('crimson_stem')) && found2.has(K('nether_wart_block'))) {
          found = true;
          expect(found2.has(K('crimson_nylium'))).toBe(true);
        }
      }
    }
    expect(found).toBe(true);
  });

  it('灵魂沙谷：灵魂沙表层 + 骨块化石', () => {
    const t = createNetherTerrain('nether-biomes');
    let soulTop = false;
    let fossil = false;
    for (let cx = -100; cx < 100 && (!soulTop || !fossil); cx++) {
      for (let cz = -100; cz < 100 && (!soulTop || !fossil); cz++) {
        if (t.biomeAt(cx * 16 + 8, cz * 16 + 8) !== 'soul_sand_valley') continue;
        if (t.heightAt(cx * 16 + 8, cz * 16 + 8) <= LAVA_SEA + 1) continue;
        const data = chunkAt(t, cx, cz, 'nether-biomes');
        for (const v of data) {
          if (v === K('soul_sand') || v === K('soul_soil')) soulTop = true;
          if (v === K('bone_block')) fossil = true;
        }
      }
    }
    expect(soulTop).toBe(true);
    expect(fossil).toBe(true);
  });

  it('玄武岩三角洲：黑石主体 + 玄武岩柱群', () => {
    const t = createNetherTerrain('nether-biomes');
    let black = false;
    let columns = 0;
    for (let cx = -100; cx < 100 && columns < 3; cx++) {
      for (let cz = -100; cz < 100 && columns < 3; cz++) {
        if (t.biomeAt(cx * 16 + 8, cz * 16 + 8) !== 'basalt_deltas') continue;
        const data = chunkAt(t, cx, cz, 'nether-biomes');
        for (const v of data) {
          if (v === K('blackstone')) black = true;
          if (v === K('basalt')) columns++;
        }
      }
    }
    expect(black).toBe(true);
    expect(columns).toBeGreaterThan(0);
  });

  it('同种子群系判定确定一致', () => {
    const a = createNetherTerrain('det-nb');
    const b = createNetherTerrain('det-nb');
    for (let i = 0; i < 200; i++) {
      expect(a.biomeAt(i * 37 - 1000, i * 53 + 500)).toBe(b.biomeAt(i * 37 - 1000, i * 53 + 500));
    }
  });
});
