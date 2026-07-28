// 紫水晶洞：内腔掏空成洞、三层外壳完整、埋藏检查覆盖球壳边缘、生成确定性

import { describe, expect, it } from 'vitest';
import { AIR, BLOCK_BY_KEY, STONE } from '../blocks';
import { applyGeodes, geodeAt } from '../geodes';
import { hashString, VOID_TERRAIN, type Terrain } from '../noise';
import { CHUNK_SIZE, CHUNK_VOLUME, localIndex } from '../world';

const BASALT = BLOCK_BY_KEY.smooth_basalt.id;
const CALCITE = BLOCK_BY_KEY.calcite.id;
const AMETHYST = BLOCK_BY_KEY.amethyst_block.id;
const BUDDING = BLOCK_BY_KEY.budding_amethyst.id;
const CLUSTER = BLOCK_BY_KEY.amethyst_cluster.id;

// 高地表 + 无洞穴：晶洞全埋，且写入不受其他生成阶段干扰
const TALL_TERRAIN: Terrain = { ...VOID_TERRAIN, heightAt: () => 64 };

interface Spot {
  x: number;
  y: number;
  z: number;
}

function findGeode(seedHash: number): Spot {
  for (let rx = 0; rx < 40; rx++) {
    for (let rz = 0; rz < 40; rz++) {
      const g = geodeAt(seedHash, rx, rz);
      if (g) return g;
    }
  }
  throw new Error('该种子 40×40 区域内没有紫晶洞');
}

/** 返回跨 chunk 读格子的函数：每个 chunk 先填石头再跑 applyGeodes（模拟地形填充后的晶洞写入） */
function sphereBlockAt(seedHash: number, terrain: Terrain): (x: number, y: number, z: number) => number {
  const chunks = new Map<string, Uint16Array>();
  return (x, y, z) => {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const key = `${cx},${cz}`;
    let data = chunks.get(key);
    if (!data) {
      data = new Uint16Array(CHUNK_VOLUME).fill(STONE);
      applyGeodes(seedHash, terrain, cx, cz, data);
      chunks.set(key, data);
    }
    return data[localIndex(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE)];
  };
}

describe('紫水晶洞', () => {
  it('内腔掏空：核心与非晶簇格为空气，贴壳环带长出晶簇', () => {
    const sh = hashString('geode-hollow');
    const g = findGeode(sh);
    const blockAt = sphereBlockAt(sh, TALL_TERRAIN);
    let clusters = 0;
    let hollow = 0;
    for (let dx = -5; dx <= 5; dx++) {
      for (let dy = -5; dy <= 5; dy++) {
        for (let dz = -5; dz <= 5; dz++) {
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d > 5.5) continue;
          const id = blockAt(g.x + dx, g.y + dy, g.z + dz);
          if (d > 4.5) expect(id).toBe(BASALT);
          else if (d > 3.5) expect(id).toBe(CALCITE);
          else if (d > 2.3) expect(id === AMETHYST || id === BUDDING).toBe(true);
          else {
            // 内腔（d ≤ 2.3）：只允许晶簇或空气——旧实现从不写空气，挖穿外壳看到的是实心石头核心
            expect(id === AIR || id === CLUSTER).toBe(true);
            if (id === CLUSTER) clusters++;
            else hollow++;
          }
        }
      }
    }
    expect(blockAt(g.x, g.y, g.z)).toBe(AIR); // 球心是空气：真正的洞腔
    expect(clusters).toBeGreaterThan(0);
    expect(hollow).toBeGreaterThan(0);
  });

  it('外壳三层完整，球外方块不被触碰', () => {
    const sh = hashString('geode-shell');
    const g = findGeode(sh);
    const blockAt = sphereBlockAt(sh, TALL_TERRAIN);
    expect(blockAt(g.x + 5, g.y, g.z)).toBe(BASALT); // d=5：玄武岩外壳
    expect(blockAt(g.x + 4, g.y, g.z)).toBe(CALCITE); // d=4：方解石中层
    const inner = blockAt(g.x + 3, g.y, g.z); // d=3：紫水晶内壳
    expect(inner === AMETHYST || inner === BUDDING).toBe(true);
    expect(blockAt(g.x + 7, g.y, g.z)).toBe(STONE); // 球外保持原地形
    expect(blockAt(g.x, g.y + 7, g.z)).toBe(STONE);
  });

  it('埋藏检查：球壳轴向端点露出地表则整洞不生成', () => {
    const sh = hashString('geode-burial');
    const g = findGeode(sh);
    // 东侧 +6 采样点地表低于球顶：旧版只查球心一列会照常生成，新版应整洞跳过
    const halfBuried: Terrain = {
      ...VOID_TERRAIN,
      heightAt: (x, z) => (x === g.x + 6 && z === g.z ? g.y : 64),
    };
    const blockAt = sphereBlockAt(sh, halfBuried);
    for (let dx = -5; dx <= 5; dx++) {
      for (let dy = -5; dy <= 5; dy++) {
        for (let dz = -5; dz <= 5; dz++) {
          expect(blockAt(g.x + dx, g.y + dy, g.z + dz)).toBe(STONE);
        }
      }
    }
    // 对照：同一晶洞全埋时照常生成
    expect(sphereBlockAt(sh, TALL_TERRAIN)(g.x + 5, g.y, g.z)).toBe(BASALT);
  });

  it('生成确定性：同参数两次写入结果一致', () => {
    const sh = hashString('geode-determinism');
    const g = findGeode(sh);
    const cx = Math.floor(g.x / CHUNK_SIZE);
    const cz = Math.floor(g.z / CHUNK_SIZE);
    const a = new Uint16Array(CHUNK_VOLUME).fill(STONE);
    const b = new Uint16Array(CHUNK_VOLUME).fill(STONE);
    applyGeodes(sh, TALL_TERRAIN, cx, cz, a);
    applyGeodes(sh, TALL_TERRAIN, cx, cz, b);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});
