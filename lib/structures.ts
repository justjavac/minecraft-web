// 村庄结构：区域级确定性生成（小屋/水井/土路），跨 chunk 一致

import { AIR, COBBLE, DIRT, GLASS, LOG, PLANKS, WATER } from './blocks';
import { SEA_LEVEL, type Terrain } from './noise';
import { CHUNK_SIZE, WORLD_HEIGHT, localIndex } from './world';

const REGION = 64; // 村庄区域边长（格）
const VILLAGE_CHANCE = 0.12; // 每个区域 12% 概率出村庄

export interface Structure {
  type: 'hut' | 'well';
  x: number;
  z: number;
}

function regionHash(seedHash: number, rx: number, rz: number, salt: number): number {
  let h = seedHash ^ Math.imul(rx, 374761393) ^ Math.imul(rz, 668265263) ^ Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 该区域是否有村庄：12% 概率 + 中心高于海面 + 基本平坦 */
export function villageAt(seedHash: number, terrain: Terrain, rx: number, rz: number): { x: number; z: number } | null {
  if (regionHash(seedHash, rx, rz, 1) >= VILLAGE_CHANCE) return null;
  const cx = rx * REGION + 32;
  const cz = rz * REGION + 32;
  const h = terrain.heightAt(cx, cz);
  if (h <= SEA_LEVEL + 1) return null;
  const hs = [
    h,
    terrain.heightAt(cx - 16, cz),
    terrain.heightAt(cx + 16, cz),
    terrain.heightAt(cx, cz - 16),
    terrain.heightAt(cx, cz + 16),
  ];
  if (Math.max(...hs) - Math.min(...hs) > 6) return null;
  return { x: cx, z: cz };
}

/** 村庄布局：中心一口井 + 环形分布 3-6 栋小屋（确定性） */
export function villageStructures(seedHash: number, rx: number, rz: number, vx: number, vz: number): Structure[] {
  const structures: Structure[] = [{ type: 'well', x: vx, z: vz }];
  const n = 3 + Math.floor(regionHash(seedHash, rx, rz, 2) * 4);
  const ang0 = regionHash(seedHash, rx, rz, 3) * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const ang = ang0 + (i * Math.PI * 2) / n;
    const r = 10 + regionHash(seedHash, rx, rz, 10 + i) * 10;
    structures.push({ type: 'hut', x: Math.round(vx + Math.cos(ang) * r), z: Math.round(vz + Math.sin(ang) * r) });
  }
  return structures;
}

/** 玩家附近是否有村庄中心（用于村民生成） */
export function villageCenterNear(seedHash: number, terrain: Terrain, x: number, z: number, maxDist: number): { x: number; z: number } | null {
  const rx = Math.floor(x / REGION);
  const rz = Math.floor(z / REGION);
  for (let drx = -1; drx <= 1; drx++) {
    for (let drz = -1; drz <= 1; drz++) {
      const v = villageAt(seedHash, terrain, rx + drx, rz + drz);
      if (v && Math.hypot(v.x - x, v.z - z) <= maxDist) return v;
    }
  }
  return null;
}

function put(data: Uint8Array, cx: number, cz: number, x: number, y: number, z: number, id: number): void {
  const lx = x - cx * CHUNK_SIZE;
  const lz = z - cz * CHUNK_SIZE;
  if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return;
  data[localIndex(lx, y, lz)] = id;
}

function putBase(data: Uint8Array, cx: number, cz: number, x: number, y: number, z: number, id: number): void {
  // 地板 + 地板下空隙回填（最多 3 格，只在本 chunk 内读写）
  put(data, cx, cz, x, y, z, id);
  const lx = x - cx * CHUNK_SIZE;
  const lz = z - cz * CHUNK_SIZE;
  if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return;
  for (let dy = 1; dy <= 3; dy++) {
    if (y - dy < 0) break;
    if (data[localIndex(lx, y - dy, lz)] !== AIR) break;
    data[localIndex(lx, y - dy, lz)] = id;
  }
}

