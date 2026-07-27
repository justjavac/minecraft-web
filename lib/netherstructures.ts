// 下界堡垒：区域级确定性（下界砖十字桥廊 + 塔楼 + 地狱疣园 + 宝箱），跨 chunk 一致
// 生物生成联动：trySpawnNether 按 fortressNear 调烈焰人/凋灵骷髅比例

import { AIR, BLOCK_BY_KEY } from './blocks';
import { hash2, type Terrain } from './noise';
import { fillChest, type LootEntry } from './structures';
import { CHUNK_SIZE, WORLD_HEIGHT, localIndex } from './world';
import { LAVA_SEA } from './nether';

const REGION = 64;

const K = (key: string) => BLOCK_BY_KEY[key].id;

const FORTRESS_LOOT: LootEntry[] = [
  ['diamond', 1, 2, 0.3],
  ['gold_ingot', 1, 3, 0.5],
  ['iron_ingot', 1, 3, 0.5],
  ['nether_wart', 1, 3, 0.6],
];

export interface FortressSpot {
  x: number;
  y: number;
  z: number;
}

/** 该区域是否有堡垒（约 8% 区域；基面取地表与岩浆海平面+5 的较高者，可横跨岩浆湖） */
export function fortressAt(seedHash: number, terrain: Terrain, rx: number, rz: number): FortressSpot | null {
  const r = hash2(seedHash ^ 0xf04755, rx, rz);
  if (r >= 0.08) return null;
  const x = rx * REGION + 16 + Math.floor(hash2(seedHash ^ 0xf04756, rx, rz) * 32);
  const z = rz * REGION + 16 + Math.floor(hash2(seedHash ^ 0xf04757, rx, rz) * 32);
  const y = Math.max(terrain.heightAt(x, z), LAVA_SEA + 5);
  return { x, y, z };
}

/** 玩家附近是否有堡垒（下界刷怪比例用；半径内区域扫描） */
export function fortressNear(seedHash: number, terrain: Terrain, x: number, z: number, maxDist: number): boolean {
  const rx = Math.floor(x / REGION);
  const rz = Math.floor(z / REGION);
  for (let drx = -1; drx <= 1; drx++) {
    for (let drz = -1; drz <= 1; drz++) {
      const f = fortressAt(seedHash, terrain, rx + drx, rz + drz);
      if (f && Math.hypot(f.x - x, f.z - z) <= maxDist) return true;
    }
  }
  return false;
}

function put(data: Uint16Array, cx: number, cz: number, x: number, y: number, z: number, id: number): void {
  const lx = x - cx * CHUNK_SIZE;
  const lz = z - cz * CHUNK_SIZE;
  if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return;
  data[localIndex(lx, y, lz)] = id;
}

/** 桥廊：一段 floor 桥面 + 两侧栏杆柱 + 桥墩（每隔 5 格下伸到实心/岩浆面 3 格） */
function writeBridge(f: FortressSpot, terrain: Terrain, cx: number, cz: number, data: Uint16Array, axis: 'x' | 'z', from: number, to: number, seedHash: number): void {
  const bricks = K('nether_bricks');
  for (let a = from; a <= to; a++) {
    for (let w = -2; w <= 2; w++) {
      const [x, z] = axis === 'x' ? [a, f.z + w] : [f.x + w, a];
      put(data, cx, cz, x, f.y, z, bricks);
      // 桥面以上清空（廊道可走）
      for (let dy = 1; dy <= 4; dy++) put(data, cx, cz, x, f.y + dy, z, AIR);
      // 栏杆：边缘隔 3 一格立柱
      if (Math.abs(w) === 2 && a % 3 === 0) put(data, cx, cz, x, f.y + 1, z, bricks);
    }
    // 桥墩：每隔 5 格下伸
    if (a % 5 === 0) {
      const [x, z] = axis === 'x' ? [a, f.z] : [f.x, a];
      const gy = terrain.heightAt(x, z);
      for (let y = f.y - 1; y >= Math.max(gy - 2, 2); y--) put(data, cx, cz, x, y, z, bricks);
    }
  }
  void seedHash;
}

