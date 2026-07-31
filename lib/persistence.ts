// IndexedDB 存档：meta 表存种子/玩家位置/昼夜/模式/生存数值/按维度隔离的容器状态，chunks 表存被玩家修改过的 chunk 完整数据

import { openDB, type IDBPDatabase } from 'idb';
import type { ArmorSlots } from './armor';
import type { ActiveBeacon } from './beacon';
import type { BrewState } from './brewing';
import type { FurnaceState } from './furnace';
import type { Slot } from './slots';
import type { WorldMode } from './store';
import type { World } from './world';

const DB_NAME = 'kimi-mc';
const DB_VERSION = 1;
const META_KEY = 'current';

export interface PlayerPos {
  x: number;
  y: number;
  z: number;
}

export interface SurvivalSnapshot {
  health: number;
  hunger: number;
  /** MC 隐藏饱和度 */
  saturation: number;
  /** 经验总量 */
  xp: number;
  /** 热键栏 9 格 */
  slots: Slot[];
  /** 主物品栏（背包）27 格 */
  backpack: Slot[];
  /** 装备槽 */
  armor: ArmorSlots;
}

/** 维度键（与 lib/dimension.ts 的 Dimension 同构；此处内联避免循环依赖） */
export type DimKey = 'overworld' | 'nether' | 'end';

export const DIM_KEYS: readonly DimKey[] = ['overworld', 'nether', 'end'];

/** 单个维度的容器/站点状态（按维度隔离存储，防跨维度存档互相覆盖） */
export interface DimExtras {
  /** 该维度熔炉状态（"x,y,z" → 状态） */
  furnaces?: Record<string, FurnaceState>;
  /** 该维度酿造台状态（"x,y,z" → 状态） */
  brews?: Record<string, BrewState>;
  /** 该维度容器（箱子/木桶）内容（"x,y,z" → 27 格） */
  storages?: Record<string, Slot[]>;
  /** 该维度已激活的信标（"x,y,z" → 激活态） */
  beacons?: Record<string, ActiveBeacon>;
}

/** meta 的可选附加字段 */
export interface SaveExtras {
  /** 上次保存时的玩家位置（继续游戏时回到这里） */
  player?: PlayerPos;
  /** 床设的重生点（MC：死亡/虚空回这里） */
  respawnPoint?: PlayerPos;
  /** 昼夜时刻（0..1） */
  dayTime?: number;
  /** 世界模式：创造 / 生存 */
  mode?: WorldMode;
  /** 当前维度（主世界 / 下界 / 末地） */
  dimension?: DimKey;
  /** 生存数值快照（仅生存模式） */
  survival?: SurvivalSnapshot;
  /** 按维度隔离的容器/熔炉/酿造台/激活信标状态（保存时必须三个维度齐全，任何维度都不丢） */
  dims?: Partial<Record<DimKey, DimExtras>>;
}

export interface WorldMeta extends SaveExtras {
  seed: string;
  /** 存档格式版本：不等于 SAVE_VERSION 即清库（项目无存量用户，不维护迁移链），清库前明示用户 */
  version: number;
  updatedAt: number;
}

export const SAVE_VERSION = 8;

// ——— 用户可见提示（persistence 不反向 import store，由外部经回调注入到 setNotice 通道） ———

/** 用户可见提示回调（存档损坏/版本不兼容/写入失败等不能静默的问题） */
export type PersistenceNoticeHandler = (message: string) => void;

let noticeHandler: PersistenceNoticeHandler | null = null;

/** 注册用户可见提示回调（store/World 注入 setNotice；传 null 解除） */
export function setPersistenceNoticeHandler(fn: PersistenceNoticeHandler | null): void {
  noticeHandler = fn;
}

function notifyPersistence(message: string): void {
  console.warn(`[存档] ${message}`);
  noticeHandler?.(message);
}

// ——— 版本与损坏校验 ———

/** 读档后的浅校验：seed 类型、survival 槽位是否数组、dims 结构（损坏返回 false，走「明示损坏 + 清库」路径） */
export function validateWorldMeta(meta: WorldMeta): boolean {
  if (typeof meta.seed !== 'string') return false;
  if (meta.dayTime !== undefined && typeof meta.dayTime !== 'number') return false;
  const sv = meta.survival;
  if (sv !== undefined) {
    if (!sv || typeof sv !== 'object') return false;
    if (!Array.isArray(sv.slots)) return false;
    if (sv.backpack !== undefined && !Array.isArray(sv.backpack)) return false;
  }
  if (meta.dims !== undefined) {
    if (!meta.dims || typeof meta.dims !== 'object') return false;
    for (const dim of Object.keys(meta.dims)) {
      if (!DIM_KEYS.includes(dim as DimKey)) return false;
      const de = meta.dims[dim as DimKey];
      if (!de || typeof de !== 'object') return false;
      if (de.storages !== undefined && (typeof de.storages !== 'object' || de.storages === null)) return false;
      if (de.beacons !== undefined && (typeof de.beacons !== 'object' || de.beacons === null)) return false;
    }
  }
  return true;
}

