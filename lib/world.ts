// 体素世界：chunk 存储、地形与结构生成、方块读写、脏标记

import { AIR, BLOCK_BY_KEY, BLOCKS, LAVA, STONE, WATER } from './blocks';
import { BIOME_SURFACE } from './biomes';
import { enqueueFluid } from './fluids';
import { notifyCropBlockSet } from './crops';
import { notifyBlockSet } from './saplings';
import { createTerrain, hash2, hashString, SEA_LEVEL, type Terrain } from './noise';
import { applyOres } from './oregen';
import { cascadeLight } from './lights';
import { applyStructures } from './structures';

export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 64;
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;

export const localIndex = (x: number, y: number, z: number): number =>
  (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;

export const chunkKey = (cx: number, cz: number): string => `${cx},${cz}`;

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

/** 用地形填充 chunk（确定性的；树木含 2 格边缘以跨 chunk 一致）；seedHash 用于村庄结构 */
export function generateChunk(terrain: Terrain, cx: number, cz: number, data: Uint16Array, seedHash = 0): void {
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = cx * CHUNK_SIZE + x;
      const wz = cz * CHUNK_SIZE + z;
      const h = terrain.heightAt(wx, wz);
      if (h < 0) continue;
      const surface = BIOME_SURFACE[terrain.biomeAt(wx, wz)];
      const top = Math.min(h, WORLD_HEIGHT - 1);
      const beach = top <= SEA_LEVEL + 1;
      for (let y = 0; y <= top; y++) {
        let id: number = STONE;
        if (y === top) id = beach ? (surface.beach ?? surface.top) : surface.top;
        else if (y >= top - 3) id = surface.filler;
        data[localIndex(x, y, z)] = id;
      }
      // 水下地表：海床/河床换成群系的水下组成（顶两格，按列哈希取材质）
      if (top < SEA_LEVEL) {
        const pick = surface.underwater[Math.floor(hash2(seedHash, wx, wz) * surface.underwater.length)];
        data[localIndex(x, top, z)] = pick;
        if (top - 1 >= 0) data[localIndex(x, top - 1, z)] = pick;
      }
      // 水面：冰原封冻为冰，其余为水
      for (let y = top + 1; y <= SEA_LEVEL; y++) {
        data[localIndex(x, y, z)] = y === SEA_LEVEL && surface.waterTop ? surface.waterTop : WATER;
      }
    }
  }
  // 基岩层 + 深板岩渐变 + 团簇矿脉（地形填充后、树木/村庄前）
  applyOres(seedHash, terrain, cx, cz, data);
  // 洞穴雕刻（3D 噪声：意面隧道 + 奶酪洞腔；矿石填完后刻空，洞壁即现矿脉）
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = cx * CHUNK_SIZE + x;
      const wz = cz * CHUNK_SIZE + z;
      const h = terrain.heightAt(wx, wz);
      if (h < 0) continue;
      for (let y = 4; y <= h; y++) {
        if (terrain.caveAt(wx, y, wz)) data[localIndex(x, y, z)] = AIR;
      }
    }
  }
  // 海底洞穴灌水：海平面以下被雕空的洞腔，上方是水的向下灌满（MC 含水层观感，避免出现水下黑色气穴）
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = cx * CHUNK_SIZE + x;
      const wz = cz * CHUNK_SIZE + z;
      const h = terrain.heightAt(wx, wz);
      if (h < 0 || h >= SEA_LEVEL) continue;
      for (let y = SEA_LEVEL; y >= 4; y--) {
        const i = localIndex(x, y, z);
        if (data[i] === AIR && data[localIndex(x, y + 1, z)] === WATER) data[i] = WATER;
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
  // 树木：检查本 chunk 及周围 2 格内的列，只写入落在本 chunk 的部分
  for (let tx = -2; tx < CHUNK_SIZE + 2; tx++) {
    for (let tz = -2; tz < CHUNK_SIZE + 2; tz++) {
      const wx = cx * CHUNK_SIZE + tx;
      const wz = cz * CHUNK_SIZE + tz;
      const kind = terrain.treeAt(wx, wz);
      if (!kind) continue;
      const h = terrain.heightAt(wx, wz);
      if (h <= SEA_LEVEL + 1 || h + 6 >= WORLD_HEIGHT) continue;
      const log = BLOCK_BY_KEY[kind === 'oak' ? 'log' : `${kind}_log`].id;
      const leaves = BLOCK_BY_KEY[kind === 'oak' ? 'leaves' : `${kind}_leaves`].id;
      const put = (lx: number, y: number, lz: number, id: number, onlyAir: boolean) => {
        if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return;
        const i = localIndex(lx, y, lz);
        if (onlyAir && data[i] !== AIR) return;
        data[i] = id;
      };
      for (let y = h + 1; y <= h + 4; y++) put(tx, y, tz, log, false);
      for (const ly of [h + 3, h + 4]) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) put(tx + dx, ly, tz + dz, leaves, true);
        }
      }
      put(tx, h + 5, tz, leaves, true);
    }
  }
  // 村庄结构（确定性，跨 chunk 一致）
  applyStructures(seedHash, terrain, cx, cz, data);

  // 花草：平原/盆地/森林的草地列按哈希撒花/草丛（只有支撑且上方为空才放）
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = cx * CHUNK_SIZE + x;
      const wz = cz * CHUNK_SIZE + z;
      const biome = terrain.biomeAt(wx, wz);
      if (biome !== 'plains' && biome !== 'forest' && biome !== 'basin') continue;
      const h = terrain.heightAt(wx, wz);
      if (h <= SEA_LEVEL || h + 1 >= WORLD_HEIGHT) continue;
      if (data[localIndex(x, h, z)] !== BLOCK_BY_KEY.grass.id) continue;
      const r = hash2(seedHash ^ 0x51ab3f, wx, wz);
      const chance = biome === 'forest' ? 0.02 : 0.012;
      if (r >= chance) continue;
      const pick = hash2(seedHash ^ 0x7c91e2, wx, wz);
      let plant: number;
      if (biome === 'forest') {
        plant = pick < 0.5 ? BLOCK_BY_KEY.fern.id : pick < 0.65 ? BLOCK_BY_KEY.short_grass.id : pick < 0.8 ? BLOCK_BY_KEY.poppy.id : pick < 0.9 ? BLOCK_BY_KEY.dandelion.id : BLOCK_BY_KEY.blue_orchid.id;
      } else {
        plant = pick < 0.45 ? BLOCK_BY_KEY.short_grass.id : pick < 0.6 ? BLOCK_BY_KEY.dandelion.id : pick < 0.75 ? BLOCK_BY_KEY.poppy.id : pick < 0.85 ? BLOCK_BY_KEY.cornflower.id : pick < 0.95 ? BLOCK_BY_KEY.oxeye_daisy.id : BLOCK_BY_KEY.allium.id;
      }
      if (data[localIndex(x, h + 1, z)] === AIR) data[localIndex(x, h + 1, z)] = plant;
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
    if (s && s.length === CHUNK_VOLUME) chunk.data.set(s);
    else {
      generateChunk(this.terrain, cx, cz, chunk.data, this.seedHash);
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
