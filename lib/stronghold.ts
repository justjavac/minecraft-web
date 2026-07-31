// 要塞：种子确定性定位（MC 环带分布简化：8 座，半径 1000-1800）+ 地下石砖结构（末地门房间）
// 末影之眼投掷指向最近要塞；12 框架全嵌眼 → 生成末地传送门（MC 规则）

import { AIR, BLOCK_BY_KEY } from './blocks';
import { fillChest, type LootEntry } from './structures';
import { type World } from './world';
import { CHUNK_SIZE, put } from './grid';

const K = (key: string) => BLOCK_BY_KEY[key].id;
const STONE_BRICKS = () => K('stone_bricks');

function hash2(seedHash: number, a: number, b: number): number {
  let h = (seedHash ^ Math.imul(a, 374761393) ^ Math.imul(b, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export interface StrongholdSpot {
  x: number;
  z: number;
}

/** 要塞基座层（地板 y）；房间高 4，天花板 y+4 */
export const STRONGHOLD_Y = 12;
/** 要塞半边宽（结构范围 25×25） */
const HALF = 12;

const spotsCache = new Map<number, StrongholdSpot[]>();

/** 8 座要塞，环带均匀分布 + 种子抖动（MC 第一环 3 座的简化，便于找到） */
export function strongholds(seedHash: number): StrongholdSpot[] {
  let list = spotsCache.get(seedHash);
  if (!list) {
    list = [];
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + ((hash2(seedHash, i, 1) % 100) / 100) * 0.7;
      const r = 1000 + (hash2(seedHash, i, 2) % 800);
      list.push({ x: Math.round(Math.cos(angle) * r), z: Math.round(Math.sin(angle) * r) });
    }
    spotsCache.set(seedHash, list);
  }
  return list;
}

/** 距 (x,z) 最近的要塞（末影之眼指向） */
export function nearestStronghold(seedHash: number, x: number, z: number): StrongholdSpot {
  let best = strongholds(seedHash)[0];
  let bd = Infinity;
  for (const s of strongholds(seedHash)) {
    const d = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

/** 要塞宝箱战利品（MC 要塞图书馆/走廊箱的简化：末影珍珠是核心掉落） */
const LOOT: LootEntry[] = [
  ['ender_pearl', 1, 2, 0.35],
  ['paper', 1, 3, 0.5],
  ['book', 1, 2, 0.4],
  ['iron_ingot', 1, 3, 0.4],
];

/** 把要塞写入 chunk 数据（若不相交则立即返回）。结构：石砖外壳 25×25，中央 9×9 末地门房间 */
export function applyStronghold(seedHash: number, cx: number, cz: number, data: Uint16Array): void {
  const x0 = cx * CHUNK_SIZE;
  const z0 = cz * CHUNK_SIZE;
  for (const s of strongholds(seedHash)) {
    // chunk 与要塞范围相交？
    if (x0 + CHUNK_SIZE <= s.x - HALF || x0 > s.x + HALF || z0 + CHUNK_SIZE <= s.z - HALF || z0 > s.z + HALF) continue;
    const y = STRONGHOLD_Y;
    for (let wx = s.x - HALF; wx <= s.x + HALF; wx++) {
      for (let wz = s.z - HALF; wz <= s.z + HALF; wz++) {
        const edge = wx === s.x - HALF || wx === s.x + HALF || wz === s.z - HALF || wz === s.z + HALF;
        if (edge) {
          // 外壳：石砖实心墙（挡洞穴/山体）
          for (let dy = 0; dy <= 4; dy++) put(data, cx, cz, wx, y + dy, wz, STONE_BRICKS());
          continue;
        }
        put(data, cx, cz, wx, y, wz, STONE_BRICKS()); // 地板
        for (let dy = 1; dy <= 3; dy++) put(data, cx, cz, wx, y + dy, wz, AIR); // 内部掏空
        put(data, cx, cz, wx, y + 4, wz, STONE_BRICKS()); // 天花板
      }
    }
    // —— 末地门房间：中央 9×9（石砖墙 + 火把 + 宝箱 + 5×5 门框） ——
    const r = 4; // 房间半径
    for (let wx = s.x - r; wx <= s.x + r; wx++) {
      for (let wz = s.z - r; wz <= s.z + r; wz++) {
        const wall = wx === s.x - r || wx === s.x + r || wz === s.z - r || wz === s.z + r;
        if (!wall) continue;
        for (let dy = 1; dy <= 3; dy++) put(data, cx, cz, wx, y + dy, wz, STONE_BRICKS());
      }
    }
    // 四角留 2 宽门洞（通向环形走廊）
    for (const [dx, dz] of [[0, -r], [0, r], [-r, 0], [r, 0]] as const) {
      for (let dy = 1; dy <= 2; dy++) {
        put(data, cx, cz, s.x + dx, y + dy, s.z + dz, AIR);
        if (dx === 0) {
          put(data, cx, cz, s.x + dx - 1, y + dy, s.z + dz, AIR);
        } else {
          put(data, cx, cz, s.x + dx, y + dy, s.z + dz - 1, AIR);
        }
      }
    }
    // 门框：5×5 边圈去角 = 12 框架（MC），每框 10% 概率预嵌眼；中央 3×3 下置岩浆池
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
        const corner = Math.abs(dx) === 2 && Math.abs(dz) === 2;
        if (edge && !corner) {
          const hasEye = hash2(seedHash ^ 0x5eED01, s.x + dx, s.z + dz) % 10 === 0;
          put(data, cx, cz, s.x + dx, y + 1, s.z + dz, hasEye ? K('end_portal_frame_eye') : K('end_portal_frame'));
        } else if (!edge) {
          put(data, cx, cz, s.x + dx, y, s.z + dz, K('lava')); // 岩浆池（替换地板，MC 门悬于岩浆上）
          put(data, cx, cz, s.x + dx, y + 1, s.z + dz, AIR);
        }
      }
    }
    // 宝箱（房间东北角）与火把照明
    put(data, cx, cz, s.x + 3, y + 1, s.z - 3, K('chest'));
    fillChest(seedHash, s.x + 3, y + 1, s.z - 3, LOOT);
    for (const [tx, tz] of [[-3, -3], [3, 3]] as const) {
      put(data, cx, cz, s.x + tx, y + 1, s.z + tz, K('torch'));
    }
  }
}

/**
 * 右击空框架填入末影之眼；填完后若以某中心 5×5 的 12 框架全嵌眼，则中心 3×3 生成末地传送门。
 * 返回 'filled'（普通填入）/ 'activated'（门激活）/ 'invalid'（不是空框架）。
 */
export function fillPortalFrame(world: World, x: number, y: number, z: number): 'filled' | 'activated' | 'invalid' {
  if (world.getBlock(x, y, z) !== K('end_portal_frame')) return 'invalid';
  world.setBlock(x, y, z, K('end_portal_frame_eye'));
  // 枚举该框架可能隶属的门的中心（框架在 5×5 边圈上，中心距其 ≤2 格）
  for (let ox = x - 2; ox <= x + 2; ox++) {
    for (let oz = z - 2; oz <= z + 2; oz++) {
      if (!portalComplete(world, ox, y, oz)) continue;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) world.setBlock(ox + dx, y, oz + dz, K('end_portal'));
      }
      return 'activated';
    }
  }
  return 'filled';
}

/** 以 (cx,cz) 为中心的 12 框架是否全部嵌眼 */
function portalComplete(world: World, cx: number, y: number, cz: number): boolean {
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
      const corner = Math.abs(dx) === 2 && Math.abs(dz) === 2;
      if (!edge || corner) continue;
      if (world.getBlock(cx + dx, y, cz + dz) !== K('end_portal_frame_eye')) return false;
    }
  }
  return true;
}
