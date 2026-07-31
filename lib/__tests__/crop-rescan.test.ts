// 读档/生成直写 chunk data 后的重扫登记：作物与树苗恢复生长、村庄农田小麦开始生长

import { beforeEach, describe, expect, it } from 'vitest';
import { BLOCK_BY_KEY, WHEAT_CROP_0 } from '../blocks';
import { rescanCropsChunk, tickCrops } from '../crops';
import { worldClock } from '../game';
import { createTerrain, hashString, VOID_TERRAIN } from '../noise';
import { rescanSaplingsChunk, tickSaplings } from '../saplings';
import { structureAt, villageStructures } from '../structures';
import { World } from '../world';
import { clearWorldScopes } from '../worldScope';

const MOIST = () => BLOCK_BY_KEY.farmland_moist.id;

/** 直写 chunk data（模拟世界生成/读档恢复：不走 world.setBlock 钩子） */
function writeRaw(w: World, x: number, y: number, z: number, id: number): void {
  const c = w.getChunk(x >> 4, z >> 4);
  c.data[(y * 16 + (z & 15)) * 16 + (x & 15)] = id;
}

beforeEach(() => {
  clearWorldScopes();
  worldClock.t = 0.3; // 白天
});

describe('作物重扫登记（读档恢复生长）', () => {
  it('直写 data 的作物不重扫永不生长；rescan 后 tickCrops 能推进', () => {
    const w = new World('crop-rescan', undefined, VOID_TERRAIN);
    writeRaw(w, 4, 30, 4, MOIST());
    writeRaw(w, 4, 31, 4, WHEAT_CROP_0);
    w.chunks.get('0,0')!.sky.fill(15);
    // 未重扫：登记为空，再多 tick 也不长
    for (let i = 0; i < 100; i++) tickCrops(w, 2);
    expect(w.getBlock(4, 31, 4)).toBe(WHEAT_CROP_0);
    // 重扫（读档恢复路径）：作物开始生长直到成熟
    rescanCropsChunk(w, 0, 0);
    for (let i = 0; i < 800 && w.getBlock(4, 31, 4) < WHEAT_CROP_0 + 7; i++) tickCrops(w, 2);
    expect(w.getBlock(4, 31, 4)).toBe(WHEAT_CROP_0 + 7);
  });

  it('rescan 幂等：重复扫描不重复登记、不影响生长', () => {
    const w = new World('crop-rescan-idem', undefined, VOID_TERRAIN);
    writeRaw(w, 4, 30, 4, MOIST());
    writeRaw(w, 4, 31, 4, WHEAT_CROP_0 + 3);
    w.chunks.get('0,0')!.sky.fill(15);
    rescanCropsChunk(w, 0, 0);
    rescanCropsChunk(w, 0, 0);
    rescanCropsChunk(w, 0, 0);
    for (let i = 0; i < 800 && w.getBlock(4, 31, 4) === WHEAT_CROP_0 + 3; i++) tickCrops(w, 2);
    expect(w.getBlock(4, 31, 4)).toBeGreaterThan(WHEAT_CROP_0 + 3);
  });

  it('rescan 覆盖耕地登记：直写的干耕地参与水润湿', () => {
    const w = new World('farmland-rescan', undefined, VOID_TERRAIN);
    writeRaw(w, 4, 30, 4, BLOCK_BY_KEY.farmland.id);
    writeRaw(w, 6, 30, 4, BLOCK_BY_KEY.water.id);
    rescanCropsChunk(w, 0, 0);
    tickCrops(w, 2);
    expect(w.getBlock(4, 30, 4)).toBe(MOIST());
  });
});

describe('树苗重扫登记（读档恢复生长）', () => {
  it('直写 data 的树苗 rescan 后能长成树', () => {
    const w = new World('sapling-rescan', undefined, VOID_TERRAIN);
    writeRaw(w, 8, 30, 8, BLOCK_BY_KEY.oak_sapling.id);
    // 未重扫：不生长
    for (let i = 0; i < 50; i++) tickSaplings(w, 2);
    expect(w.getBlock(8, 30, 8)).toBe(BLOCK_BY_KEY.oak_sapling.id);
    // 重扫后：1/25 概率 × 多次 2s tick，统计上必长成
    rescanSaplingsChunk(w, 0, 0);
    let grown = false;
    for (let i = 0; i < 200 && !grown; i++) {
      tickSaplings(w, 2);
      grown = w.getBlock(8, 30, 8) === BLOCK_BY_KEY.log.id;
    }
    expect(grown).toBe(true);
  });
});

describe('村庄农田（生成直写的小麦靠重扫开始生长）', () => {
  it('真实村庄农田：rescan 后未成熟小麦能被 tickCrops 推进', () => {
    const seed = 'vf-rescan-village';
    const terrain = createTerrain(seed);
    const seedHash = hashString(seed);
    let spot: { x: number; z: number; rx: number; rz: number } | null = null;
    for (let rx = -16; rx < 16 && !spot; rx++) {
      for (let rz = -16; rz < 16 && !spot; rz++) {
        const s = structureAt(seedHash, terrain, rx, rz);
        if (s?.kind.endsWith('village')) spot = { x: s.x, z: s.z, rx, rz };
      }
    }
    expect(spot).not.toBeNull();
    const w = new World(seed);
    const farm = villageStructures(seedHash, spot!.rx, spot!.rz, spot!.x, spot!.z).find((s) => s.type === 'farm');
    expect(farm).toBeDefined();
    // 找一块生成出来的未成熟小麦，压回 0 阶段（直写 data，模拟读档恢复时的任意阶段）
    let target: { x: number; y: number; z: number } | null = null;
    for (let x = farm!.x - 2; x <= farm!.x + 2 && !target; x++) {
      for (let z = farm!.z - 1; z <= farm!.z + 1 && !target; z++) {
        const gy = w.terrain.heightAt(x, z);
        const above = w.getBlock(x, gy + 1, z); // 触发 chunk 生成（writeFarm 在此直写小麦）
        if (above >= WHEAT_CROP_0 && above < WHEAT_CROP_0 + 7) {
          writeRaw(w, x, gy + 1, z, WHEAT_CROP_0);
          target = { x, y: gy + 1, z };
        }
      }
    }
    expect(target).not.toBeNull();
    // 重扫农田所在 chunk（生成路径不经 setBlock 钩子，登记全靠这里）
    rescanCropsChunk(w, target!.x >> 4, target!.z >> 4);
    for (let i = 0; i < 800 && w.getBlock(target!.x, target!.y, target!.z) === WHEAT_CROP_0; i++) tickCrops(w, 2);
    expect(w.getBlock(target!.x, target!.y, target!.z)).toBeGreaterThan(WHEAT_CROP_0);
  });
});
