// 红石供能：电源（红石火把/开着的拉杆/红石块）+ 红石粉 BFS 衰减传播 + 元件供能反应
// world.setBlock 经 notifyRedstone 触发局部重算；消费端：红石灯亮灭、橡木门开关、TNT 引爆、活塞推收

import { AIR, BLOCK_BY_KEY, BLOCKS, type BlockId } from './blocks';
import { cleanupOrphanHeads, FACING_VEC, isExtended, isPistonId, retract, tryExtend } from './pistons';
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

const repeaterKey = (id: BlockId): string => BLOCKS[id]?.key ?? '';
export const isRepeaterId = (id: BlockId): boolean => repeaterKey(id).startsWith('repeater_');
const isRepeaterOnId = (id: BlockId): boolean => repeaterKey(id).startsWith('repeater_on_');

const compKey = (id: BlockId): string => BLOCKS[id]?.key ?? '';
export const isComparatorId = (id: BlockId): boolean => compKey(id).startsWith('comparator_');
const isComparatorOnId = (id: BlockId): boolean => compKey(id).startsWith('comparator_on_');

/** 比较器输出电平 0-15（比较 = 背向输入；减法 = 背向 − max(两侧)，MC） */
const compOutputs = new Map<string, number>();
/** 比较器模式：true = 减法（右键切换；默认 false 比较） */
const compSubtract = new Map<string, boolean>();

/** 右键切换比较器模式（比较 ↔ 减法，MC），返回是否减法 */
export function toggleComparatorMode(x: number, y: number, z: number): boolean {
  const k = key(x, y, z);
  const next = !compSubtract.get(k);
  compSubtract.set(k, next);
  return next;
}

/** 某格信号电平：电源 15，粉的当前功率，否则 0 */
function signalAt(x: number, y: number, z: number): number {
  if (sources.has(key(x, y, z))) return 15;
  return power.get(key(x, y, z)) ?? 0;
}

const isSourceId = (id: BlockId): boolean => id === TORCH() || id === LEVER_ON() || id === RS_BLOCK() || isRepeaterOnId(id);

