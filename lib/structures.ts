// 结构生成：区域级确定性（平原/森林/盆地村庄、沙漠村庄、哨塔、冰屋），跨 chunk 一致

import { AIR, BLOCK_BY_KEY, COBBLE, DIRT, GLASS, LOG, PLANKS, WATER, WHEAT_CROP_0, type BlockId } from './blocks';
import { hash2, SEA_LEVEL, type Terrain } from './noise';
import { CHUNK_SIZE, WORLD_HEIGHT, localIndex } from './world';

const REGION = 64; // 结构区域边长（格）

export type StructureKind = 'village' | 'desert_village' | 'watchtower' | 'igloo';

export interface StructureSpot {
  kind: StructureKind;
  x: number;
  z: number;
}

export interface Structure {
  type: 'hut' | 'well' | 'farm';
  x: number;
  z: number;
}

function regionHash(seedHash: number, rx: number, rz: number, salt: number): number {
  let h = seedHash ^ Math.imul(rx, 374761393) ^ Math.imul(rz, 668265263) ^ Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 平坦度检查：中心及四角 16 格内高差不超过 6 */
function flatEnough(terrain: Terrain, x: number, z: number): boolean {
  const hs = [
    terrain.heightAt(x, z),
    terrain.heightAt(x - 16, z),
    terrain.heightAt(x + 16, z),
    terrain.heightAt(x, z - 16),
    terrain.heightAt(x, z + 16),
  ];
  return Math.max(...hs) - Math.min(...hs) <= 6;
}

/** 该区域生成什么结构（按群系与区域哈希；海洋/河流不生成） */
export function structureAt(seedHash: number, terrain: Terrain, rx: number, rz: number): StructureSpot | null {
  const x = rx * REGION + 32;
  const z = rz * REGION + 32;
  const biome = terrain.biomeAt(x, z);
  const h = terrain.heightAt(x, z);
  if (h <= SEA_LEVEL + 1) return null;
  if (!flatEnough(terrain, x, z)) return null;
  const r = regionHash(seedHash, rx, rz, 1);
  switch (biome) {
    case 'plains':
    case 'forest':
    case 'basin':
      if (r < 0.1) return { kind: 'village', x, z };
      if (r < 0.13) return { kind: 'watchtower', x, z };
      return null;
    case 'desert':
      if (r < 0.09) return { kind: 'desert_village', x, z };
      if (r < 0.12) return { kind: 'watchtower', x, z };
      return null;
    case 'ice':
      if (r < 0.08) return { kind: 'igloo', x, z };
      return null;
    default:
      return null;
  }
}

/** 兼容旧接口：平原/盆地村庄判定（沙漠村庄不含） */
export function villageAt(seedHash: number, terrain: Terrain, rx: number, rz: number): { x: number; z: number } | null {
  const s = structureAt(seedHash, terrain, rx, rz);
  return s && s.kind === 'village' ? { x: s.x, z: s.z } : null;
}

/** 玩家附近是否有村庄中心（用于村民生成；含沙漠村庄） */
export function villageCenterNear(seedHash: number, terrain: Terrain, x: number, z: number, maxDist: number): { x: number; z: number } | null {
  const rx = Math.floor(x / REGION);
  const rz = Math.floor(z / REGION);
  for (let drx = -1; drx <= 1; drx++) {
    for (let drz = -1; drz <= 1; drz++) {
      const s = structureAt(seedHash, terrain, rx + drx, rz + drz);
      if (s && (s.kind === 'village' || s.kind === 'desert_village') && Math.hypot(s.x - x, s.z - z) <= maxDist) {
        return { x: s.x, z: s.z };
      }
    }
  }
  return null;
}

/** 村庄布局：中心一口井 + 环形分布 3-6 栋小屋 + 1-2 块农田（确定性） */
export function villageStructures(seedHash: number, rx: number, rz: number, vx: number, vz: number): Structure[] {
  const structures: Structure[] = [{ type: 'well', x: vx, z: vz }];
  const n = 3 + Math.floor(regionHash(seedHash, rx, rz, 2) * 4);
  const ang0 = regionHash(seedHash, rx, rz, 3) * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const ang = ang0 + (i * Math.PI * 2) / n;
    const r = 10 + regionHash(seedHash, rx, rz, 10 + i) * 10;
    structures.push({ type: 'hut', x: Math.round(vx + Math.cos(ang) * r), z: Math.round(vz + Math.sin(ang) * r) });
  }
  // 农田：1-2 块，插在小屋之间的环上
  const farms = 1 + Math.floor(regionHash(seedHash, rx, rz, 20) * 2);
  for (let i = 0; i < farms; i++) {
    const ang = ang0 + ((i + 0.5) * Math.PI * 2) / n;
    const r = 12 + regionHash(seedHash, rx, rz, 21 + i) * 8;
    structures.push({ type: 'farm', x: Math.round(vx + Math.cos(ang) * r), z: Math.round(vz + Math.sin(ang) * r) });
  }
  return structures;
}

