import { describe, expect, it } from 'vitest';
import { GLASS, GRASS, LOG, PLANKS } from '../blocks';
import { createTerrain, hashString, type Terrain } from '../noise';
import { applyStructures, villageAt, villageStructures } from '../structures';
import { CHUNK_SIZE, WORLD_HEIGHT, localIndex } from '../world';

const SEED = 'village-test';

function findVillageRegion(seedHash: number, terrain: Terrain): { rx: number; rz: number } {
  for (let rx = -20; rx < 20; rx++) {
    for (let rz = -20; rz < 20; rz++) {
      if (villageAt(seedHash, terrain, rx, rz)) return { rx, rz };
    }
  }
  throw new Error('该种子在 ±20 区域内没有村庄');
}

describe('村庄结构', () => {
  it('村庄判定确定性一致', () => {
    const t = createTerrain(SEED);
    const sh = hashString(SEED);
    expect(villageAt(sh, t, 3, -2)).toEqual(villageAt(sh, t, 3, -2));
  });

  it('布局确定性：中心水井 + 至少 3 栋小屋', () => {
    const t = createTerrain(SEED);
    const sh = hashString(SEED);
    const { rx, rz } = findVillageRegion(sh, t);
    const v = villageAt(sh, t, rx, rz)!;
    const s1 = villageStructures(sh, rx, rz, v.x, v.z);
    const s2 = villageStructures(sh, rx, rz, v.x, v.z);
    expect(s1).toEqual(s2);
    expect(s1[0].type).toBe('well');
    expect(s1.filter((s) => s.type === 'hut').length).toBeGreaterThanOrEqual(3);
  });

  it('小屋写入正确方块：原木角柱、木板顶、门洞为空', () => {
    const t = createTerrain(SEED);
    const sh = hashString(SEED);
    const { rx, rz } = findVillageRegion(sh, t);
    const v = villageAt(sh, t, rx, rz)!;
    const hut = villageStructures(sh, rx, rz, v.x, v.z).find((s) => s.type === 'hut')!;
    const cx = Math.floor(hut.x / CHUNK_SIZE);
    const cz = Math.floor(hut.z / CHUNK_SIZE);
    const data = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT);
    // 铺一块平地当地基
    const h = t.heightAt(hut.x, hut.z);
    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let z = 0; z < CHUNK_SIZE; z++) data[localIndex(x, h, z)] = GRASS;
    }
    applyStructures(sh, t, cx, cz, data);
    const at = (wx: number, y: number, wz: number) => data[localIndex(wx - cx * CHUNK_SIZE, y, wz - cz * CHUNK_SIZE)];
    expect(at(hut.x - 2, h + 2, hut.z - 2)).toBe(LOG); // 角柱（地板在 h+1，墙从 h+2 起）
    expect(at(hut.x, h + 5, hut.z)).toBe(PLANKS); // 屋顶
    expect(at(hut.x, h + 2, hut.z + 2)).toBe(0); // 门洞（南墙中央）
    expect(at(hut.x - 2, h + 3, hut.z)).toBe(GLASS); // 西墙玻璃窗
  });
});