/** 塔楼：9×9×6 主室（窗洞 + 平屋顶），室内地狱疣园与双宝箱 */
function writeTower(f: FortressSpot, cx: number, cz: number, data: Uint16Array, seedHash: number): void {
  const bricks = K('nether_bricks');
  for (let x = -4; x <= 4; x++) {
    for (let z = -4; z <= 4; z++) {
      put(data, cx, cz, f.x + x, f.y, f.z + z, bricks);
      const edge = Math.abs(x) === 4 || Math.abs(z) === 4;
      for (let dy = 1; dy <= 5; dy++) {
        if (!edge) {
          put(data, cx, cz, f.x + x, f.y + dy, f.z + z, AIR);
          continue;
        }
        const win = dy >= 2 && dy <= 3 && ((Math.abs(x) <= 1 && Math.abs(z) === 4) || (Math.abs(z) <= 1 && Math.abs(x) === 4));
        put(data, cx, cz, f.x + x, f.y + dy, f.z + z, win ? AIR : bricks);
      }
      // 平屋顶 + 四隅小柱
      put(data, cx, cz, f.x + x, f.y + 6, f.z + z, bricks);
      if (Math.abs(x) === 4 && Math.abs(z) === 4) for (let dy = 7; dy <= 9; dy++) put(data, cx, cz, f.x + x, f.y + dy, f.z + z, bricks);
    }
  }
  // 地狱疣园：室内 3×3 灵魂沙 + 地狱疣
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      put(data, cx, cz, f.x + dx, f.y + 1, f.z + dz, K('soul_sand'));
      put(data, cx, cz, f.x + dx, f.y + 2, f.z + dz, K('nether_wart'));
    }
  }
  // 双宝箱（东北/西南角）
  put(data, cx, cz, f.x + 3, f.y + 1, f.z - 3, K('chest'));
  fillChest(seedHash, f.x + 3, f.y + 1, f.z - 3, FORTRESS_LOOT);
  put(data, cx, cz, f.x - 3, f.y + 1, f.z + 3, K('chest'));
  fillChest(seedHash, f.x - 3, f.y + 1, f.z + 3, FORTRESS_LOOT);
}

/** 下界 chunk 生成调用：写本 chunk覆盖的堡垒部分（检查本区域及相邻区域） */
export function applyNetherStructures(seedHash: number, terrain: Terrain, cx: number, cz: number, data: Uint16Array): void {
  const rx = Math.floor((cx * CHUNK_SIZE) / REGION);
  const rz = Math.floor((cz * CHUNK_SIZE) / REGION);
  for (let drx = -1; drx <= 1; drx++) {
    for (let drz = -1; drz <= 1; drz++) {
      const f = fortressAt(seedHash, terrain, rx + drx, rz + drz);
      if (!f) continue;
      writeBridge(f, terrain, cx, cz, data, 'x', f.x - 15, f.x + 15, seedHash);
      writeBridge(f, terrain, cx, cz, data, 'z', f.z - 10, f.z + 10, seedHash);
      writeTower(f, cx, cz, data, seedHash);
    }
  }
  applyBastion(seedHash, terrain, cx, cz, data);
}

// ——— 猪灵堡垒（Bastion Remnant）：黑石残垣 + 金块堆 + 宝箱（MC 下界合金碎片主要来源） ———

const BASTION_LOOT: LootEntry[] = [
  ['netherite_scrap', 1, 1, 0.12],
  ['netherite_ingot', 1, 1, 0.04],
  ['gold_ingot', 2, 6, 0.6],
  ['diamond', 1, 2, 0.3],
  ['iron_ingot', 1, 3, 0.4],
  ['quartz', 3, 8, 0.4],
];

/** 该区域是否有猪灵堡垒（约 6% 区域，与下界堡垒不同盐值；MC 两结构互斥的简化——不互斥但稀少） */
export function bastionAt(seedHash: number, terrain: Terrain, rx: number, rz: number): FortressSpot | null {
  const r = hash2(seedHash ^ 0xba5710, rx, rz);
  if (r >= 0.06) return null;
  const x = rx * REGION + 16 + Math.floor(hash2(seedHash ^ 0xba5711, rx, rz) * 32);
  const z = rz * REGION + 16 + Math.floor(hash2(seedHash ^ 0xba5712, rx, rz) * 32);
  const y = Math.max(terrain.heightAt(x, z), LAVA_SEA + 5);
  return { x, y, z };
}

/** 玩家附近是否有猪灵堡垒（刷怪：附近出猪灵/蛮兵） */
export function bastionNear(seedHash: number, terrain: Terrain, x: number, z: number, maxDist: number): boolean {
  const rx = Math.floor(x / REGION);
  const rz = Math.floor(z / REGION);
  for (let drx = -1; drx <= 1; drx++) {
    for (let drz = -1; drz <= 1; drz++) {
      const b = bastionAt(seedHash, terrain, rx + drx, rz + drz);
      if (b && Math.hypot(b.x - x, b.z - z) <= maxDist) return true;
    }
  }
  return false;
}

