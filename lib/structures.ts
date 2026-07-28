// 结构生成：区域级确定性（平原/热带草原/针叶林/沙漠村庄、哨塔、冰屋、沙漠神殿、丛林神庙），跨 chunk 一致

import { AIR, BLOCK_BY_KEY, COBBLE, DIRT, GLASS, LOG, PLANKS, WATER, WHEAT_CROP_0, type BlockId } from './blocks';
import { hash2, mulberry32, SEA_LEVEL, type Terrain } from './noise';
import { getStorage } from './storage';
import { CHUNK_SIZE, WORLD_HEIGHT, localIndex } from './world';

const REGION = 64; // 结构区域边长（格）

export type StructureKind = 'village' | 'desert_village' | 'savanna_village' | 'taiga_village' | 'watchtower' | 'igloo' | 'desert_temple' | 'jungle_temple' | 'ruined_portal' | 'ocean_monument' | 'shipwreck';

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

/** 该区域生成什么结构（按群系与区域哈希；河流不生成，海洋出遗迹与沉船） */
export function structureAt(seedHash: number, terrain: Terrain, rx: number, rz: number): StructureSpot | null {
  const x = rx * REGION + 32;
  const z = rz * REGION + 32;
  const biome = terrain.biomeAt(x, z);
  const h = terrain.heightAt(x, z);
  // 近水线以下不出陆地结构（海洋结构有自己的深度门）
  if (h <= SEA_LEVEL + 1 && biome !== 'ocean') return null;
  if (!flatEnough(terrain, x, z)) return null;
  const r = regionHash(seedHash, rx, rz, 1);
  // 废弃传送门：任何陆地群系都可能出（独立盐哈希，不吃村庄配额）
  if (
    regionHash(seedHash, rx, rz, 7) < 0.02 &&
    biome !== 'ocean' && biome !== 'river' && biome !== 'mushroom_fields'
  ) {
    return { kind: 'ruined_portal', x, z };
  }
  switch (biome) {
    // MC 村庄群系：平原 / 热带草原 / 针叶林 / 雪原 / 沙漠
    case 'plains':
      if (r < 0.1) return { kind: 'village', x, z };
      if (r < 0.13) return { kind: 'watchtower', x, z };
      return null;
    case 'savanna':
      if (r < 0.1) return { kind: 'savanna_village', x, z };
      return null;
    case 'taiga':
      if (r < 0.09) return { kind: 'taiga_village', x, z };
      return null;
    case 'snowy':
      if (r < 0.06) return { kind: 'taiga_village', x, z }; // 雪原村庄用云杉材质
      if (r < 0.1) return { kind: 'igloo', x, z };
      return null;
    case 'desert':
      if (r < 0.09) return { kind: 'desert_village', x, z };
      if (r < 0.12) return { kind: 'watchtower', x, z };
      if (r < 0.14) return { kind: 'desert_temple', x, z };
      return null;
    case 'jungle':
      if (r < 0.06) return { kind: 'jungle_temple', x, z };
      return null;
    case 'ocean':
      // 海底遗迹须足够深（殿堂整栋没入水中）；沉船在较浅海床
      if (r < 0.03 && h <= SEA_LEVEL - 10) return { kind: 'ocean_monument', x, z };
      if (r < 0.05 && h <= SEA_LEVEL - 2) return { kind: 'shipwreck', x, z };
      return null;
    case 'forest':
    case 'birch_forest':
    case 'basin':
      if (r < 0.03) return { kind: 'watchtower', x, z };
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
      if (s && s.kind.endsWith('village') && Math.hypot(s.x - x, s.z - z) <= maxDist) {
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
// 热带草原村庄：金合欢木（MC 一致）
const SAVANNA_MATS: VillageMats = {
  floor: COBBLE,
  pillar: K('acacia_log'),
  wall: K('acacia_planks'),
  roof: K('acacia_planks'),
  well: COBBLE,
};
// 针叶林/雪原村庄：云杉木（MC 一致）
const TAIGA_MATS: VillageMats = {
  floor: COBBLE,
  pillar: K('spruce_log'),
  wall: K('spruce_planks'),
  roof: K('spruce_planks'),
  well: COBBLE,
};

const VILLAGE_MATS: Record<StructureKind, VillageMats> = {
  village: PLAINS_MATS,
  desert_village: DESERT_MATS,
  savanna_village: SAVANNA_MATS,
  taiga_village: TAIGA_MATS,
  watchtower: PLAINS_MATS,
  igloo: PLAINS_MATS,
  desert_temple: PLAINS_MATS,
  jungle_temple: PLAINS_MATS,
  ruined_portal: PLAINS_MATS,
  ocean_monument: PLAINS_MATS,
  shipwreck: PLAINS_MATS,
};

function put(data: Uint16Array, cx: number, cz: number, x: number, y: number, z: number, id: number): void {
  const lx = x - cx * CHUNK_SIZE;
  const lz = z - cz * CHUNK_SIZE;
  if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return;
  data[localIndex(lx, y, lz)] = id;
}

function putBase(data: Uint16Array, cx: number, cz: number, x: number, y: number, z: number, id: number): void {
  // 地板 + 地板下柱桩回填直到触地（上限 12 格，MC 村庄在坡地用柱桩接地；只在本 chunk 内读写——邻 chunk 由各自写入补齐）
  put(data, cx, cz, x, y, z, id);
  const lx = x - cx * CHUNK_SIZE;
  const lz = z - cz * CHUNK_SIZE;
  if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return;
  for (let dy = 1; dy <= 12; dy++) {
    if (y - dy < 0) break;
    if (data[localIndex(lx, y - dy, lz)] !== AIR) break;
    data[localIndex(lx, y - dy, lz)] = id;
  }
}

/** 小屋：5×5×4，地板、角柱、墙、门洞、玻璃窗、屋顶外挑 */
function writeHut(s: Structure, terrain: Terrain, cx: number, cz: number, data: Uint16Array, mats: VillageMats): void {
  // 地板取 5×5 范围最低点（高侧墙嵌土、低侧柱桩接地，MC 坡地村舍做法）
  let baseH = terrain.heightAt(s.x, s.z);
  for (const [ox, oz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]] as const) {
    baseH = Math.min(baseH, terrain.heightAt(s.x + ox, s.z + oz));
  }
  const by = baseH + 1;
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
  // 基面取 4×4 范围最低点（嵌坡）
  let baseH = terrain.heightAt(s.x, s.z);
  for (const [ox, oz] of [[-1, -1], [2, -1], [-1, 2], [2, 2]] as const) {
    baseH = Math.min(baseH, terrain.heightAt(s.x + ox, s.z + oz));
  }
  const by = baseH + 1;
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
  // 基面取 5×5 范围最低点（嵌坡 + 柱桩接地）
  let baseH = terrain.heightAt(spot.x, spot.z);
  for (const [ox, oz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]] as const) {
    baseH = Math.min(baseH, terrain.heightAt(spot.x + ox, spot.z + oz));
  }
  const by = baseH + 1;
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

// ——— 神庙战利品（确定性预填宝箱；storages 随存档持久化） ———
export type LootEntry = [material: string, min: number, max: number, chance: number];

const DESERT_LOOT: LootEntry[] = [
  ['gold_ingot', 1, 4, 0.5],
  ['iron_ingot', 1, 3, 0.5],
  ['diamond', 1, 2, 0.25],
  ['emerald', 1, 2, 0.25],
  ['bone', 1, 5, 0.6],
  ['string', 1, 4, 0.6],
  ['wheat', 1, 4, 0.5],
];
const JUNGLE_LOOT: LootEntry[] = [
  ['gold_ingot', 1, 3, 0.5],
  ['iron_ingot', 1, 3, 0.5],
  ['bone', 1, 4, 0.6],
  ['arrow', 2, 6, 0.6],
  ['cooked_pork', 1, 2, 0.4],
];
const PORTAL_LOOT: LootEntry[] = [
  ['gold_ingot', 2, 6, 0.8],
  ['iron_ingot', 1, 3, 0.5],
  ['emerald', 1, 2, 0.3],
];
const SHIP_LOOT: LootEntry[] = [
  ['iron_ingot', 1, 4, 0.6],
  ['gold_ingot', 1, 3, 0.4],
  ['diamond', 1, 1, 0.2],
  ['leather', 1, 3, 0.5],
  ['emerald', 1, 2, 0.25],
];

/** 宝箱战利品预填（只填全空的新箱子；已初始化/被开过的跳过——跨 chunk 生成与重载均幂等） */
export function fillChest(seedHash: number, x: number, y: number, z: number, table: LootEntry[], blockExtra?: [id: BlockId, min: number, max: number, chance: number]): void {
  const key = `${x},${y},${z}`;
  const storage = getStorage(key);
  if (storage.some((s) => s !== null)) return;
  const rand = mulberry32((seedHash ^ Math.imul(x, 374761393) ^ Math.imul(y, 2246822519) ^ Math.imul(z, 668265263)) | 0);
  let slot = 0;
  for (const [material, min, max, chance] of table) {
    if (rand() >= chance) continue;
    storage[slot++] = { kind: 'material', material, count: min + Math.floor(rand() * (max - min + 1)) };
    if (slot >= storage.length) return;
  }
  if (blockExtra && rand() < blockExtra[3]) {
    storage[slot] = { kind: 'block', id: blockExtra[0], count: blockExtra[1] + Math.floor(rand() * (blockExtra[2] - blockExtra[1] + 1)) };
  }
}

/** 沙漠神殿：阶梯金字塔 + 南向入口 + 中央密藏室（4 宝箱 + TNT 陷阱层） */
function writeDesertTemple(spot: StructureSpot, terrain: Terrain, cx: number, cz: number, data: Uint16Array, seedHash: number): void {
  const sand = K('sandstone');
  const cut = K('cut_sandstone');
  const orange = K('orange_terracotta');
  const blue = K('blue_terracotta');
  const bx = spot.x;
  const bz = spot.z;
  const by = terrain.heightAt(bx, bz) + 1;
  // 地基 21×21（含向下回填）
  for (let x = -10; x <= 10; x++) for (let z = -10; z <= 10; z++) putBase(data, cx, cz, bx + x, by, bz + z, sand);
  // 阶梯塔身：5 层逐层内缩 2、各高 2，外缘切制砂岩描边
  for (let lvl = 0; lvl < 5; lvl++) {
    const r = 10 - lvl * 2;
    for (let x = -r; x <= r; x++) {
      for (let z = -r; z <= r; z++) {
        const edge = Math.abs(x) === r || Math.abs(z) === r;
        for (let dy = 1; dy <= 2; dy++) put(data, cx, cz, bx + x, by + lvl * 2 + dy, bz + z, edge ? cut : sand);
      }
    }
  }
  // 立面橙色陶瓦柱（MC 神殿标志纹样，南北两面 ±4 列）
  for (const sz of [-10, 10]) for (const sx of [-4, 4]) for (let dy = 1; dy <= 6; dy++) put(data, cx, cz, bx + sx, by + dy, bz + sz, orange);
  // 中央密藏室 5×5×4（蓝色中心地板）
  for (let x = -2; x <= 2; x++) {
    for (let z = -2; z <= 2; z++) {
      put(data, cx, cz, bx + x, by, bz + z, x === 0 && z === 0 ? blue : cut);
      for (let dy = 1; dy <= 4; dy++) put(data, cx, cz, bx + x, by + dy, bz + z, AIR);
    }
  }
  // 南向入口通道 3 宽
  for (let x = -1; x <= 1; x++) for (let z = 3; z <= 10; z++) for (let dy = 1; dy <= 3; dy++) put(data, cx, cz, bx + x, by + dy, bz + z, AIR);
  // 密藏坑：室底下 3 格，四角宝箱 + 室底下 TNT 层（MC 陷阱）
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) for (let dy = 1; dy <= 3; dy++) put(data, cx, cz, bx + x, by - dy, bz + z, AIR);
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) put(data, cx, cz, bx + x, by - 1, bz + z, K('tnt'));
  for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]] as const) {
    put(data, cx, cz, bx + dx, by - 3, bz + dz, K('chest'));
    fillChest(seedHash, bx + dx, by - 3, bz + dz, DESERT_LOOT);
  }
}

