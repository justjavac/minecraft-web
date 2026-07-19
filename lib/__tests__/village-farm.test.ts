// 耕种/养殖/村庄优化：水润湿、黑暗不长、恋爱配对、持食引诱、村民锚定、村庄农田

import { beforeEach, describe, expect, it } from 'vitest';
import { BLOCK_BY_KEY, STONE, WATER, WHEAT_CROP_0 } from '../blocks';
import { isFarmlandId, notifyCropBlockSet, tickCrops } from '../crops';
import { worldClock } from '../game';
import { BREED_FOOD, clearMobs, feedMob, mobs, tickMobs } from '../mobs';
import { createTerrain, hashString, VOID_TERRAIN } from '../noise';
import { structureAt, villageStructures } from '../structures';
import { World } from '../world';

const FARMLAND = () => BLOCK_BY_KEY.farmland.id;
const MOIST = () => BLOCK_BY_KEY.farmland_moist.id;
const P = { x: 0, y: 40, z: 0 };

function mkWorld(): World {
  return new World('vf-test', undefined, VOID_TERRAIN);
}

/** 带地板的虚空世界（生物站立用） */
function floorWorld(): World {
  const w = mkWorld();
  for (let x = -16; x <= 48; x++) {
    for (let z = -16; z <= 48; z++) w.setBlock(x, 39, z, STONE);
  }
  return w;
}

function mkMob(type: 'pig' | 'cow' | 'chicken' | 'villager', x: number, z: number): void {
  mobs.push({
    id: mobs.length + 1, type, x, y: 40, z, velY: 0, hp: 10, attackCd: 0, onGround: true,
    wanderDir: 0, wanderTimer: 99, wanderMoving: false, fleeTimer: 0, fleeFromX: 0, fleeFromZ: 0,
    arrowCd: 0, ignite: -1,
  });
}

beforeEach(() => {
  clearMobs();
  worldClock.t = 0.3; // 白天
});

describe('耕地维护', () => {
  it('4 格内有水：干耕地变湿润；水没了变回干', () => {
    const w = mkWorld();
    w.setBlock(4, 30, 4, FARMLAND());
    w.setBlock(4, 31, 4, WHEAT_CROP_0); // 有作物压着，干旱退化不会触发
    w.setBlock(6, 30, 4, WATER);
    notifyCropBlockSet(4, 30, 4, FARMLAND());
    tickCrops(w, 2);
    expect(w.getBlock(4, 30, 4)).toBe(MOIST());
    // 水抽干
    w.setBlock(6, 30, 4, 0);
    tickCrops(w, 2);
    expect(w.getBlock(4, 30, 4)).toBe(FARMLAND());
  });

  it('黑暗环境作物不生长；补光后生长', () => {
    const w = mkWorld();
    w.setBlock(4, 30, 4, FARMLAND());
    w.setBlock(4, 31, 4, WHEAT_CROP_0);
    // 虚空世界天空光 0；夜晚（dayFactor 0）
    worldClock.t = 0.75;
    for (let i = 0; i < 50; i++) tickCrops(w, 2);
    expect(w.getBlock(4, 31, 4)).toBe(WHEAT_CROP_0); // 没长
    // 白天 + 天空光
    worldClock.t = 0.3;
    w.chunks.get('0,0')!.sky.fill(15);
    for (let i = 0; i < 800 && w.getBlock(4, 31, 4) === WHEAT_CROP_0; i++) tickCrops(w, 2);
    expect(w.getBlock(4, 31, 4)).toBeGreaterThan(WHEAT_CROP_0);
  });
});