// ——— 维度化 extras 的收集与还原（scope 名与 lib/worldScope.ts 注册名对应：furnace/brewing/storage） ———

/** 世界作用域 registry 快照 → 维度存档字段（空容器/空表不落字段，保持存档紧凑） */
export function scopesToDimExtras(scopes: Record<string, unknown>): DimExtras {
  const out: DimExtras = {};
  const f = scopes.furnace;
  if (Array.isArray(f) && f.length > 0) out.furnaces = Object.fromEntries(f as [string, FurnaceState][]);
  const b = scopes.brewing;
  if (Array.isArray(b) && b.length > 0) out.brews = Object.fromEntries(b as [string, BrewState][]);
  const st = scopes.storage;
  if (Array.isArray(st)) {
    const nonEmpty = (st as [string, Slot[]][]).filter(([, slots]) => Array.isArray(slots) && slots.some((s) => s !== null));
    if (nonEmpty.length > 0) out.storages = Object.fromEntries(nonEmpty);
  }
  const bc = scopes.beacon;
  if (Array.isArray(bc) && bc.length > 0) out.beacons = Object.fromEntries(bc as [string, ActiveBeacon][]);
  return out;
}

/** 维度存档字段 → registry 快照格式（restoreWorldScopes 直接消费；tnt 引信等纯运行时状态不落盘故不在此） */
export function dimExtrasToScopes(dim: DimExtras | undefined): Record<string, unknown> {
  const scopes: Record<string, unknown> = {};
  if (!dim) return scopes;
  if (dim.furnaces) scopes.furnace = Object.entries(dim.furnaces);
  if (dim.brews) scopes.brewing = Object.entries(dim.brews);
  if (dim.storages) scopes.storage = Object.entries(dim.storages);
  if (dim.beacons) scopes.beacon = Object.entries(dim.beacons);
  return scopes;
}

/** 合并出完整的 dims 字段：当前维度以 live 快照为准，其余维度以暂存为准——任何维度都不丢 */
export function mergeDims(
  currentDim: DimKey,
  current: DimExtras,
  stashed: Partial<Record<DimKey, DimExtras>>,
): Partial<Record<DimKey, DimExtras>> {
  const dims: Partial<Record<DimKey, DimExtras>> = {};
  for (const dim of DIM_KEYS) {
    const de = dim === currentDim ? current : stashed[dim];
    if (de && (de.furnaces || de.brews || de.storages || de.beacons)) dims[dim] = de;
  }
  return dims;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    // 多 tab 同时打开时旧连接会阻塞 upgrade（onblocked 永久挂起，世界加载无限转圈）——blocked 时提示并 10s 超时
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        d.createObjectStore('meta');
        d.createObjectStore('chunks');
      },
      blocked() {
        console.warn('[存档] IndexedDB 被其他标签页阻塞——请关闭多余的游戏标签页');
      },
    });
    // 兜底：10s 未打开则按失败处理（走 loadError 界面而非无限挂起）
    dbPromise = Promise.race([
      dbPromise,
      new Promise<IDBPDatabase>((_, reject) => setTimeout(() => reject(new Error('存档数据库打开超时（可能被其他标签页阻塞）')), 10000)),
    ]);
    // 失败后允许下次重试（否则 poolFailed 永久卡死）
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

export async function loadWorldMeta(): Promise<WorldMeta | null> {
  const d = await db();
  const raw = (await d.get('meta', META_KEY)) as unknown;
  if (raw == null) return null;
  const meta = raw as WorldMeta;
  // 版本不符即清库（无存量用户，不做迁移）；过旧/来自更新版本/损坏分别给明示文案，不静默丢档
  if (!meta || typeof meta !== 'object' || typeof meta.version !== 'number' || meta.version !== SAVE_VERSION) {
    const version = (raw as { version?: unknown })?.version;
    const reason =
      typeof version === 'number' && version > SAVE_VERSION
        ? `存档由更新版本的游戏创建（v${version}），无法读取，已重置存档`
        : typeof version === 'number'
          ? `存档版本（v${version}）与当前格式（v${SAVE_VERSION}）不符，已重置存档`
          : '存档数据损坏，无法读取，已重置存档';
    notifyPersistence(reason);
    await clearWorldStore();
    return null;
  }
  if (!validateWorldMeta(meta)) {
    notifyPersistence('存档数据损坏，无法读取，已重置存档');
    await clearWorldStore();
    return null;
  }
  return meta;
}