/** 丛林神庙：苔石殿 + 中层平台（底堂明置宝箱、平台暗格宝箱，战利品含竹子） */
function writeJungleTemple(spot: StructureSpot, terrain: Terrain, cx: number, cz: number, data: Uint16Array, seedHash: number): void {
  const mossy = K('mossy_cobblestone');
  const bx = spot.x;
  const bz = spot.z;
  const by = terrain.heightAt(bx, bz) + 1;
  const W = 7; // 半宽（15）
  const D = 5; // 半深（11）
  for (let x = -W; x <= W; x++) {
    for (let z = -D; z <= D; z++) {
      putBase(data, cx, cz, bx + x, by, bz + z, mossy);
      const edge = Math.abs(x) === W || Math.abs(z) === D;
      const corner = Math.abs(x) === W && Math.abs(z) === D;
      for (let dy = 1; dy <= 7; dy++) {
        if (!edge) {
          put(data, cx, cz, bx + x, by + dy, bz + z, AIR);
          continue;
        }
        put(data, cx, cz, bx + x, by + dy, bz + z, corner ? K('chiseled_stone_bricks') : hash2(seedHash, bx + x, bz + z) < 0.4 ? COBBLE : mossy);
      }
      // 顶盖（边缘石砖描边）
      put(data, cx, cz, bx + x, by + 8, bz + z, edge ? K('stone_bricks') : mossy);
    }
  }
  // 南向门洞
  for (let dy = 1; dy <= 3; dy++) put(data, cx, cz, bx, by + dy, bz + D, AIR);
  // 中层平台（后半，by+4）
  for (let x = -W + 1; x <= W - 1; x++) for (let z = -D + 1; z <= 0; z++) put(data, cx, cz, bx + x, by + 4, bz + z, mossy);
  // 底堂明置宝箱（北墙前）
  put(data, cx, cz, bx, by + 1, bz - D + 1, K('chest'));
  fillChest(seedHash, bx, by + 1, bz - D + 1, JUNGLE_LOOT, [K('bamboo'), 2, 6, 0.5]);
  // 平台暗格宝箱（东北角，苔石封盖）
  put(data, cx, cz, bx + W - 1, by + 5, bz - D + 1, K('chest'));
  put(data, cx, cz, bx + W - 1, by + 6, bz - D + 1, mossy);
  fillChest(seedHash, bx + W - 1, by + 5, bz - D + 1, JUNGLE_LOOT, [K('bamboo'), 2, 6, 0.5]);
}