/** 堡垒主体：21×21 黑石基座 + 残破外墙（高 3-7 种子抖动、缺口）+ 中央金块堆与主塔宝箱 */
function writeBastion(b: FortressSpot, terrain: Terrain, cx: number, cz: number, data: Uint16Array, seedHash: number): void {
  const blackstone = K('blackstone');
  const basalt = K('basalt');
  // 基座 + 残墙
  for (let x = -10; x <= 10; x++) {
    for (let z = -10; z <= 10; z++) {
      put(data, cx, cz, b.x + x, b.y, b.z + z, blackstone);
      const edge = Math.abs(x) === 10 || Math.abs(z) === 10;
      if (edge) {
        const h = 3 + Math.floor(hash2(seedHash ^ 0xba5e01, b.x + x, b.z + z) * 5); // 3-7
        for (let dy = 1; dy <= h; dy++) {
          // 残破缺口（约 1/4 墙段缺失）与出入门洞（四边中点 2 宽）
          const mid = (Math.abs(x) <= 1 && Math.abs(z) === 10) || (Math.abs(z) <= 1 && Math.abs(x) === 10);
          const broken = hash2(seedHash ^ 0xba5e02, b.x + x, b.z + z) < 0.25;
          if (!mid && !broken) put(data, cx, cz, b.x + x, b.y + dy, b.z + z, dy % 2 === 0 ? blackstone : basalt);
        }
      } else {
        for (let dy = 1; dy <= 8; dy++) put(data, cx, cz, b.x + x, b.y + dy, b.z + z, AIR); // 场内净空
      }
    }
  }
  // 中央金块堆（MC 堡垒藏金）：2×2×2 金块 + 底衬岩浆块
  for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
    put(data, cx, cz, b.x + dx, b.y + 1, b.z + dz, K('magma_block'));
    put(data, cx, cz, b.x + dx, b.y + 2, b.z + dz, K('gold_block'));
    put(data, cx, cz, b.x + dx, b.y + 3, b.z + dz, K('gold_block'));
  }
  // 主塔：7×7 黑石塔（高 8，窗洞），塔顶宝箱 ×1 + 塔脚宝箱 ×2
  for (let x = -3; x <= 3; x++) {
    for (let z = -3; z <= 3; z++) {
      for (let dy = 1; dy <= 8; dy++) {
        const edge = Math.abs(x) === 3 || Math.abs(z) === 3;
        const tx = b.x - 7 + x;
        const tz = b.z - 7 + z;
        if (!edge) {
          put(data, cx, cz, tx, b.y + dy, tz, AIR);
          continue;
        }
        const win = dy >= 4 && dy <= 5 && ((Math.abs(x) <= 1 && Math.abs(z) === 3) || (Math.abs(z) <= 1 && Math.abs(x) === 3));
        put(data, cx, cz, tx, b.y + dy, tz, win ? AIR : blackstone);
      }
      put(data, cx, cz, b.x - 7 + x, b.y + 9, b.z - 7 + z, blackstone); // 塔顶
    }
  }
  put(data, cx, cz, b.x - 7, b.y + 2, b.z - 7, K('chest'));
  fillChest(seedHash, b.x - 7, b.y + 2, b.z - 7, BASTION_LOOT);
  put(data, cx, cz, b.x + 8, b.y + 1, b.z - 8, K('chest'));
  fillChest(seedHash, b.x + 8, b.y + 1, b.z - 8, BASTION_LOOT);
  put(data, cx, cz, b.x + 8, b.y + 1, b.z + 8, K('chest'));
  fillChest(seedHash, b.x + 8, b.y + 1, b.z + 8, BASTION_LOOT);
}

/** 猪灵堡垒写入（与 fortress 同管线，区域扫描相邻 3×3） */
function applyBastion(seedHash: number, terrain: Terrain, cx: number, cz: number, data: Uint16Array): void {
  const rx = Math.floor((cx * CHUNK_SIZE) / REGION);
  const rz = Math.floor((cz * CHUNK_SIZE) / REGION);
  for (let drx = -1; drx <= 1; drx++) {
    for (let drz = -1; drz <= 1; drz++) {
      const b = bastionAt(seedHash, terrain, rx + drx, rz + drz);
      if (b) writeBastion(b, terrain, cx, cz, data, seedHash);
    }
  }
}