/** 元件（消费端）：红石灯/门/TNT/活塞/中继器/比较器 */
function isConsumerId(id: BlockId): boolean {
  const def = BLOCKS[id];
  if (!def) return false;
  return id === LAMP() || id === LAMP_LIT() || id === TNT() || def.shape === 'door' || isPistonId(id) || def.key === 'piston_head' || isRepeaterId(id) || isComparatorId(id);
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
    const id = world.getBlock(x, y, z);
    if (isRepeaterOnId(id)) {
      // 中继器：只向输出方向（front）供能 15 级（信号再生，MC 核心特性）；
      // 前格与其顶面都播种（MC 粉铺在方块顶面，等价于前方方块被供能）
      const f = BLOCKS[id].facing ?? 0;
      const [dx, dy, dz] = FACING_VEC[f];
      trySet(x + dx, y + dy, z + dz, 15);
      trySet(x + dx, y + dy + 1, z + dz, 15);
    } else {
      for (const [dx, dy, dz] of DIRS) trySet(x + dx, y + dy, z + dz, 15);
    }
  }
  // 3. BFS 衰减传播（6 向，近似 MC 粉的上下连接）
  while (queue.length > 0) {
    const [x, y, z, level] = queue.shift()!;
    for (const [dx, dy, dz] of DIRS) trySet(x + dx, y + dy, z + dz, level - 1);
  }
  // 4. 半径内元件反应（先收集再回写，避免边算边改）
  const reacts: (() => void)[] = [];
  let compChanged = false; // 比较器电平变化需补播种传播 + 结算重播
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
        } else if (isRepeaterId(id)) {
          // 中继器：输入（背向）状态变化 → 按延迟档调度翻转（tickRedstone 结算）
          const f = BLOCKS[id].facing ?? 0;
          const [dx, dy, dz] = FACING_VEC[f];
          const inputOn = sources.has(key(x - dx, y - dy, z - dz)) || (power.get(key(x - dx, y - dy, z - dz)) ?? 0) > 0;
          if (inputOn !== isRepeaterOnId(id)) scheduleFlip(x, y, z);
        } else if (isComparatorId(id)) {
          // 比较器：比较（背向 ≥ 两侧 → 背向电平）/ 减法（背向 − max(两侧)，MC）
          const f = BLOCKS[id].facing ?? 0;
          const [dx, dy, dz] = FACING_VEC[f];
          const back = signalAt(x - dx, y - dy, z - dz);
          const [sx, sz] = f === 0 || f === 2 ? [1, 0] : [0, 1]; // 两侧方向（垂直于朝向）
          const side = Math.max(signalAt(x + sx, y, z + sz), signalAt(x - sx, y, z - sz));
          const out = compSubtract.get(key(x, y, z)) ? Math.max(back - side, 0) : back >= side ? back : 0;
          const prev = compOutputs.get(key(x, y, z)) ?? 0;
          compOutputs.set(key(x, y, z), out);
          // 输出端无条件补播种（front + 顶面）：本轮清空过的输出粉按当前电平恢复
          if (out > 0) {
            trySet(x + dx, y + dy, z + dz, out);
            trySet(x + dx, y + dy + 1, z + dz, out);
          }
          if (out !== prev) {
            // 电平变化：开关态同步 + 安排结算重播让下游元件跟上
            compChanged = true;
            const on = isComparatorOnId(id);
            if ((out > 0) !== on) {
              const suf = ['n', 'e', 's', 'w'][f];
              reacts.push(() => world.setBlock(x, y, z, BLOCK_BY_KEY[`comparator_${out > 0 ? 'on_' : ''}${suf}`].id));
            }
          }
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
  if (compChanged) {
    // 比较器电平变化：安排结算重播让下游元件按新电平刷新（等价 MC 的 1 tick 评估）
    pendingRecompute = [cx, cy, cz];
  }
  // 无条件下补传播：消费端（比较器）补播种的功率继续沿粉扩散
  while (queue.length > 0) {
    const [x, y, z, level] = queue.shift()!;
    for (const [dx, dy, dz] of DIRS) trySet(x + dx, y + dy, z + dz, level - 1);
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
  pendingFlips.length = 0;
  delays.clear();
  compOutputs.clear();
  compSubtract.clear();
  pendingRecompute = null;
}

/** 比较器电平变化后的结算重播位置（tickRedstone 消费） */
let pendingRecompute: [number, number, number] | null = null;

// ——— 红石中继器：延迟档与延迟翻转队列 ———

/** 各中继器的延迟档（1-4 档 × 0.1s；默认 1 档，MC 一致） */
const delays = new Map<string, number>();

/** 右键调档：1→2→3→4→1（MC），返回新档位数 */
export function cycleRepeaterDelay(x: number, y: number, z: number): number {
  const k = key(x, y, z);
  const next = ((delays.get(k) ?? 1) % 4) + 1;
  delays.set(k, next);
  return next;
}

interface Flip {
  key: string;
  at: number;
}

const pendingFlips: Flip[] = [];
let simTime = 0;

function scheduleFlip(x: number, y: number, z: number): void {
  const k = key(x, y, z);
  const at = simTime + (delays.get(k) ?? 1) * 0.1;
  const existing = pendingFlips.find((f) => f.key === k);
  if (existing) {
    existing.at = at; // 以最新一次输入变化为准
    return;
  }
  pendingFlips.push({ key: k, at });
}

/** 世界 tick 调用：结算到期的中继器翻转（延迟期间输入回到原态则去抖不翻——MC 特性）+ 比较器结算重播 */
export function tickRedstone(world: World, dt: number): void {
  simTime += dt;
  if (pendingRecompute) {
    const [cx, cy, cz] = pendingRecompute;
    pendingRecompute = null;
    recompute(world, cx, cy, cz);
  }
  if (pendingFlips.length === 0) return;
  const due = pendingFlips.filter((f) => f.at <= simTime);
  for (let i = pendingFlips.length - 1; i >= 0; i--) {
    if (pendingFlips[i].at <= simTime) pendingFlips.splice(i, 1);
  }
  for (const f of due) {
    const [x, y, z] = f.key.split(',').map(Number);
    const id = world.getBlock(x, y, z);
    if (!isRepeaterId(id)) continue;
    const facing = BLOCKS[id].facing ?? 0;
    const [dx, dy, dz] = FACING_VEC[facing];
    const inputOn = sources.has(key(x - dx, y - dy, z - dz)) || (power.get(key(x - dx, y - dy, z - dz)) ?? 0) > 0;
    if (inputOn === isRepeaterOnId(id)) continue; // 去抖：输入已回一致
    const suf = ['n', 'e', 's', 'w'][facing];
    world.setBlock(x, y, z, BLOCK_BY_KEY[`repeater_${inputOn ? 'on_' : ''}${suf}`].id);
  }
}
