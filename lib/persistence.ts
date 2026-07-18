// IndexedDB 存档：meta 表存种子/玩家位置/昼夜/模式/生存数值，chunks 表存被玩家修改过的 chunk 完整数据

import { openDB, type IDBPDatabase } from 'idb';
import type { ArmorSlots } from './armor';
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
  /** MC 隐藏饱和度（可选，旧存档缺省回满） */
  saturation?: number;
  /** 热键栏 9 格（v2 槽位格式） */
  slots: Slot[];
  /** 装备槽（v4 新增，旧存档缺省为空） */
  armor?: ArmorSlots;
}

/** meta 的可选附加字段 */
export interface SaveExtras {
  /** 上次保存时的玩家位置（继续游戏时回到这里） */
  player?: PlayerPos;
  /** 昼夜时刻（0..1） */
  dayTime?: number;
  /** 世界模式：创造 / 生存 */
  mode?: WorldMode;
  /** 生存数值快照（仅生存模式） */
  survival?: SurvivalSnapshot;
  /** 世界内熔炉状态（"x,y,z" → 状态） */
  furnaces?: Record<string, FurnaceState>;
}

export interface WorldMeta extends SaveExtras {
  seed: string;
  /** 存档格式版本，与 SAVE_VERSION 不符则视为不兼容 */
  version: number;
  updatedAt: number;
}

export const SAVE_VERSION = 5;

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        d.createObjectStore('meta');
        d.createObjectStore('chunks');
      },
    });
  }
  return dbPromise;
}

export async function loadWorldMeta(): Promise<WorldMeta | null> {
  const d = await db();
  const meta = (await d.get('meta', META_KEY)) as WorldMeta | undefined;
  if (!meta) return null;
  if (meta.version !== SAVE_VERSION) {
    // 存档格式不兼容：清库避免旧数据错套新方块表
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

/** 把世界里所有被修改过的 chunk 写入 IndexedDB 并清除标记；同时更新 meta（位置/时刻/模式/生存数值） */
export async function saveModifiedChunks(world: World, extras: SaveExtras = {}): Promise<void> {
  const d = await db();
  if (world.modifiedChunks.size > 0) {
    const tx = d.transaction('chunks', 'readwrite');
    for (const key of world.modifiedChunks) {
      const chunk = world.chunks.get(key);
      if (chunk) void tx.store.put(chunk.data, key);
    }
    world.modifiedChunks.clear();
    await tx.done;
  }
  await saveWorldMeta(worldMeta(world.seed, extras));
}

export async function clearWorldStore(): Promise<void> {
  const d = await db();
  await d.clear('meta');
  await d.clear('chunks');
}
