// 体素世界：chunk 存储、地形与结构生成、方块读写、脏标记

import { AIR, BLOCK_BY_KEY, BLOCKS, LAVA, STONE, WATER } from './blocks';
import { BADLANDS_BANDS, BIOME_SURFACE } from './biomes';
import { enqueueFluid } from './fluids';
import { notifyCropBlockSet } from './crops';
import { notifyBlockSet } from './saplings';
import { notifyRedstone } from './redstone';
import { createTerrain, hash2, hashString, mulberry32, SEA_LEVEL, type Biome, type Terrain } from './noise';
import { generateNetherChunk } from './nether';
import { generateEndChunk } from './end';
import { applyOres } from './oregen';
import { applyGeodes } from './geodes';
import { cascadeLight } from './lights';
import { applyStructures } from './structures';
import { applyStronghold } from './stronghold';
import { HUGE_MUSHROOM_MAX_H, TREE_MAX_H, writeHugeMushroom, writeTree } from './trees';

export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 128;
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;

export const localIndex = (x: number, y: number, z: number): number =>
  (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;

export const chunkKey = (cx: number, cz: number): string => `${cx},${cz}`;

/** 树形/巨蘑菇最大外扩格数（金合欢斜干 1 + 5×5 冠 2；巨蘑菇伞盖 2），跨 chunk 一致所需的环宽 */
const TREE_RING = 3;

export class Chunk {
  readonly data = new Uint16Array(CHUNK_VOLUME);
  /** 方块光照 0-15（lights.ts 维护） */
  readonly light = new Uint8Array(CHUNK_VOLUME);
  /** 天空光 0-15（lights.ts 维护；露天 15，遮光递减） */
  readonly sky = new Uint8Array(CHUNK_VOLUME);
  /** 有未冲刷的光照变更（setBlock 打标记，建网前统一重算） */
  lightDirty = false;
  /** 几何版本号，重建 mesh 时 +1，驱动 React 重新渲染 */
  version = 0;
  /** 被玩家修改过，需要持久化 */
  modified = false;
  constructor(
    public readonly cx: number,
    public readonly cz: number,
  ) {}
}

/** 用地形填充 chunk（确定性的；树木含 ±TREE_RING 格边缘以跨 chunk 一致）；seedHash 用于村庄结构 */
export function generateChunk(terrain: Terrain, cx: number, cz: number, data: Uint16Array, seedHash = 0): void {
  // 列高度/群系缓存：同一列在地形填充、洞穴、灌水、树木、植被多轮中反复查询，每列只算一次。
  // 缓存覆盖树木环 ±TREE_RING 共 (16+2·TREE_RING)² 列（chunk 内 16×16 是其中子集）
  const RING = CHUNK_SIZE + TREE_RING * 2;
  const hCache = new Int16Array(RING * RING).fill(-2); // -2 = 未算过（heightAt 只会返回 -1 或 ≥1）
  const bCache: (Biome | undefined)[] = new Array(RING * RING);
  const ringIndex = (wx: number, wz: number) => (wx - cx * CHUNK_SIZE + TREE_RING) * RING + (wz - cz * CHUNK_SIZE + TREE_RING);
  const cachedHeightAt = (wx: number, wz: number): number => {
    const i = ringIndex(wx, wz);
    let h = hCache[i];
    if (h === -2) {
      h = terrain.heightAt(wx, wz);
      hCache[i] = h;
    }
    return h;
  };
  const cachedBiomeAt = (wx: number, wz: number): Biome => {
    const i = ringIndex(wx, wz);
    return (bCache[i] ??= terrain.biomeAt(wx, wz));
  };
  const K = (key: string) => BLOCK_BY_KEY[key].id;
  const SNOW_BLOCK = K('snow_block');
  const GRASS = K('grass');
  const DIRT = K('dirt');
  const SAND = K('sand');
  const GRAVEL = K('gravel');
  const PODZOL = K('podzol');
  const MYCELIUM = K('mycelium');
  const RED_SAND = K('red_sand');

  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = cx * CHUNK_SIZE + x;
      const wz = cz * CHUNK_SIZE + z;
      const h = cachedHeightAt(wx, wz);
      if (h < 0) continue;
      const biome = cachedBiomeAt(wx, wz);
      const surface = BIOME_SURFACE[biome];
      const top = Math.min(h, WORLD_HEIGHT - 1);
      // 群系表层微调：山地按雪线分带（山麓草石 → 裸岩 → 积雪），针叶林灰化土斑块
      let topBlock = surface.top;
      let fillerBlock = surface.filler;
      if (biome === 'mountains') {
        const sl = terrain.snowlineAt(wx, wz);
        if (top >= sl) {
          topBlock = SNOW_BLOCK;
          fillerBlock = STONE;
        } else if (top >= sl - 6) {
          topBlock = STONE;
          fillerBlock = STONE;
        } else {
          topBlock = hash2(seedHash ^ 0x3f7a11, wx, wz) < 0.3 ? GRAVEL : GRASS;
          fillerBlock = DIRT;
        }
      } else if (biome === 'taiga' && hash2(seedHash ^ 0x9d2b4c, wx, wz) < 0.35) {
        topBlock = PODZOL;
      }
      const beach = top <= SEA_LEVEL + 1;
      // 恶地陶瓦地层：列级色带偏移（MC 侵蚀恶地的彩色地层）
      const bandOff = biome === 'badlands' ? Math.floor(hash2(seedHash ^ 0x6b1e7a, wx, wz) * BADLANDS_BANDS.length * 3) : 0;
      for (let y = 0; y <= top; y++) {
        let id: number = STONE;
        if (y === top) id = beach ? (surface.beach ?? topBlock) : topBlock;
        else if (y >= top - 3) id = fillerBlock;
        else if (biome === 'badlands' && y >= top - 32) {
          id = BADLANDS_BANDS[Math.abs(Math.floor((y + bandOff) / 3)) % BADLANDS_BANDS.length];
        }
        data[localIndex(x, y, z)] = id;
      }
      // 水下地表：海床/河床换成群系的水下组成（顶两格，按列哈希取材质）
      if (top < SEA_LEVEL) {
        const pick = surface.underwater[Math.floor(hash2(seedHash, wx, wz) * surface.underwater.length)];
        data[localIndex(x, top, z)] = pick;
        if (top - 1 >= 0) data[localIndex(x, top - 1, z)] = pick;
      }
      // 水面：寒带封冻为冰，其余为水
      for (let y = top + 1; y <= SEA_LEVEL; y++) {
        data[localIndex(x, y, z)] = y === SEA_LEVEL && surface.waterTop ? surface.waterTop : WATER;
      }
    }
  }
  // 基岩层 + 深板岩渐变 + 团簇矿脉（地形填充后、树木/村庄前）
  applyOres(seedHash, terrain, cx, cz, data);
  // 紫水晶洞：三层球壳（须在洞穴雕刻前，洞穴可自然破开晶洞）
  applyGeodes(seedHash, terrain, cx, cz, data);
  // 洞穴雕刻（3D 噪声：意面隧道 + 奶酪洞腔；矿石填完后刻空，洞壁即现矿脉）
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = cx * CHUNK_SIZE + x;
      const wz = cz * CHUNK_SIZE + z;
      const h = cachedHeightAt(wx, wz);
      if (h < 0) continue;
      for (let y = 4; y <= h; y++) {
        if (terrain.caveAt(wx, y, wz, h)) data[localIndex(x, y, z)] = AIR;
      }
    }
  }
  // 海底洞穴灌水：海平面以下被雕空的洞腔，上方是水的向下灌满（MC 含水层观感，避免出现水下黑色气穴）
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = cx * CHUNK_SIZE + x;
      const wz = cz * CHUNK_SIZE + z;
      const h = cachedHeightAt(wx, wz);
      if (h < 0 || h >= SEA_LEVEL) continue;
      for (let y = SEA_LEVEL; y >= 4; y--) {
        const i = localIndex(x, y, z);
        if (data[i] === AIR && data[localIndex(x, y + 1, z)] === WATER) data[i] = WATER;
      }
    }
  }
  // 地下含水层：含水层区海平面以下的深洞灌水（MC 1.18 水帘洞；不破地表的洞才灌）
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = cx * CHUNK_SIZE + x;
      const wz = cz * CHUNK_SIZE + z;
      if (!terrain.aquiferAt(wx, wz)) continue;
      const h = cachedHeightAt(wx, wz);
      if (h < 0) continue;
      for (let y = Math.min(h - 4, SEA_LEVEL - 2); y >= 5; y--) {
        const i = localIndex(x, y, z);
        if (data[i] === AIR) data[i] = WATER;
      }
    }
  }
  // 深层岩浆湖：y≤10 的雕空洞腔自底向上灌岩浆（下方非空非水才灌，形成平整湖面）
  const LAVA_LAKE_TOP = 10;
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let y = 2; y <= LAVA_LAKE_TOP; y++) {
        const i = localIndex(x, y, z);
        if (data[i] !== AIR) continue;
        const below = data[localIndex(x, y - 1, z)];
        if (below !== AIR && below !== WATER) data[i] = LAVA;
      }
    }
  }
  // 洞穴群系装饰（滴水石洞/繁茂洞穴）：洞地板铺滴水石/苔藓并立笋或杜鹃，洞顶倒挂钟乳/洞穴藤蔓
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = cx * CHUNK_SIZE + x;
      const wz = cz * CHUNK_SIZE + z;
      const zone = terrain.undergroundAt(wx, wz);
      if (!zone) continue;
      const h = cachedHeightAt(wx, wz);
      if (h < 0) continue;
      const yMax = Math.min(h - 4, WORLD_HEIGHT - 2); // 只装饰够深的洞，不动地表坑洼
      for (let y = 5; y <= yMax; y++) {
        const i = localIndex(x, y, z);
        if (data[i] !== AIR) continue;
        const below = data[localIndex(x, y - 1, z)];
        const above = data[localIndex(x, y + 1, z)];
        const r = hash2(seedHash ^ Math.imul(y, 0x9e3779b9), wx, wz);
        if (BLOCKS[below]?.opaque) {
          if (zone === 'dripstone') {
            if (r < 0.3) data[localIndex(x, y - 1, z)] = K('dripstone_block');
            else if (r < 0.42) {
              data[localIndex(x, y - 1, z)] = K('dripstone_block');
              data[i] = K('pointed_dripstone');
            }
          } else {
            if (r < 0.35) data[localIndex(x, y - 1, z)] = K('moss_block');
            else if (r < 0.45) {
              data[localIndex(x, y - 1, z)] = K('moss_block');
              data[i] = r < 0.42 ? K('azalea') : K('flowering_azalea');
            }
          }
        } else if (BLOCKS[above]?.opaque) {
          if (zone === 'dripstone') {
            if (r < 0.1) data[i] = K('pointed_dripstone_down');
          } else if (r < 0.08) data[i] = K('cave_vines');
        }
      }
    }
  }
  // 树木与巨蘑菇：检查本 chunk 及周围 TREE_RING 格内的列，只写入落在本 chunk 的部分（跨 chunk 一致）
  const put = (lx: number, y: number, lz: number, id: number, onlyAir: boolean) => {
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return;
    const i = localIndex(lx, y, lz);
    if (onlyAir && data[i] !== AIR) return;
    data[i] = id;
  };
  for (let tx = -TREE_RING; tx < CHUNK_SIZE + TREE_RING; tx++) {
    for (let tz = -TREE_RING; tz < CHUNK_SIZE + TREE_RING; tz++) {
      const wx = cx * CHUNK_SIZE + tx;
      const wz = cz * CHUNK_SIZE + tz;
      const h = cachedHeightAt(wx, wz);
      if (h <= SEA_LEVEL + 1 || h >= WORLD_HEIGHT - 2) continue;
      const rand = mulberry32((seedHash ^ Math.imul(wx, 374761393) ^ Math.imul(wz, 668265263) ^ 0x7ee5) | 0);
      const kind = terrain.treeAt(wx, wz);
      if (kind) {
        if (h + TREE_MAX_H[kind] >= WORLD_HEIGHT) continue;
        // 丛林树自带垂藤（trees.ts）；沼泽橡树按群系加垂藤
        writeTree(put, kind, tx, h, tz, rand, { vines: cachedBiomeAt(wx, wz) === 'swamp' });
        continue;
      }
      const biome = cachedBiomeAt(wx, wz);
      // 冰刺：冰刺平原标志（浮冰高柱，偶带蓝冰基座）
      if (biome === 'ice_spikes') {
        if (rand() < 0.02 && h + 20 < WORLD_HEIGHT) {
          const H = 8 + Math.floor(rand() * 11); // 8-18
          const packed = K('packed_ice');
          for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            put(tx + dx, h + 1, tz + dz, packed, true);
            put(tx + dx, h + 2, tz + dz, packed, true);
          }
          for (let y = h + 3; y <= h + H; y++) put(tx, y, tz, packed, true);
          if (rand() < 0.5) {
            for (let dx = -1; dx <= 1; dx++) {
              for (let dz = -1; dz <= 1; dz++) {
                if (rand() < 0.6) put(tx + dx, h, tz + dz, K('blue_ice'), false);
              }
            }
          }
        }
        continue;
      }
      // 巨蘑菇：蘑菇岛成群、黑森林偶见（红/棕各半）
      const r = rand();
      const chance = biome === 'mushroom_fields' ? 0.03 : biome === 'dark_forest' ? 0.006 : 0;
      if (chance > 0 && r < chance && h + HUGE_MUSHROOM_MAX_H < WORLD_HEIGHT) {
        writeHugeMushroom(put, rand() < 0.5, tx, h, tz, rand);
      }
    }
  }
  // 村庄结构（确定性，跨 chunk 一致）
  applyStructures(seedHash, terrain, cx, cz, data);
  // 要塞（地下石砖结构 + 末地门房间；同样确定性，仅与要塞范围相交的 chunk 有写入）
  applyStronghold(seedHash, cx, cz, data);

  // 植被：按群系撒花草/仙人掌/甘蔗/蘑菇/睡莲/瓜果（只有支撑且上方为空才放）
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = cx * CHUNK_SIZE + x;
      const wz = cz * CHUNK_SIZE + z;
      const biome = cachedBiomeAt(wx, wz);
      const h = cachedHeightAt(wx, wz);
      if (h < 0) continue;
      const surf = data[localIndex(x, h, z)];
      // 睡莲：沼泽/丛林未封冻的水面（浮在水面之上的空气格）
      if (h < SEA_LEVEL) {
        if (
          (biome === 'swamp' || biome === 'jungle') &&
          data[localIndex(x, SEA_LEVEL, z)] === WATER &&
          data[localIndex(x, SEA_LEVEL + 1, z)] === AIR &&
          hash2(seedHash ^ 0x1e7b3d, wx, wz) < 0.08
        ) {
          data[localIndex(x, SEA_LEVEL + 1, z)] = K('lily_pad');
        }
        continue;
      }
      if (h < SEA_LEVEL || h + 1 >= WORLD_HEIGHT) continue;
      const aboveI = localIndex(x, h + 1, z);
      if (data[aboveI] !== AIR) continue;
      // 甘蔗：岸线（脚下即海平面）四邻同高有水，宿主为草/土/沙/灰化土/菌丝（MC 一致）
      if (h === SEA_LEVEL && (surf === GRASS || surf === DIRT || surf === SAND || surf === PODZOL || surf === MYCELIUM)) {
        const nearWater =
          x > 0 && x < CHUNK_SIZE - 1 && z > 0 && z < CHUNK_SIZE - 1 &&
          (data[localIndex(x + 1, h, z)] === WATER || data[localIndex(x - 1, h, z)] === WATER ||
            data[localIndex(x, h, z + 1)] === WATER || data[localIndex(x, h, z - 1)] === WATER);
        if (nearWater && hash2(seedHash ^ 0xca3e11, wx, wz) < 0.3) {
          const ch = 1 + Math.floor(hash2(seedHash ^ 0xca3f22, wx, wz) * 3);
          for (let i = 0; i < ch && h + 1 + i < WORLD_HEIGHT; i++) data[localIndex(x, h + 1 + i, z)] = K('sugar_cane');
          continue;
        }
      }
      const r = hash2(seedHash ^ 0x51ab3f, wx, wz);
      const pick = hash2(seedHash ^ 0x7c91e2, wx, wz);
      switch (biome) {
        case 'plains':
        case 'basin': {
          if (surf !== GRASS) break;
          if (r < 1 / 256) {
            data[aboveI] = K('pumpkin');
            break;
          }
          // 高草丛（双格，MC 平原点缀）
          if (r < 0.003 && h + 2 < WORLD_HEIGHT && data[localIndex(x, h + 2, z)] === AIR) {
            data[aboveI] = K('tall_grass');
            data[localIndex(x, h + 2, z)] = K('tall_grass_top');
            break;
          }
          if (r >= 0.012) break;
          data[aboveI] =
            pick < 0.45 ? K('short_grass') : pick < 0.6 ? K('dandelion') : pick < 0.75 ? K('poppy') : pick < 0.85 ? K('cornflower') : pick < 0.95 ? K('oxeye_daisy') : K('allium');
          break;
        }
        case 'forest':
        case 'birch_forest': {
          if (surf !== GRASS || r >= 0.02) break;
          data[aboveI] =
            pick < 0.5 ? K('fern') : pick < 0.65 ? K('short_grass') : pick < 0.8 ? K('poppy') : pick < 0.9 ? K('dandelion') : K('blue_orchid');
          break;
        }
        case 'taiga': {
          if (surf !== GRASS && surf !== PODZOL) break;
          // 薄雪覆盖（针叶林寒带地面）
          if (hash2(seedHash ^ 0x5e11c4, wx, wz) < 0.25) {
            data[aboveI] = K('snow_layer');
            break;
          }
          if (r >= 0.05) break;
          // 大型蕨（双格，针叶林标志）
          if (pick < 0.2 && h + 2 < WORLD_HEIGHT && data[localIndex(x, h + 2, z)] === AIR) {
            data[aboveI] = K('large_fern');
            data[localIndex(x, h + 2, z)] = K('large_fern_top');
            break;
          }
          data[aboveI] = pick < 0.5 ? K('fern') : pick < 0.75 ? K('short_grass') : pick < 0.9 ? K('poppy') : K('brown_mushroom');
          break;
        }
        case 'snowy':
        case 'ice_spikes': {
          // 雪层覆盖（MC 雪原招牌）
          if (hash2(seedHash ^ 0x5e11a2, wx, wz) < 0.65) data[aboveI] = K('snow_layer');
          break;
        }
        case 'mountains': {
          // 雪顶之上再覆薄雪层，峰面更有层次
          if (surf === SNOW_BLOCK && hash2(seedHash ^ 0x5e11b3, wx, wz) < 0.4) data[aboveI] = K('snow_layer');
          break;
        }
        case 'dark_forest': {
          if (surf !== GRASS || r >= 0.03) break;
          data[aboveI] = pick < 0.3 ? K('fern') : pick < 0.65 ? K('red_mushroom') : K('brown_mushroom');
          break;
        }
        case 'desert': {
          if (surf !== SAND) break;
          if (r < 0.02) {
            // 仙人掌：四邻同高须为空（MC 贴墙不长），高 1-3
            const clear =
              x > 0 && x < CHUNK_SIZE - 1 && z > 0 && z < CHUNK_SIZE - 1 &&
              data[localIndex(x + 1, h + 1, z)] === AIR && data[localIndex(x - 1, h + 1, z)] === AIR &&
              data[localIndex(x, h + 1, z + 1)] === AIR && data[localIndex(x, h + 1, z - 1)] === AIR;
            if (!clear) break;
            const ch = 1 + Math.floor(pick * 3);
            for (let i = 0; i < ch && h + 1 + i < WORLD_HEIGHT; i++) data[localIndex(x, h + 1 + i, z)] = K('cactus');
          } else if (r < 0.05) {
            data[aboveI] = K('dead_bush');
          }
          break;
        }
        case 'savanna': {
          if (surf !== GRASS || r >= 0.2) break;
          // 高草丛（双格，热带草原标志；与短草混生）
          if (pick < 0.3 && h + 2 < WORLD_HEIGHT && data[localIndex(x, h + 2, z)] === AIR) {
            data[aboveI] = K('tall_grass');
            data[localIndex(x, h + 2, z)] = K('tall_grass_top');
            break;
          }
          data[aboveI] = pick < 0.8 ? K('short_grass') : K('dandelion');
          break;
        }
        case 'jungle': {
          if (surf !== GRASS) break;
          // 竹子成丛（茎段 + 带叶顶段，高 3-6）
          if (r < 0.02 && h + 7 < WORLD_HEIGHT) {
            const bh = 3 + Math.floor(pick * 4);
            let ok = true;
            for (let i = 1; i <= bh; i++) if (data[localIndex(x, h + i, z)] !== AIR) { ok = false; break; }
            if (ok) {
              for (let i = 1; i < bh; i++) data[localIndex(x, h + i, z)] = K('bamboo');
              data[localIndex(x, h + bh, z)] = K('bamboo_top');
            }
            break;
          }
          if (r >= 0.06) break;
          data[aboveI] = pick < 0.05 ? K('melon') : pick < 0.5 ? K('fern') : K('short_grass');
          break;
        }
        case 'swamp': {
          if (surf !== GRASS || r >= 0.05) break;
          data[aboveI] = pick < 0.3 ? K('blue_orchid') : pick < 0.6 ? K('short_grass') : pick < 0.85 ? K('fern') : K('brown_mushroom');
          break;
        }
        case 'badlands': {
          if (surf !== RED_SAND && !BLOCKS[surf]?.key.endsWith('terracotta')) break;
          if (r < 0.025) data[aboveI] = K('dead_bush');
          break;
        }
        case 'mushroom_fields': {
          if (surf !== MYCELIUM || r >= 0.03) break;
          data[aboveI] = pick < 0.5 ? K('red_mushroom') : K('brown_mushroom');
          break;
        }
        default:
          break; // snowy / mountains / ocean / river 无地表植被
      }
    }
  }
}

