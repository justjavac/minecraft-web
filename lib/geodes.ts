// 紫水晶洞：地下三层球壳（平滑玄武岩 → 方解石 → 紫水晶），内腔掏空、贴壳长晶簇；区域级确定性，跨 chunk 一致

import { AIR, BLOCK_BY_KEY } from './blocks';
import { hash2, type Terrain } from './noise';
import { CHUNK_SIZE, put } from './grid';

const REGION = 32; // 区域边长（格）
const R_OUT = 5.5; // 玄武岩外壳半径
const R_MID = 4.5; // 方解石中层半径
const R_IN = 3.5; // 紫水晶内壳半径

interface GeodeSpot {
  x: number;
  y: number;
  z: number;
}

/** 该区域是否有紫水晶洞（约 1/24 区域，中心 y 12-28） */
export function geodeAt(seedHash: number, rx: number, rz: number): GeodeSpot | null {
  const r0 = hash2(seedHash ^ 0x9e0d1a, rx, rz);
  if (r0 >= 1 / 24) return null;
  return {
    x: rx * REGION + 6 + Math.floor(hash2(seedHash ^ 0x9e0d2b, rx, rz) * 20),
    y: 12 + Math.floor(hash2(seedHash ^ 0x9e0d3c, rx, rz) * 17),
    z: rz * REGION + 6 + Math.floor(hash2(seedHash ^ 0x9e0d4d, rx, rz) * 20),
  };
}

/** 地形填充后调用：写入本 chunk 覆盖的晶洞部分（须在洞穴雕刻前，洞穴可自然把晶洞破开） */
export function applyGeodes(seedHash: number, terrain: Terrain, cx: number, cz: number, data: Uint16Array): void {
  const basalt = BLOCK_BY_KEY.smooth_basalt.id;
  const calcite = BLOCK_BY_KEY.calcite.id;
  const amethyst = BLOCK_BY_KEY.amethyst_block.id;
  const budding = BLOCK_BY_KEY.budding_amethyst.id;
  const cluster = BLOCK_BY_KEY.amethyst_cluster.id;

  const rx = Math.floor((cx * CHUNK_SIZE) / REGION);
  const rz = Math.floor((cz * CHUNK_SIZE) / REGION);
  for (let drx = -1; drx <= 1; drx++) {
    for (let drz = -1; drz <= 1; drz++) {
      const g = geodeAt(seedHash, rx + drx, rz + drz);
      if (!g) continue;
      // 整球埋在地下才生成（露出山坡/海床的不要）：球心加外壳轴向四端点都须低于地表，
      // 只查球心一列会让半径 5.5 的球边缘露出山坡
      const RB = Math.ceil(R_OUT);
      let exposed = false;
      for (const [ox, oz] of [[0, 0], [RB, 0], [-RB, 0], [0, RB], [0, -RB]] as const) {
        if (terrain.heightAt(g.x + ox, g.z + oz) < g.y + R_OUT + 2) {
          exposed = true;
          break;
        }
      }
      if (exposed) continue;
      const r = Math.ceil(R_OUT);
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dz = -r; dz <= r; dz++) {
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (d > R_OUT) continue;
            const x = g.x + dx;
            const y = g.y + dy;
            const z = g.z + dz;
            const cellR = hash2(seedHash ^ 0x9e0d5e, x * 31 + y, z * 17 - y);
            if (d > R_MID) {
              put(data, cx, cz, x, y, z, basalt);
            } else if (d > R_IN) {
              put(data, cx, cz, x, y, z, calcite);
            } else if (d > R_IN - 1.2) {
              // 紫水晶内壳：约 1/5 为母岩（MC 比例）
              put(data, cx, cz, x, y, z, cellR < 0.2 ? budding : amethyst);
            } else {
              // 内腔掏空：贴壳环带约 1/6 长晶簇，核心与其余各格为空气（不掏就是实心石球）
              put(data, cx, cz, x, y, z, d > R_IN - 2.2 && cellR < 0.16 ? cluster : AIR);
            }
          }
        }
      }
    }
  }
}