// ——— 材质方案（平原村庄用圆石+橡木，沙漠村庄用砂岩系） ———
interface VillageMats {
  floor: BlockId;
  pillar: BlockId;
  wall: BlockId;
  roof: BlockId;
  well: BlockId;
}

const K = (key: string) => BLOCK_BY_KEY[key].id;

const PLAINS_MATS: VillageMats = {
  floor: COBBLE,
  pillar: LOG,
  wall: PLANKS,
  roof: PLANKS,
  well: COBBLE,
};
const DESERT_MATS: VillageMats = {
  floor: K('sandstone'),
  pillar: K('sandstone'),
  wall: K('cut_sandstone'),
  roof: K('smooth_sandstone'),
  well: K('sandstone'),
};

function put(data: Uint16Array, cx: number, cz: number, x: number, y: number, z: number, id: number): void {
  const lx = x - cx * CHUNK_SIZE;
  const lz = z - cz * CHUNK_SIZE;
  if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return;
  data[localIndex(lx, y, lz)] = id;
}

function putBase(data: Uint16Array, cx: number, cz: number, x: number, y: number, z: number, id: number): void {
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

/** 小屋：5×5×4，地板、角柱、墙、门洞、玻璃窗、屋顶外挑 */
function writeHut(s: Structure, terrain: Terrain, cx: number, cz: number, data: Uint16Array, mats: VillageMats): void {
  const by = terrain.heightAt(s.x, s.z) + 1;
  const bx = s.x - 2;
  const bz = s.z - 2;
  for (let x = 0; x < 5; x++) {
    for (let z = 0; z < 5; z++) {
      putBase(data, cx, cz, bx + x, by, bz + z, mats.floor);
      for (let y = by + 1; y <= by + 3; y++) {
        const corner = (x === 0 || x === 4) && (z === 0 || z === 4);
        const edge = x === 0 || x === 4 || z === 0 || z === 4;
        const door = z === 4 && x === 2 && y <= by + 2;
        const win = y === by + 2 && ((x === 0 && z === 2) || (x === 4 && z === 2) || (z === 0 && x === 2));
        if (corner) put(data, cx, cz, bx + x, y, bz + z, mats.pillar);
        else if (door) put(data, cx, cz, bx + x, y, bz + z, AIR);
        else if (win) put(data, cx, cz, bx + x, y, bz + z, GLASS);
        else if (edge) put(data, cx, cz, bx + x, y, bz + z, mats.wall);
        else put(data, cx, cz, bx + x, y, bz + z, AIR); // 屋内清空
      }
    }
  }
  // 屋顶外挑 1 格
  for (let x = -1; x <= 5; x++) {
    for (let z = -1; z <= 5; z++) {
      put(data, cx, cz, bx + x, by + 4, bz + z, mats.roof);
    }
  }
  // 屋内角落放一张床（玩家可睡；村民的家更有生活气）
  put(data, cx, cz, bx + 1, by + 1, bz + 1, BLOCK_BY_KEY.red_bed.id);
}

/** 农田：5×3 地块，中间水渠 + 两侧湿润耕地，随机阶段的小麦（确定性） */
function writeFarm(s: Structure, terrain: Terrain, cx: number, cz: number, data: Uint16Array, seedHash: number): void {
  const moist = BLOCK_BY_KEY.farmland_moist.id;
  for (let x = -2; x <= 2; x++) {
    for (let z = -1; z <= 1; z++) {
      const px = s.x + x;
      const pz = s.z + z;
      const gy = terrain.heightAt(px, pz);
      if (gy < 0) continue;
      if (z === 0) {
        // 水渠：与耕地同层的水源（生成直写不触发流动）
        put(data, cx, cz, px, gy, pz, WATER);
      } else {
        put(data, cx, cz, px, gy, pz, moist);
        const stage = Math.floor(hash2(seedHash, px, pz) * 8);
        put(data, cx, cz, px, gy + 1, pz, WHEAT_CROP_0 + stage);
      }
    }
  }
}

/** 水井：4×4 环 + 2×2 水 */
function writeWell(s: Structure, terrain: Terrain, cx: number, cz: number, data: Uint16Array, mats: VillageMats): void {
  const by = terrain.heightAt(s.x, s.z) + 1;
  for (let x = -1; x <= 2; x++) {
    for (let z = -1; z <= 2; z++) {
      const edge = x === -1 || x === 2 || z === -1 || z === 2;
      if (edge) put(data, cx, cz, s.x + x, by, s.z + z, mats.well);
      else {
        put(data, cx, cz, s.x + x, by - 1, s.z + z, mats.well);
        put(data, cx, cz, s.x + x, by, s.z + z, WATER);
        put(data, cx, cz, s.x + x, by + 1, s.z + z, AIR);
      }
    }
  }
}

/** 土路：从小屋到水井的直线泥土径（仅替换实心地面表层） */
function writePath(a: Structure, b: Structure, terrain: Terrain, cx: number, cz: number, data: Uint16Array): void {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z));
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(a.x + ((b.x - a.x) * i) / steps);
    const z = Math.round(a.z + ((b.z - a.z) * i) / steps);
    const y = terrain.heightAt(x, z);
    if (y >= 0) put(data, cx, cz, x, y, z, DIRT);
  }
}