/** 废弃传送门：下界岩基座 + 残破黑曜石门框（约一成哭泣黑曜石）+ 金宝箱 */
function writeRuinedPortal(spot: StructureSpot, terrain: Terrain, cx: number, cz: number, data: Uint16Array, seedHash: number): void {
  const netherrack = K('netherrack');
  const obsidian = K('obsidian');
  const crying = K('crying_obsidian');
  const magma = K('magma_block');
  const bx = spot.x;
  const bz = spot.z;
  const by = terrain.heightAt(bx, bz) + 1;
  const rand = mulberry32((seedHash ^ Math.imul(bx, 374761393) ^ Math.imul(bz, 668265263)) | 0);
  const obs = () => (rand() < 0.1 ? crying : obsidian);
  // 下界岩基座 7×4（混岩浆块）
  for (let x = -3; x <= 3; x++) {
    for (let z = -1; z <= 2; z++) {
      putBase(data, cx, cz, bx + x, by, bz + z, rand() < 0.12 ? magma : netherrack);
      for (let dy = 1; dy <= 6; dy++) put(data, cx, cz, bx + x, by + dy, bz + z, AIR); // 上方清空（半截埋进山坡时开门）
    }
  }
  // 残破门框（宽 4 高 5，缺角断边）
  const frame: [number, number][] = [];
  for (let dx = -2; dx <= 1; dx++) frame.push([dx, 0]); // 底边
  for (let dy = 0; dy <= 4; dy++) frame.push([-2, dy]); // 左柱全
  for (let dy = 0; dy <= 2; dy++) frame.push([1, dy]); // 右柱残
  frame.push([0, 4], [1, 4]); // 顶边残（缺 -1）
  for (const [dx, dy] of frame) {
    if (dy === 0) continue; // 底边并入基座
    put(data, cx, cz, bx + dx, by + dy, bz, obs());
  }
  // 门框内嵌金块（三成）与金宝箱
  if (rand() < 0.3) put(data, cx, cz, bx - 1, by + 1, bz, K('gold_block'));
  put(data, cx, cz, bx + 3, by + 1, bz + 1, K('chest'));
  fillChest(seedHash, bx + 3, by + 1, bz + 1, PORTAL_LOOT, [K('obsidian'), 1, 2, 0.6]);
}