describe('繁殖优化', () => {
  it('喂食进入恋爱并回血', () => {
    mkMob('pig', 0, 0);
    mobs[0].hp = 5;
    feedMob(mobs[0]);
    expect(mobs[0].loveTimer).toBeGreaterThan(0);
    expect(mobs[0].hp).toBe(9);
    expect(BREED_FOOD.pig).toBe('wheat');
    expect(BREED_FOOD.chicken).toBe('wheat_seeds');
  });

  it('两只恋爱同种靠近产仔并进冷却；单只不产仔', { timeout: 30000 }, () => {
    const w = floorWorld();
    mkMob('cow', 0, 0);
    mkMob('cow', 3, 0);
    feedMob(mobs[0]);
    // 单只恋爱：tick 后不产仔
    for (let i = 0; i < 20; i++) tickMobs(w, 0.1, P, () => {});
    expect(mobs.length).toBe(2);
    // 第二只也恋爱：靠近后产仔
    feedMob(mobs[1]);
    for (let i = 0; i < 60 && mobs.length === 2; i++) tickMobs(w, 0.1, P, () => {});
    expect(mobs.length).toBe(3);
    expect(mobs[2].baby).toBe(true);
    expect(mobs[0].breedCd).toBeGreaterThan(0);
    expect(mobs[1].breedCd).toBeGreaterThan(0);
  });

  it('持食引诱：拿小麦时牛走向玩家，拿种子时不理', { timeout: 30000 }, () => {
    const w = floorWorld();
    mkMob('cow', 6, 0);
    const x0 = mobs[0].x;
    for (let i = 0; i < 20; i++) tickMobs(w, 0.1, P, () => {}, 'wheat');
    expect(mobs[0].x).toBeLessThan(x0); // 靠近玩家（x=0）
    const x1 = mobs[0].x;
    for (let i = 0; i < 20; i++) tickMobs(w, 0.1, P, () => {}, 'wheat_seeds');
    expect(mobs[0].x).toBeGreaterThanOrEqual(x1 - 0.01); // 不再被吸引
  });
});

describe('村民锚定村庄', () => {
  it('远离锚点的村民往回走', { timeout: 30000 }, () => {
    const w = floorWorld();
    mkMob('villager', 30, 0);
    mobs[0].homeX = 0;
    mobs[0].homeZ = 0;
    for (let i = 0; i < 20; i++) tickMobs(w, 0.1, { x: 60, y: 40, z: 60 }, () => {});
    expect(mobs[0].x).toBeLessThan(30); // 朝村庄中心走
  });
});

describe('村庄农田', () => {
  it('布局含 1-2 块农田（类型 farm）', () => {
    const structs = villageStructures(12345, 0, 0, 32, 32);
    const farms = structs.filter((s) => s.type === 'farm');
    expect(farms.length).toBeGreaterThanOrEqual(1);
    expect(farms.length).toBeLessThanOrEqual(2);
    // 每个农田位置距村中心 12-20 环上
    for (const f of farms) {
      const d = Math.hypot(f.x - 32, f.z - 32);
      expect(d).toBeGreaterThan(8);
      expect(d).toBeLessThan(24);
    }
  });

  it('真实世界找到村庄：农田写进水渠 + 湿润耕地 + 小麦，小屋有床', () => {
    const seed = 'vf-village';
    const terrain = createTerrain(seed);
    const seedHash = hashString(seed);
    // 扫描区域找第一个平原村庄
    let spot: { x: number; z: number; rx: number; rz: number } | null = null;
    for (let rx = 0; rx < 16 && !spot; rx++) {
      for (let rz = 0; rz < 16 && !spot; rz++) {
        const s = structureAt(seedHash, terrain, rx, rz);
        if (s?.kind === 'village') spot = { x: s.x, z: s.z, rx, rz };
      }
    }
    expect(spot).not.toBeNull();
    const w = new World(seed);
    const structs = villageStructures(seedHash, spot!.rx, spot!.rz, spot!.x, spot!.z);
    // 农田：水渠 + 湿润耕地 + 小麦
    const farm = structs.find((s) => s.type === 'farm');
    expect(farm).toBeDefined();
    let water = 0;
    let moist = 0;
    let crop = 0;
    for (let x = farm!.x - 2; x <= farm!.x + 2; x++) {
      for (let z = farm!.z - 1; z <= farm!.z + 1; z++) {
        const gy = w.terrain.heightAt(x, z);
        const id = w.getBlock(x, gy, z);
        if (id === WATER) water++;
        if (isFarmlandId(id)) moist++;
        const above = w.getBlock(x, gy + 1, z);
        if (above >= WHEAT_CROP_0 && above <= WHEAT_CROP_0 + 7) crop++;
      }
    }
    expect(water).toBeGreaterThan(0);
    expect(moist).toBeGreaterThan(0);
    expect(crop).toBeGreaterThan(0);
    // 小屋：屋内 (bx+1, by+1, bz+1) 有床
    const hut = structs.find((s) => s.type === 'hut');
    const by = w.terrain.heightAt(hut!.x, hut!.z) + 1;
    expect(w.getBlock(hut!.x - 1, by + 1, hut!.z - 1)).toBe(BLOCK_BY_KEY.red_bed.id);
  });
});