export async function saveWorldMeta(meta: WorldMeta): Promise<void> {
  const d = await db();
  await d.put('meta', meta, META_KEY);
}

export function worldMeta(seed: string, extras: SaveExtras = {}): WorldMeta {
  return { seed, version: SAVE_VERSION, updatedAt: Date.now(), ...extras };
}

/** 全部已存 chunk 的 key（仅 key，适合启动时筛选附近预载） */
export async function listChunkKeys(): Promise<string[]> {
  const d = await db();
  const keys = await d.getAllKeys('chunks');
  return keys.map(String);
}

/** 按需读取指定 key 的 chunk 数据（不存在的 key 自动跳过） */
export async function loadChunks(keys: string[]): Promise<Map<string, Uint16Array>> {
  const map = new Map<string, Uint16Array>();
  if (keys.length === 0) return map;
  const d = await db();
  const tx = d.transaction('chunks', 'readonly');
  const values = await Promise.all(keys.map((k) => tx.store.get(k) as Promise<Uint16Array | undefined>));
  await tx.done;
  keys.forEach((k, i) => {
    const v = values[i];
    if (v) map.set(k, v);
  });
  return map;
}

export async function saveChunk(key: string, data: Uint16Array): Promise<void> {
  const d = await db();
  await d.put('chunks', data, key);
}

/** 屠龙标记的 meta 键：按世界种子隔离（与非主世界 chunk 的 'n:'/'e:' 前缀同风格；清档随 meta 一并清除） */
const dragonSlainKey = (seed: string): string => `e:dragon-slain:${seed}`;

/** 记录末影龙已被击杀（击杀即写入，防刷新页面后龙复活而返回门已激活的矛盾态） */
export async function saveDragonSlain(seed: string): Promise<void> {
  try {
    const d = await db();
    await d.put('meta', true, dragonSlainKey(seed));
  } catch (err) {
    console.warn('屠龙标记写入失败', err);
  }
}

/** 读取末影龙是否已被击杀（进末地时恢复；无记录或读取失败按未击杀） */
export async function loadDragonSlain(seed: string): Promise<boolean> {
  try {
    const d = await db();
    return ((await d.get('meta', dragonSlainKey(seed))) as boolean | undefined) === true;
  } catch {
    return false;
  }
}

/** 连续写入失败只提示一次（autosave 每 5s 一次，不能刷屏）；恢复成功后重置，再次失败会再提示 */
let saveErrorNotified = false;

/** 把世界里所有被修改过的 chunk 写入 IndexedDB 并清除标记；同时更新 meta（位置/时刻/模式/生存数值/各维度容器状态）。
 * keyPrefix 用于下界存档隔离（下界 chunk 键加 'n:' 前缀） */
export async function saveModifiedChunks(world: World, extras: SaveExtras = {}, keyPrefix = ''): Promise<void> {
  try {
    const d = await db();
    if (world.modifiedChunks.size > 0) {
      const tx = d.transaction('chunks', 'readwrite');
      for (const key of world.modifiedChunks) {
        const chunk = world.chunks.get(key);
        if (chunk) void tx.store.put(chunk.data, keyPrefix + key);
      }
      await tx.done;
      // 事务提交成功后再清标记，失败则保留待下轮重试
      world.modifiedChunks.clear();
    }
    await saveWorldMeta(worldMeta(world.seed, extras));
    saveErrorNotified = false; // 恢复成功：下次失败允许再次提示
  } catch (err) {
    // 写失败不能静默：每段连续失败至少提示一次（经注入的 notice 通道），但不随 autosave 刷屏
    if (!saveErrorNotified) {
      saveErrorNotified = true;
      notifyPersistence('存档写入失败：最近的进度可能不会被保存（请检查浏览器存储空间/权限）');
    }
    console.warn('存档写入失败', err);
  }
}

export async function clearWorldStore(): Promise<void> {
  const d = await db();
  await d.clear('meta');
  await d.clear('chunks');
}
