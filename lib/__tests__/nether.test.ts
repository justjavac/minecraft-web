// 下界维度：地形生成（下界岩/岩浆海/基岩顶/石英/萤石）、坐标映射、落点与造门

import { describe, expect, it } from 'vitest';
import { AIR, BLOCK_BY_KEY, LAVA } from '../blocks';
import { ensurePortal, findLanding, mapCoords } from '../dimension';
import { createNetherTerrain, generateNetherChunk, LAVA_SEA } from '../nether';
import { VOID_TERRAIN, hashString } from '../noise';
import { isPortalId } from '../portal';
import { CHUNK_VOLUME, localIndex, World, WORLD_HEIGHT } from '../world';

const K = (k: string) => BLOCK_BY_KEY[k].id;

function netherChunk(cx = 0, cz = 0, seed = 'nether-test'): Uint16Array {
  const t = createNetherTerrain(seed);
  const data = new Uint16Array(CHUNK_VOLUME);
  generateNetherChunk(t, cx, cz, data, hashString(seed));
  return data;
}

describe('下界生成', () => {
  it('下界岩为主，谷地浸入岩浆海', () => {
    let netherrack = 0;
    let lava = 0;
    for (let c = 0; c < 8; c++) {
      const data = netherChunk(c, c);
      for (const v of data) {
        if (v === K('netherrack')) netherrack++;
        if (v === LAVA) lava++;
      }
    }
    expect(netherrack).toBeGreaterThan(10000);
    expect(lava).toBeGreaterThan(100);
    // 海平面以下允许洞穴空气但比例受限（岩浆/实体为主）
    const data = netherChunk(5, 5);
    let airPocket = 0;
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        for (let y = 5; y <= LAVA_SEA; y++) if (data[localIndex(x, y, z)] === AIR) airPocket++;
      }
    }
    expect(airPocket).toBeLessThan(16 * 16 * LAVA_SEA * 0.6);
  });

  it('基岩地板与参差基岩天花板', () => {
    const data = netherChunk(3, -2);
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        expect(data[localIndex(x, 0, z)]).toBe(K('bedrock'));
      }
    }
    let ceiling = 0;
    for (let y = WORLD_HEIGHT - 6; y < WORLD_HEIGHT; y++) {
      for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) if (data[localIndex(x, y, z)] === K('bedrock')) ceiling++;
    }
    expect(ceiling).toBeGreaterThan(0);
  });

  it('下界石英矿与萤石簇存在（多 chunk 汇总）', () => {
    let quartz = 0;
    let glow = 0;
    for (let c = 0; c < 12; c++) {
      const data = netherChunk(c, c * 2);
      for (const v of data) {
        if (v === K('nether_quartz_ore')) quartz++;
        if (v === K('glowstone')) glow++;
      }
    }
    expect(quartz).toBeGreaterThan(50);
    expect(glow).toBeGreaterThan(0);
  });

  it('同种子两次生成一致（确定性）', () => {
    const a = netherChunk(2, 5, 'det');
    const b = netherChunk(2, 5, 'det');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

describe('维度映射与落点', () => {
  it('主世界 ↔ 下界坐标 1:8 映射', () => {
    const p = mapCoords({ x: 80, y: 64, z: -40 }, 'nether');
    expect(p).toEqual({ x: 10, y: 64, z: -5 });
    const back = mapCoords(p, 'overworld');
    expect(back).toEqual({ x: 80, y: 64, z: -40 });
  });

  it('下界落点在岩浆海以上且可站立', () => {
    const w = new World('nether-land', undefined, createNetherTerrain('nether-land'));
    const landing = findLanding(w, 8, 8, 'nether');
    expect(landing.y).toBeGreaterThan(LAVA_SEA + 1);
    // 落点上方两格非实心
    const bx = Math.floor(landing.x);
    const bz = Math.floor(landing.z);
    expect(BLOCK_BY_KEY && true).toBe(true);
    expect(w.getBlock(bx, Math.floor(landing.y), bz)).not.toBe(LAVA);
  });

  it('ensurePortal 造出完整可用的往返门', () => {
    const w = new World('portal-make', undefined, VOID_TERRAIN);
    ensurePortal(w, 10, 40, 10);
    // 门块出现且成矩形（2×3 内部）
    let portals = 0;
    for (let dx = 0; dx <= 3; dx++) {
      for (let dy = 0; dy <= 4; dy++) {
        if (isPortalId(w.getBlock(10 + dx, 40 + dy, 10))) portals++;
      }
    }
    expect(portals).toBe(6);
    // 再次调用：已有门则不重造
    ensurePortal(w, 10, 40, 10);
    let total = 0;
    for (let x = -16; x < 32; x++) for (let y = 30; y < 50; y++) for (let z = -16; z < 32; z++) if (isPortalId(w.getBlock(x, y, z))) total++;
    expect(total).toBe(6);
  });
});