/** 哨塔：5×5 圆石塔身（12 高）+ 顶部木板瞭望台外挑 + 玻璃窗 */
function writeWatchtower(spot: StructureSpot, terrain: Terrain, cx: number, cz: number, data: Uint16Array): void {
  const by = terrain.heightAt(spot.x, spot.z) + 1;
  const bx = spot.x - 2;
  const bz = spot.z - 2;
  for (let x = 0; x < 5; x++) {
    for (let z = 0; z < 5; z++) {
      putBase(data, cx, cz, bx + x, by, bz + z, COBBLE);
      const edge = x === 0 || x === 4 || z === 0 || z === 4;
      for (let y = by + 1; y <= by + 11; y++) {
        if (!edge) {
          put(data, cx, cz, bx + x, y, bz + z, AIR); // 塔内中空
          continue;
        }
        const win = y >= by + 6 && y <= by + 7 && ((x === 0 && z === 2) || (x === 4 && z === 2) || (z === 0 && x === 2) || (z === 4 && x === 2));
        const door = z === 4 && x === 2 && y <= by + 2;
        if (door) put(data, cx, cz, bx + x, y, bz + z, AIR);
        else if (win) put(data, cx, cz, bx + x, y, bz + z, GLASS);
        else put(data, cx, cz, bx + x, y, bz + z, COBBLE);
      }
      // 瞭望台：地板外挑 1 格木板 + 圆石围栏 + 角柱
      for (let ox = -1; ox <= 5; ox++) {
        for (let oz = -1; oz <= 5; oz++) {
          const rim = ox === -1 || ox === 5 || oz === -1 || oz === 5;
          put(data, cx, cz, bx + ox, by + 12, bz + oz, rim ? COBBLE : PLANKS);
        }
      }
      put(data, cx, cz, bx + x, by + 13, bz + z, x % 2 === 0 && z % 2 === 0 && edge ? COBBLE : AIR);
    }
  }
}

/** 冰屋：雪块穹顶 + 南向门洞 + 冰窗 */
function writeIgloo(spot: StructureSpot, terrain: Terrain, cx: number, cz: number, data: Uint16Array): void {
  const snow = BLOCK_BY_KEY.snow_block.id;
  const ice = BLOCK_BY_KEY.ice.id;
  const cx0 = spot.x;
  const cz0 = spot.z;
  const by = terrain.heightAt(cx0, cz0) + 1;
  const R = 4;
  for (let dy = 0; dy <= R; dy++) {
    const r = Math.floor(Math.sqrt(R * R - dy * dy));
    for (let x = -r; x <= r; x++) {
      for (let z = -r; z <= r; z++) {
        const shell = Math.abs(Math.round(Math.sqrt(x * x + z * z)) - r) <= 0 || dy === R;
        if (!shell && dy > 0) continue;
        const door = z === r && x >= -1 && x <= 0 && dy >= 1 && dy <= 2;
        const win = x === -r && z === 0 && dy === 2;
        if (door) put(data, cx, cz, cx0 + x, by + dy, cz0 + z, AIR);
        else if (win) put(data, cx, cz, cx0 + x, by + dy, cz0 + z, ice);
        else put(data, cx, cz, cx0 + x, by + dy, cz0 + z, snow);
      }
    }
  }
  // 门廊（向南延伸 2 格的雪拱）
  for (let dz = 1; dz <= 2; dz++) {
    for (let dx = -1; dx <= 0; dx++) {
      put(data, cx, cz, cx0 + dx, by + 3, cz0 + R + dz - 1, snow);
    }
  }
}

/** 生成本 chunk 覆盖范围内的结构（检查本区域及相邻区域） */
export function applyStructures(seedHash: number, terrain: Terrain, cx: number, cz: number, data: Uint16Array): void {
  const rx = Math.floor((cx * CHUNK_SIZE) / REGION);
  const rz = Math.floor((cz * CHUNK_SIZE) / REGION);
  for (let drx = -1; drx <= 1; drx++) {
    for (let drz = -1; drz <= 1; drz++) {
      const spot = structureAt(seedHash, terrain, rx + drx, rz + drz);
      if (!spot) continue;
      if (spot.kind === 'village' || spot.kind === 'desert_village') {
        const mats = spot.kind === 'desert_village' ? DESERT_MATS : PLAINS_MATS;
        const structures = villageStructures(seedHash, rx + drx, rz + drz, spot.x, spot.z);
        const well = structures[0];
        for (const s of structures) {
          if (s.type === 'hut') {
            writeHut(s, terrain, cx, cz, data, mats);
            writePath(s, well, terrain, cx, cz, data);
          } else if (s.type === 'farm') {
            writeFarm(s, terrain, cx, cz, data, seedHash);
            writePath(s, well, terrain, cx, cz, data);
          } else {
            writeWell(s, terrain, cx, cz, data, mats);
          }
        }
      } else if (spot.kind === 'watchtower') {
        writeWatchtower(spot, terrain, cx, cz, data);
      } else {
        writeIgloo(spot, terrain, cx, cz, data);
      }
    }
  }
}