/** 海底遗迹：海晶石主殿（金块核心 + 湿海绵房 + 暗海晶石柱与穹顶） */
function writeOceanMonument(spot: StructureSpot, terrain: Terrain, cx: number, cz: number, data: Uint16Array, seedHash: number): void {
  const bricks = K('prismarine_bricks');
  const dark = K('dark_prismarine');
  const prism = K('prismarine');
  const gold = K('gold_block');
  const sponge = K('wet_sponge');
  const bx = spot.x;
  const bz = spot.z;
  const by = terrain.heightAt(bx, bz) + 1;
  const W = 10; // 21×21
  // 主殿：外墙 8 高（海晶石砖，每 6 格开 2×2 窗），内空
  for (let x = -W; x <= W; x++) {
    for (let z = -W; z <= W; z++) {
      putBase(data, cx, cz, bx + x, by, bz + z, bricks);
      const edge = Math.abs(x) === W || Math.abs(z) === W;
      for (let dy = 1; dy <= 7; dy++) {
        if (!edge) {
          put(data, cx, cz, bx + x, by + dy, bz + z, AIR);
          continue;
        }
        const win = dy >= 3 && dy <= 4 && ((Math.abs(x) % 6) <= 1 && Math.abs(z) === W || (Math.abs(z) % 6) <= 1 && Math.abs(x) === W);
        put(data, cx, cz, bx + x, by + dy, bz + z, win ? K('sea_lantern') : bricks);
      }
      // 顶盖：暗海晶石平层
      put(data, cx, cz, bx + x, by + 8, bz + z, dark);
    }
  }
  // 四角暗海晶石柱（3×3×11）
  for (const [px, pz] of [[-W, -W], [W, -W], [-W, W], [W, W]] as const) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dy = 1; dy <= 11; dy++) put(data, cx, cz, bx + px + dx, by + dy, bz + pz + dz, dark);
      }
    }
  }
  // 穹顶：三层收分海晶石
  for (let lvl = 0; lvl < 3; lvl++) {
    const r = 6 - lvl * 2;
    for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) put(data, cx, cz, bx + x, by + 9 + lvl, bz + z, prism);
  }
  // 金块核心：中央 2×2×2（MC 遗迹宝藏）
  for (let dx = 0; dx <= 1; dx++) {
    for (let dy = 0; dy <= 1; dy++) {
      for (let dz = 0; dz <= 1; dz++) put(data, cx, cz, bx - 1 + dx, by + 2 + dy, bz - 1 + dz, gold);
    }
  }
  // 海绵房：东北角小室，顶板挂湿海绵
  for (let x = W - 5; x <= W - 1; x++) {
    for (let z = -W + 1; z <= -W + 5; z++) {
      if (hash2(seedHash ^ 0x5b0a6e, x, z) < 0.5) put(data, cx, cz, bx + x, by + 6, bz + z, sponge);
    }
  }
}

