// 红石供能：电源（红石火把/开着的拉杆/红石块）+ 红石粉 BFS 衰减传播 + 元件供能反应
// world.setBlock 经 notifyRedstone 触发局部重算；消费端：红石灯亮灭、橡木门开关、TNT 引爆、活塞推收

import { AIR, BLOCK_BY_KEY, BLOCKS, type BlockId } from './blocks';
import { cleanupOrphanHeads, isExtended, isPistonId, retract, tryExtend } from './pistons';
import { igniteTnt } from './tnt';
import type { World } from './world';

const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;

/** 粉网络功率图（0-15） */
const power = new Map<string, number>();
/** 电源位置登记（红石火把/开着的拉杆/红石块） */
const sources = new Set<string>();

const DUST = () => BLOCK_BY_KEY.redstone_dust.id;
const TORCH = () => BLOCK_BY_KEY.redstone_torch.id;
const LEVER_ON = () => BLOCK_BY_KEY.lever_on.id;
const RS_BLOCK = () => BLOCK_BY_KEY.redstone_block.id;
const LAMP = () => BLOCK_BY_KEY.redstone_lamp.id;
const LAMP_LIT = () => BLOCK_BY_KEY.redstone_lamp_lit.id;
const TNT = () => BLOCK_BY_KEY.tnt.id;

const isSourceId = (id: BlockId): boolean => id === TORCH() || id === LEVER_ON() || id === RS_BLOCK();

/** 元件（消费端）：红石灯/门/TNT/活塞 */
function isConsumerId(id: BlockId): boolean {
  const def = BLOCKS[id];
  if (!def) return false;
  return id === LAMP() || id === LAMP_LIT() || id === TNT() || def.shape === 'door' || isPistonId(id) || def.key === 'piston_head';
}

const DIRS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
] as const;

/** 某格是否被供能（邻接电源，或邻接有功率的红石粉） */
export function poweredAt(x: number, y: number, z: number): boolean {
  for (const [dx, dy, dz] of DIRS) {
    if (sources.has(key(x + dx, y + dy, z + dz))) return true;
  }
  for (const [dx, dy, dz] of DIRS) {
    if ((power.get(key(x + dx, y + dy, z + dz)) ?? 0) > 0) return true;
  }
  return false;
}

/** 粉的当前功率（HUD/调试可用；无则 0） */
export function dustPowerAt(x: number, y: number, z: number): number {
  return power.get(key(x, y, z)) ?? 0;
}

const R = 17; // 局部重算半径（粉最远传 15 格）

let applying = false; // 反应回写防重入

/** 以 (cx,cy,cz) 为中心局部重算粉网络并应用元件反应 */
function recompute(world: World, cx: number, cy: number, cz: number): void {
  if (applying) return;
  // 1. 清半径内旧功率
  for (const k of [...power.keys()]) {
    const [x, y, z] = k.split(',').map(Number);
    if (Math.abs(x - cx) <= R && Math.abs(y - cy) <= R && Math.abs(z - cz) <= R) power.delete(k);
  }
  // 2. 半径内电源播种：邻格粉从 15 起（MC：电源供能邻接粉 15 级）
  const queue: [number, number, number, number][] = [];
  const trySet = (x: number, y: number, z: number, level: number): void => {
    if (world.getBlock(x, y, z) !== DUST()) return;
    const k = key(x, y, z);
    if ((power.get(k) ?? 0) >= level) return;
    power.set(k, level);
    if (level > 1) queue.push([x, y, z, level]);
  };
  for (const k of sources) {
    const [x, y, z] = k.split(',').map(Number);
    if (Math.abs(x - cx) > R || Math.abs(y - cy) > R || Math.abs(z - cz) > R) continue;
    for (const [dx, dy, dz] of DIRS) trySet(x + dx, y + dy, z + dz, 15);
  }
  // 3. BFS 衰减传播（6 向，近似 MC 粉的上下连接）
  while (queue.length > 0) {
    const [x, y, z, level] = queue.shift()!;
    for (const [dx, dy, dz] of DIRS) trySet(x + dx, y + dy, z + dz, level - 1);
  }
  // 4. 半径内元件反应（先收集再回写，避免边算边改）
  const reacts: (() => void)[] = [];
  for (let x = cx - R; x <= cx + R; x++) {
    for (let y = Math.max(0, cy - R); y <= cy + R; y++) {
      for (let z = cz - R; z <= cz + R; z++) {
        const id = world.getBlock(x, y, z);
        if (!isConsumerId(id)) continue;
        const on = poweredAt(x, y, z);
        if (id === LAMP() && on) reacts.push(() => world.setBlock(x, y, z, LAMP_LIT()));
        else if (id === LAMP_LIT() && !on) reacts.push(() => world.setBlock(x, y, z, LAMP()));
        else if (id === TNT() && on) {
          reacts.push(() => {
            world.setBlock(x, y, z, AIR);
            igniteTnt(x, y, z);
          });
        } else if (isPistonId(id)) {
          // 活塞：供能推出、断能收回（粘性拉回）
          if (on && !isExtended(world, x, y, z)) reacts.push(() => tryExtend(world, x, y, z));
          else if (!on && isExtended(world, x, y, z)) reacts.push(() => retract(world, x, y, z));
        } else if (BLOCKS[id]?.key === 'piston_head') {
          // 孤儿活塞头：背向无活塞自动消失
          reacts.push(() => cleanupOrphanHeads(world, x, y, z));
        } else {
          const def = BLOCKS[id];
          if (def?.shape === 'door') {
            // 门：供能开、断能合（上下两格同步；注册序每朝向 [bottom, top, open_bottom, open_top]）
            const f = def.facing!;
            const baseId = BLOCK_BY_KEY.oak_door_bottom_n.id + f * 4;
            const wantOpen = on;
            if (def.doorOpen !== wantOpen) {
              const bottomY = def.doorHalf === 'top' ? y - 1 : y;
              reacts.push(() => {
                world.setBlock(x, bottomY, z, baseId + (wantOpen ? 2 : 0));
                world.setBlock(x, bottomY + 1, z, baseId + (wantOpen ? 3 : 1));
              });
            }
          }
        }
      }
    }
  }
  if (reacts.length > 0) {
    applying = true;
    try {
      for (const fn of reacts) fn();
    } finally {
      applying = false;
    }
  }
}

/** world.setBlock 钩子：电源登记 + 粉/电源/元件变动触发局部重算 */
export function notifyRedstone(world: World, x: number, y: number, z: number, oldId: BlockId, newId: BlockId): void {
  if (oldId === newId) return;
  const k = key(x, y, z);
  if (isSourceId(oldId)) sources.delete(k);
  if (isSourceId(newId)) sources.add(k);
  if (applying) return; // 反应回写不再触发（状态已是目标态）
  if (isSourceId(oldId) || isSourceId(newId) || oldId === DUST() || newId === DUST() || isConsumerId(oldId) || isConsumerId(newId)) {
    recompute(world, x, y, z);
  }
}

/** 拉杆右击切换（actions 调用）：返回切换后是否开着 */
export function toggleLever(world: World, x: number, y: number, z: number): boolean {
  const id = world.getBlock(x, y, z);
  const on = id === LEVER_ON();
  if (id !== LEVER_ON() && id !== BLOCK_BY_KEY.lever.id) return false;
  world.setBlock(x, y, z, on ? BLOCK_BY_KEY.lever.id : LEVER_ON());
  return !on;
}

/** 切换世界时清空供能状态 */
export function clearRedstone(): void {
  power.clear();
  sources.clear();
}