/** 小屋：5×5×4，圆石地板、原木角柱、木板墙、门洞、玻璃窗、木板顶 */
function writeHut(s: Structure, terrain: Terrain, cx: number, cz: number, data: Uint8Array): void {
  const by = terrain.heightAt(s.x, s.z) + 1;
  const bx = s.x - 2;
  const bz = s.z - 2;
  for (let x = 0; x < 5; x++) {
    for (let z = 0; z < 5; z++) {
      putBase(data, cx, cz, bx + x, by, bz + z, COBBLE);
      for (let y = by + 1; y <= by + 3; y++) {
        const corner = (x === 0 || x === 4) && (z === 0 || z === 4);
        const edge = x === 0 || x === 4 || z === 0 || z === 4;
        const door = z === 4 && x === 2 && y <= by + 2;
        const win = y === by + 2 && ((x === 0 && z === 2) || (x === 4 && z === 2) || (z === 0 && x === 2));
        if (corner) put(data, cx, cz, bx + x, y, bz + z, LOG);
        else if (door) put(data, cx, cz, bx + x, y, bz + z, AIR);
        else if (win) put(data, cx, cz, bx + x, y, bz + z, GLASS);
        else if (edge) put(data, cx, cz, bx + x, y, bz + z, PLANKS);
        else put(data, cx, cz, bx + x, y, bz + z, AIR); // 屋内清空
      }
    }
  }
  // 屋顶外挑 1 格
  for (let x = -1; x <= 5; x++) {
    for (let z = -1; z <= 5; z++) {
      put(data, cx, cz, bx + x, by + 4, bz + z, PLANKS);
    }
  }
}

/** 水井：4×4 圆石环 + 2×2 水 */
function writeWell(s: Structure, terrain: Terrain, cx: number, cz: number, data: Uint8Array): void {
  const by = terrain.heightAt(s.x, s.z) + 1;
  for (let x = -1; x <= 2; x++) {
    for (let z = -1; z <= 2; z++) {
      const edge = x === -1 || x === 2 || z === -1 || z === 2;
      if (edge) put(data, cx, cz, s.x + x, by, s.z + z, COBBLE);
      else {
        put(data, cx, cz, s.x + x, by - 1, s.z + z, COBBLE);
        put(data, cx, cz, s.x + x, by, s.z + z, WATER);
        put(data, cx, cz, s.x + x, by + 1, s.z + z, AIR);
      }
    }
  }
}

/** 土路：从小屋到水井的直线泥土径（仅替换实心地面表层） */
function writePath(a: Structure, b: Structure, terrain: Terrain, cx: number, cz: number, data: Uint8Array): void {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z));
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(a.x + ((b.x - a.x) * i) / steps);
    const z = Math.round(a.z + ((b.z - a.z) * i) / steps);
    const y = terrain.heightAt(x, z);
    if (y >= 0) put(data, cx, cz, x, y, z, DIRT);
  }
}

/** 生成本 chunk 覆盖范围内的村庄结构（检查本区域及相邻区域的村庄） */
export function applyStructures(seedHash: number, terrain: Terrain, cx: number, cz: number, data: Uint8Array): void {
  const rx = Math.floor((cx * CHUNK_SIZE) / REGION);
  const rz = Math.floor((cz * CHUNK_SIZE) / REGION);
  for (let drx = -1; drx <= 1; drx++) {
    for (let drz = -1; drz <= 1; drz++) {
      const v = villageAt(seedHash, terrain, rx + drx, rz + drz);
      if (!v) continue;
      const structures = villageStructures(seedHash, rx + drx, rz + drz, v.x, v.z);
      const well = structures[0];
      for (const s of structures) {
        if (s.type === 'hut') {
          writeHut(s, terrain, cx, cz, data);
          writePath(s, well, terrain, cx, cz, data);
        } else {
          writeWell(s, terrain, cx, cz, data);
        }
      }
    }
  }
}