/** 沉船：木船壳（尖头收分）+ 甲板 + 桅杆 + 尾舱宝箱 */
function writeShipwreck(spot: StructureSpot, terrain: Terrain, cx: number, cz: number, data: Uint16Array, seedHash: number): void {
  const spruce = hash2(seedHash ^ 0x51a1b2, spot.x, spot.z) < 0.5;
  const planks = K(spruce ? 'spruce_planks' : 'planks');
  const log = K(spruce ? 'spruce_log' : 'log');
  const bx = spot.x;
  const bz = spot.z;
  const by = terrain.heightAt(bx, bz) + 1;
  // 船体：9 长 × 最宽 5，半宽沿船长按 [0,1,2,2,2,2,2,1,0] 收分
  const HALF = [0, 1, 2, 2, 2, 2, 2, 1, 0];
  for (let i = 0; i < 9; i++) {
    const hw = HALF[i];
    for (let dz = -hw; dz <= hw; dz++) {
      // 船底与两舷（2 高）；舱内留空，甲板后铺
      putBase(data, cx, cz, bx + i - 4, by, bz + dz, planks);
      const rim = Math.abs(dz) === hw;
      for (let dy = 1; dy <= 2; dy++) put(data, cx, cz, bx + i - 4, by + dy, bz + dz, rim ? planks : AIR);
    }
  }
  // 甲板铺满（by+2 层内侧为甲板面）
  for (let i = 0; i < 9; i++) {
    for (let dz = -HALF[i]; dz <= HALF[i]; dz++) put(data, cx, cz, bx + i - 4, by + 2, bz + dz, planks);
  }
  // 桅杆：原木 9 高 + 顶横杆
  for (let dy = 3; dy <= 10; dy++) put(data, cx, cz, bx, by + dy, bz, log);
  for (let dz = -2; dz <= 2; dz++) put(data, cx, cz, bx, by + 8, bz + dz, log);
  // 尾舱 3×3×3 + 宝箱
  for (let dx = 2; dx <= 4; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = 3; dy <= 5; dy++) {
        const edge = dx === 4 || Math.abs(dz) === 1 || dy === 5;
        put(data, cx, cz, bx + dx, by + dy, bz + dz, edge ? planks : AIR);
      }
    }
  }
  put(data, cx, cz, bx + 3, by + 3, bz, K('chest'));
  fillChest(seedHash, bx + 3, by + 3, bz, SHIP_LOOT);
}