export class World {
  readonly terrain: Terrain;
  readonly seedHash: number;
  readonly chunks = new Map<string, Chunk>();
  /** 待重建 mesh 的 chunk key */
  readonly dirtyChunks = new Set<string>();
  /** 待持久化的 chunk key */
  readonly modifiedChunks = new Set<string>();
  /** chunk 集合变化计数（增删时 +1） */
  generation = 0;
  /** chunk 因超出距离被卸载前回调（用于存档） */
  onChunkRemoved: ((chunk: Chunk) => void) | null = null;
  private readonly saved: Map<string, Uint16Array>;

  constructor(
    public readonly seed: string,
    saved?: Map<string, Uint16Array>,
    terrain?: Terrain,
  ) {
    this.terrain = terrain ?? createTerrain(seed);
    this.seedHash = hashString(seed);
    this.saved = saved ?? new Map();
  }

  getChunk(cx: number, cz: number): Chunk {
    const key = chunkKey(cx, cz);
    const existing = this.chunks.get(key);
    if (existing) return existing;
    const chunk = new Chunk(cx, cz);
    const s = this.saved.get(key);
    if (s && s.length === CHUNK_VOLUME) {
      chunk.data.set(s);
      // 存档恢复的 chunk 光照数组为全 0：标脏交给 flushLight 限流重算（否则世界渲染全黑）
      chunk.lightDirty = true;
    } else {
      if (this.terrain.kind === 'nether') generateNetherChunk(this.terrain, cx, cz, chunk.data, this.seedHash);
      else if (this.terrain.kind === 'end') generateEndChunk(this.terrain, cx, cz, chunk.data, this.seedHash);
      else generateChunk(this.terrain, cx, cz, chunk.data, this.seedHash);
      cascadeLight(this, chunk);
    }
    this.chunks.set(key, chunk);
    this.dirtyChunks.add(key);
    // 相邻已存在 chunk 需要重网格化，避免共享边界面重复
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nk = chunkKey(cx + dx, cz + dz);
      if (this.chunks.has(nk)) this.dirtyChunks.add(nk);
    }
    this.generation++;
    return chunk;
  }

  getBlock(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return AIR;
    return this.getChunk(x >> 4, z >> 4).data[localIndex(x & 15, y, z & 15)];
  }

  setBlock(x: number, y: number, z: number, id: number): void {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const cx = x >> 4;
    const cz = z >> 4;
    const key = chunkKey(cx, cz);
    const chunk = this.getChunk(cx, cz);
    const oldId = chunk.data[localIndex(x & 15, y, z & 15)];
    chunk.data[localIndex(x & 15, y, z & 15)] = id;
    chunk.modified = true;
    this.modifiedChunks.add(key);
    this.dirtyChunks.add(key);
    // 边界方块影响相邻 chunk 的面剔除
    if ((x & 15) === 0) this.markDirty(cx - 1, cz);
    if ((x & 15) === CHUNK_SIZE - 1) this.markDirty(cx + 1, cz);
    if ((z & 15) === 0) this.markDirty(cx, cz - 1);
    if ((z & 15) === CHUNK_SIZE - 1) this.markDirty(cx, cz + 1);
    // 水及其邻域进入流体检查队列（生成过程直接写 data 不走这里，不会触发）
    enqueueFluid(x, y, z);
    // 光照变更打标记（建网前由 flushLight 统一重算，避免批量编辑雪崩）。
    // 仅当不透明度或发光值变化才需要重算——流水/作物/树叶凋零等非透明变化不影响光照，
    // 大面积水蔓延时这条能省掉成片的无效重算，避免阻塞主线程
    const oldDef = BLOCKS[oldId];
    const newDef = BLOCKS[id];
    if ((oldDef?.opaque ?? false) !== (newDef?.opaque ?? false) || (oldDef?.light ?? 0) !== (newDef?.light ?? 0)) {
      chunk.lightDirty = true;
    }
    // 树苗登记 / 原木断供触发树叶凋零（生成过程直接写 data 不走这里）
    notifyBlockSet(this, x, y, z, oldId, id);
    // 小麦作物登记（同上）
    notifyCropBlockSet(x, y, z, id);
    // 红石电源登记与粉网络重算（同上）
    notifyRedstone(this, x, y, z, oldId, id);
  }

  private markDirty(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    if (this.chunks.has(key)) this.dirtyChunks.add(key);
  }

  /**
   * 后台加载到的存档数据到达：
   * chunk 未创建 → 存入备用（创建时优先用存档）；已创建但本局未修改 → 替换为存档版本；
   * 本局已有编辑 → 玩家版本优先，忽略存档
   */
  applySavedChunk(key: string, data: Uint16Array): void {
    if (data.length !== CHUNK_VOLUME) return;
    const existing = this.chunks.get(key);
    if (!existing) {
      this.saved.set(key, data);
      return;
    }
    if (existing.modified) return;
    existing.data.set(data);
    cascadeLight(this, existing);
    this.dirtyChunks.add(key);
    // 边界面可能变化，相邻 chunk 也要重建，避免接缝
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      this.markDirty(existing.cx + dx, existing.cz + dz);
    }
  }

  /** 取出一个待重建 chunk（无则返回 null） */
  pollDirty(): string | null {
    const it = this.dirtyChunks.values().next();
    if (it.done) return null;
    this.dirtyChunks.delete(it.value);
    return it.value;
  }

  /** 以 (x, z) 为中心确保半径内 chunk 已生成（每次最多生成 budget 个，由近及远），卸载半径外的 chunk */
  updateAround(x: number, z: number, radius: number, budget = 8): void {
    const pcx = Math.floor(x / CHUNK_SIZE);
    const pcz = Math.floor(z / CHUNK_SIZE);
    // 收集缺失的 chunk，按距离由近及远分批生成，避免单帧卡顿
    const missing: [number, number, number][] = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const key = chunkKey(pcx + dx, pcz + dz);
        if (!this.chunks.has(key)) missing.push([Math.max(Math.abs(dx), Math.abs(dz)), pcx + dx, pcz + dz]);
      }
    }
    missing.sort((a, b) => a[0] - b[0]);
    for (const [, cx, cz] of missing.slice(0, budget)) {
      try {
        this.getChunk(cx, cz);
      } catch (err) {
        // 单个 chunk 生成异常不堵死调度：下个周期还会重试，其余 chunk 照常生成
        console.error(`chunk ${cx},${cz} 生成失败`, err);
      }
    }

    const toRemove: string[] = [];
    for (const [key, c] of this.chunks) {
      const dist = Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz));
      if (dist > radius + 2) toRemove.push(key);
    }
    for (const key of toRemove) {
      const c = this.chunks.get(key);
      if (c?.modified) {
        this.onChunkRemoved?.(c);
        // 同步到 saved，回来重建时保留本局编辑（否则会重新生成导致丢失）
        this.saved.set(key, c.data);
      }
      this.chunks.delete(key);
      this.generation++;
    }
  }
}