/** 生成本 chunk 覆盖范围内的结构（检查本区域及相邻区域） */
export function applyStructures(seedHash: number, terrain: Terrain, cx: number, cz: number, data: Uint16Array): void {
  const rx = Math.floor((cx * CHUNK_SIZE) / REGION);
  const rz = Math.floor((cz * CHUNK_SIZE) / REGION);
  for (let drx = -1; drx <= 1; drx++) {
    for (let drz = -1; drz <= 1; drz++) {
      const spot = structureAt(seedHash, terrain, rx + drx, rz + drz);
      if (!spot) continue;
      if (spot.kind.endsWith('village')) {
        const mats = VILLAGE_MATS[spot.kind];
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
      } else if (spot.kind === 'desert_temple') {
        writeDesertTemple(spot, terrain, cx, cz, data, seedHash);
      } else if (spot.kind === 'jungle_temple') {
        writeJungleTemple(spot, terrain, cx, cz, data, seedHash);
      } else if (spot.kind === 'ruined_portal') {
        writeRuinedPortal(spot, terrain, cx, cz, data, seedHash);
      } else if (spot.kind === 'ocean_monument') {
        writeOceanMonument(spot, terrain, cx, cz, data, seedHash);
      } else if (spot.kind === 'shipwreck') {
        writeShipwreck(spot, terrain, cx, cz, data, seedHash);
      } else {
        writeIgloo(spot, terrain, cx, cz, data);
      }
    }
  }
}
