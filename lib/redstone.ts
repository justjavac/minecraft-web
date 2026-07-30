// 红石供能：电源（红石火把/开着的拉杆/红石块/on 态中继器/按下的按钮/踩中的压力板/侦测器与标靶脉冲）
// + 红石粉 BFS 衰减传播 + 元件供能反应。world.setBlock 经 notifyRedstone 触发局部重算；
// 消费端：红石灯亮灭、橡木门开关、TNT 引爆、活塞推收、音符盒发声。
//
// 弱充能（MC 简化一层）：电源指向的实心方块被弱充能——红石火把充正上方块，拉杆/按钮充全部 6 邻（无朝向数据，
// 按附着面泛化），压力板充下方块，中继器/侦测器充输出方向块，红石块充全部 6 邻；弱充能块驱动邻接粉与元件
// （灯/门/TNT/活塞/音符盒），但不再链式外传（粉不回充方块，故 拉杆→方块→粉 导通而 方块→方块 不传）。
//
// 红石火把反相（NOT 门，MC）：下方附着块被充能（邻接电源/带电粉/弱充能块）时火把熄灭停止供电，失去充能复亮；
// 翻转经 pendingRecompute 下一 tick 生效，等价 MC 的火把延迟。火把不充能自己坐着的支撑块（否则自锁）。

import { AIR, BLOCK_BY_KEY, BLOCKS, type BlockId } from './blocks';
import { playerPosition } from './game';
import { mobs } from './mobs';
import { cleanupOrphanHeads, FACING_VEC, isExtended, isPistonId, retract, tryExtend } from './pistons';
import { noteBlock } from './sound';
import { igniteTnt } from './tnt';
import { type World } from './world';
import { CHUNK_SIZE, CHUNK_VOLUME, chunkKey } from './grid';

const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;

/** 粉网络功率图（0-15） */
const power = new Map<string, number>();
/** 电源位置登记（红石火把/开着的拉杆/红石块/on 态中继器/按下的按钮/踩中的压力板/脉冲中的侦测器与标靶） */
const sources = new Set<string>();
/** 定向电源（on 态中继器/脉冲侦测器）：位置键 → 朝向，只对输出面朝的邻位供电（MC）；其余电源全向 */
const dirSources = new Map<string, number>();
/** 弱充能的实心方块（电源直接指向；驱动邻接粉与元件，不链式外传） */
const weak = new Set<string>();

const DUST = () => BLOCK_BY_KEY.redstone_dust.id;
const TORCH = () => BLOCK_BY_KEY.redstone_torch.id;
const TORCH_OFF = () => BLOCK_BY_KEY.redstone_torch_off.id;
const LEVER_ON = () => BLOCK_BY_KEY.lever_on.id;
const RS_BLOCK = () => BLOCK_BY_KEY.redstone_block.id;
const LAMP = () => BLOCK_BY_KEY.redstone_lamp.id;
const LAMP_LIT = () => BLOCK_BY_KEY.redstone_lamp_lit.id;
const TNT = () => BLOCK_BY_KEY.tnt.id;
const NOTE = () => BLOCK_BY_KEY.note_block.id;
const TARGET = () => BLOCK_BY_KEY.target.id;

const blockKeyOf = (id: BlockId): string => BLOCKS[id]?.key ?? '';

/** 按钮（未按/按下两款）；按下态是电源，脉冲到期回弹 */
export const isButtonId = (id: BlockId): boolean => /^(oak|stone)_button(_on)?$/.test(blockKeyOf(id));
const isButtonOnId = (id: BlockId): boolean => /^(oak|stone)_button_on$/.test(blockKeyOf(id));
/** 压力板（玩家/生物踩中由 tick 登记为电源，离开撤销） */
export const isPressurePlateId = (id: BlockId): boolean => /^(oak|stone)_pressure_plate$/.test(blockKeyOf(id));
/** 侦测器（6 朝向变体） */
export const isObserverId = (id: BlockId): boolean => blockKeyOf(id).startsWith('observer_');

/** 侦测器 id：按朝向（0-5，同活塞 facing 约定） */
export function observerIdFor(facing: number): number {
  return BLOCK_BY_KEY[`observer_${['n', 'e', 's', 'w', 'u', 'd'][facing] ?? 'n'}`].id;
}

const isRepeaterIdInternal = (id: BlockId): boolean => blockKeyOf(id).startsWith('repeater_');
export const isRepeaterId = isRepeaterIdInternal;
const isRepeaterOnId = (id: BlockId): boolean => blockKeyOf(id).startsWith('repeater_on_');

export const isComparatorId = (id: BlockId): boolean => blockKeyOf(id).startsWith('comparator_');
const isComparatorOnId = (id: BlockId): boolean => blockKeyOf(id).startsWith('comparator_on_');

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

/** 某格信号电平：电源 15，弱充能块 15，粉的当前功率，否则 0 */
function signalAt(x: number, y: number, z: number): number {
  const k = key(x, y, z);
  if (sources.has(k) || weak.has(k)) return 15;
  return power.get(k) ?? 0;
}

const isSourceId = (id: BlockId): boolean => id === TORCH() || id === LEVER_ON() || id === RS_BLOCK() || isRepeaterOnId(id) || isButtonOnId(id);

/** 元件（消费端）：红石灯/门/TNT/活塞/中继器/比较器/音符盒 */
function isConsumerId(id: BlockId): boolean {
  const def = BLOCKS[id];
  if (!def) return false;
  return id === LAMP() || id === LAMP_LIT() || id === TNT() || id === NOTE() || def.shape === 'door' || isPistonId(id) || def.key === 'piston_head' || isRepeaterIdInternal(id) || isComparatorId(id);
}

const DIRS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
] as const;

/** 某格是否被供能（邻接电源/有功率的粉/弱充能块）；定向电源只对输出面朝的邻位供电（MC） */
export function poweredAt(x: number, y: number, z: number): boolean {
  for (const [dx, dy, dz] of DIRS) {
    const k = key(x + dx, y + dy, z + dz);
    if (sources.has(k)) {
      const f = dirSources.get(k);
      if (f === undefined) return true; // 火把/拉杆/红石块/按钮/压力板：全向供电
      const [fx, fy, fz] = FACING_VEC[f];
      if (fx === -dx && fy === -dy && fz === -dz) return true; // 中继器/侦测器只向面朝方向输出
    }
    if (weak.has(k)) return true; // 弱充能块驱动邻接元件（MC）
    if ((power.get(k) ?? 0) > 0) return true;
  }
  return false;
}

/** 方块是否被充能（火把反相判定）：邻接电源（忽略坐在本块上的火把——火把不充能自己的支撑块，MC）、
 *  邻接有功率的粉、或邻接弱充能块 */
function blockEnergized(world: World, x: number, y: number, z: number): boolean {
  for (const [dx, dy, dz] of DIRS) {
    const nx = x + dx;
    const ny = y + dy;
    const nz = z + dz;
    const k = key(nx, ny, nz);
    if (sources.has(k) && !(dy === 1 && world.getBlock(nx, ny, nz) === TORCH())) {
      const f = dirSources.get(k);
      if (f === undefined) return true;
      const [fx, fy, fz] = FACING_VEC[f];
      if (fx === -dx && fy === -dy && fz === -dz) return true;
    }
    if (weak.has(k)) return true;
    if ((power.get(k) ?? 0) > 0) return true;
  }
  return false;
}

/** 电源指向的弱充能目标格（MC 简化：火把→正上方块；拉杆/按钮→6 邻（无朝向数据）；压力板→下方块；
 *  中继器/侦测器→输出方向块；红石块→6 邻） */
function weakTargetsOf(x: number, y: number, z: number, id: BlockId, k: string): [number, number, number][] {
  if (isRepeaterOnId(id) || isObserverId(id)) {
    const f = dirSources.get(k);
    if (f === undefined) return [];
    const [dx, dy, dz] = FACING_VEC[f];
    return [[x + dx, y + dy, z + dz]];
  }
  if (id === TORCH()) return [[x, y + 1, z]];
  if (isPressurePlateId(id)) return [[x, y - 1, z]];
  if (id === LEVER_ON() || isButtonOnId(id) || id === RS_BLOCK()) {
    return DIRS.map(([dx, dy, dz]) => [x + dx, y + dy, z + dz] as [number, number, number]);
  }
  return [];
}

/** 撤销电源登记并清掉它留下的弱充能指向（拉杆关断/按钮回弹/压力板松开/脉冲到期/方块被挖） */
function removeSource(x: number, y: number, z: number, k: string): void {
  sources.delete(k);
  dirSources.delete(k);
  for (const [dx, dy, dz] of DIRS) weak.delete(key(x + dx, y + dy, z + dz));
}

/** 粉的当前功率（HUD/调试可用；无则 0） */
export function dustPowerAt(x: number, y: number, z: number): number {
  return power.get(key(x, y, z)) ?? 0;
}

const R = 17; // 元件反应扫描半径（粉最远传 15 格）

let applying = false; // 反应回写防重入

/** 以 (cx,cy,cz) 为中心局部重算粉网络并应用元件反应 */
function recompute(world: World, cx: number, cy: number, cz: number): void {
  if (applying) return;
  const inRange = (x: number, y: number, z: number): boolean => Math.abs(x - cx) <= R && Math.abs(y - cy) <= R && Math.abs(z - cz) <= R;
  // 1. 清旧功率：以半径内带电格与变动点邻域为入口，沿粉连通域 BFS 清除（不设半径）。
  //    链路超出 R 的远端也清得到；贴着被清网络的远端电源在下一步补种恢复——
  //    清除与播种覆盖同一连通域，长链路既不留幽灵功率，也不会误清远端活功率。
  const cleared = new Set<string>();
  const flood: [number, number, number][] = [];
  const pushCell = (x: number, y: number, z: number): void => {
    const k = key(x, y, z);
    if (cleared.has(k)) return;
    if (world.getBlock(x, y, z) !== DUST() && !power.has(k)) return; // 粉格，或曾带电的粉格（方块刚被改动）
    cleared.add(k);
    flood.push([x, y, z]);
  };
  for (const k of [...power.keys()]) {
    const [x, y, z] = k.split(',').map(Number);
    if (inRange(x, y, z)) pushCell(x, y, z);
  }
  pushCell(cx, cy, cz);
  for (const [dx, dy, dz] of DIRS) pushCell(cx + dx, cy + dy, cz + dz);
  while (flood.length > 0) {
    const [x, y, z] = flood.pop()!;
    power.delete(key(x, y, z));
    for (const [dx, dy, dz] of DIRS) pushCell(x + dx, y + dy, z + dz);
  }
  /** 与被清连通域相邻（半径外但贴着被清网络的电源/比较器也要补种） */
  const touchesCleared = (x: number, y: number, z: number): boolean => {
    for (const [dx, dy, dz] of DIRS) if (cleared.has(key(x + dx, y + dy, z + dz))) return true;
    return false;
  };
  // 2. 电源播种：半径内电源 + 贴着被清网络的半径外电源；邻格粉从 15 起（MC：电源供能邻接粉 15 级）。
  //    同时重建弱充能指向（撤销侧的清理见 removeSource / notifyRedstone）
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
    if (!inRange(x, y, z) && !touchesCleared(x, y, z)) continue;
    const id = world.getBlock(x, y, z);
    // 弱充能：电源指向的实心不透明方块
    for (const [wx, wy, wz] of weakTargetsOf(x, y, z, id, k)) {
      const def = BLOCKS[world.getBlock(wx, wy, wz)];
      if (def?.opaque && def.solid) weak.add(key(wx, wy, wz));
    }
    if (isRepeaterOnId(id)) {
      // 中继器：只向输出方向（front）供能 15 级（信号再生，MC 核心特性）；
      // 前格与其顶面都播种（MC 粉铺在方块顶面，等价于前方方块被供能）
      const f = BLOCKS[id].facing ?? 0;
      const [dx, dy, dz] = FACING_VEC[f];
      trySet(x + dx, y + dy, z + dz, 15);
      trySet(x + dx, y + dy + 1, z + dz, 15);
    } else if (isObserverId(id) && dirSources.has(k)) {
      // 侦测器脉冲：只向背面输出 15（MC 定向）
      const [dx, dy, dz] = FACING_VEC[dirSources.get(k)!];
      trySet(x + dx, y + dy, z + dz, 15);
      trySet(x + dx, y + dy + 1, z + dz, 15);
    } else {
      for (const [dx, dy, dz] of DIRS) trySet(x + dx, y + dy, z + dz, 15);
    }
  }
  // 弱充能块向邻接粉播种 15（拉杆→方块→粉 链路导通；弱充能不链式外传——粉不回充方块）
  for (const k of weak) {
    const [x, y, z] = k.split(',').map(Number);
    if (!inRange(x, y, z) && !touchesCleared(x, y, z)) continue;
    for (const [dx, dy, dz] of DIRS) trySet(x + dx, y + dy, z + dz, 15);
  }
  // 半径外比较器：输出粉被清则按记忆电平补种（半径内的由下方反应阶段按实时输入结算）
  for (const [k, out] of compOutputs) {
    if (out <= 0) continue;
    const [x, y, z] = k.split(',').map(Number);
    if (inRange(x, y, z)) continue;
    if (!touchesCleared(x, y, z)) continue;
    const id = world.getBlock(x, y, z);
    if (!isComparatorId(id)) continue;
    const f = BLOCKS[id].facing ?? 0;
    const [dx, dy, dz] = FACING_VEC[f];
    trySet(x + dx, y + dy, z + dz, out);
    trySet(x + dx, y + dy + 1, z + dz, out);
  }
  // 3. BFS 衰减传播（6 向，近似 MC 粉的上下连接）
  while (queue.length > 0) {
    const [x, y, z, level] = queue.shift()!;
    for (const [dx, dy, dz] of DIRS) trySet(x + dx, y + dy, z + dz, level - 1);
  }
  // 4. 半径内元件反应（先收集再回写，避免边算边改）
  const reacts: (() => void)[] = [];
  let compChanged = false; // 比较器电平变化需补播种传播 + 结算重播
  let torchChanged = false; // 火把反相翻转同理（等价 MC 火把延迟）
  for (let x = cx - R; x <= cx + R; x++) {
    for (let y = Math.max(0, cy - R); y <= cy + R; y++) {
      for (let z = cz - R; z <= cz + R; z++) {
        const id = world.getBlock(x, y, z);
        // 红石火把反相（NOT 门）：下方附着块被充能则熄灭，失去充能复亮
        if (id === TORCH() || id === TORCH_OFF()) {
          if (id === TORCH() && blockEnergized(world, x, y - 1, z)) {
            reacts.push(() => world.setBlock(x, y, z, TORCH_OFF()));
            torchChanged = true;
          } else if (id === TORCH_OFF() && !blockEnergized(world, x, y - 1, z)) {
            reacts.push(() => world.setBlock(x, y, z, TORCH()));
            torchChanged = true;
          }
          continue;
        }
        if (!isConsumerId(id)) continue;
        const on = poweredAt(x, y, z);
        if (id === LAMP() && on) reacts.push(() => world.setBlock(x, y, z, LAMP_LIT()));
        else if (id === LAMP_LIT() && !on) reacts.push(() => world.setBlock(x, y, z, LAMP()));
        else if (id === TNT() && on) {
          reacts.push(() => {
            world.setBlock(x, y, z, AIR);
            igniteTnt(x, y, z);
          });
        } else if (id === NOTE()) {
          // 音符盒：充能上升沿发声（音高按右击调音记录，默认 0 = C4）
          const k = key(x, y, z);
          const prev = noteStates.get(k) ?? false;
          noteStates.set(k, on);
          if (on && !prev) {
            const semi = notePitches.get(k) ?? 0;
            reacts.push(() => noteBlock(semi));
          }
        } else if (isPistonId(id)) {
          // 活塞：供能推出、断能收回（粘性拉回）
          if (on && !isExtended(world, x, y, z)) reacts.push(() => tryExtend(world, x, y, z));
          else if (!on && isExtended(world, x, y, z)) reacts.push(() => retract(world, x, y, z));
        } else if (isRepeaterIdInternal(id)) {
          // 中继器：输入（背向）状态变化 → 按延迟档调度翻转（tickRedstone 结算）
          const f = BLOCKS[id].facing ?? 0;
          const [dx, dy, dz] = FACING_VEC[f];
          const backKey = key(x - dx, y - dy, z - dz);
          const inputOn = sources.has(backKey) || weak.has(backKey) || (power.get(backKey) ?? 0) > 0;
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
  if (compChanged || torchChanged) {
    // 比较器电平变化 / 火把反相翻转：安排结算重播让下游元件按新状态刷新（等价 MC 的 1 tick 评估）
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
  const wasSource = sources.has(k); // 含压力板/侦测器/标靶等临时电源
  if (isSourceId(oldId) || wasSource) removeSource(x, y, z, k);
  weak.delete(k); // 本格曾弱充能：方块已变，指向失效
  activePlates.delete(k);
  if (isObserverId(oldId)) observers.delete(k);
  if (oldId === NOTE()) {
    noteStates.delete(k);
    notePitches.delete(k);
  }
  if (isSourceId(newId)) {
    sources.add(k);
    // on 态中继器是定向电源（只向输出面朝的邻位供电），其余电源全向
    if (isRepeaterOnId(newId)) dirSources.set(k, BLOCKS[newId].facing ?? 0);
  }
  if (isObserverId(newId)) {
    // 登记侦测器并记录面朝格初始状态：放置本身不触发脉冲（MC Java）
    const f = BLOCKS[newId].facing ?? 0;
    const [dx, dy, dz] = FACING_VEC[f];
    observers.set(k, world.getBlock(x + dx, y + dy, z + dz));
  }
  if (applying) return; // 反应回写不再触发（状态已是目标态）
  // 触发重算：电源/粉/元件变动；或本格贴着电源（实心块进出可能改变弱充能指向）
  const nearSource = DIRS.some(([dx, dy, dz]) => sources.has(key(x + dx, y + dy, z + dz)));
  if (isSourceId(oldId) || isSourceId(newId) || wasSource || oldId === DUST() || newId === DUST() || isConsumerId(oldId) || isConsumerId(newId) || nearSource) {
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

/** 右击按钮（actions 调用）：按下供电，石头 1s / 木质 1.5s 后回弹（MC）；
 *  已按下时忽略（MC 按住不重复触发）。返回是否按下成功 */
export function pressButton(world: World, x: number, y: number, z: number): boolean {
  const bk = blockKeyOf(world.getBlock(x, y, z));
  if (bk !== 'oak_button' && bk !== 'stone_button') return false;
  world.setBlock(x, y, z, BLOCK_BY_KEY[`${bk}_on`].id);
  pendingPulses.push({ key: key(x, y, z), at: simTime + (bk === 'stone_button' ? 1 : 1.5), kind: 'button' });
  return true;
}

/** 标靶被弹射物命中（箭矢撞块处调用）：全向 15 脉冲 1s（MC 按命中偏移 1-15 级 ×1s，简化为满级） */
export function strikeTarget(world: World, x: number, y: number, z: number): boolean {
  if (world.getBlock(x, y, z) !== TARGET()) return false;
  const k = key(x, y, z);
  const existing = pendingPulses.find((p) => p.key === k && p.kind === 'target');
  if (existing) existing.at = simTime + 1; // 重复命中：刷新时长（供电不中断）
  else pendingPulses.push({ key: k, at: simTime + 1, kind: 'target' });
  if (!sources.has(k)) {
    sources.add(k);
    recompute(world, x, y, z);
  }
  return true;
}

/** 右击音符盒调音（actions 调用）：升半音，0-23 循环（MC 24 半音），并发声试听；返回新半音数 */
export function tuneNoteBlock(x: number, y: number, z: number): number {
  const k = key(x, y, z);
  const next = ((notePitches.get(k) ?? 0) + 1) % 24;
  notePitches.set(k, next);
  noteBlock(next);
  return next;
}

/** 音符盒当前音高（半音 0-23，默认 0 = C4） */
export function notePitchAt(x: number, y: number, z: number): number {
  return notePitches.get(key(x, y, z)) ?? 0;
}

/** 切换世界时清空供能状态 */
export function clearRedstone(): void {
  power.clear();
  sources.clear();
  dirSources.clear();
  weak.clear();
  scannedChunks.clear();
  pendingFlips.length = 0;
  delays.clear();
  compOutputs.clear();
  compSubtract.clear();
  pendingRecompute = null;
  pendingPulses.length = 0;
  observers.clear();
  activePlates.clear();
  noteStates.clear();
  notePitches.clear();
}

// ——— 电源重扫：换维度/读档后从已加载 chunk 重建登记表 ———

/** 已扫过的 chunk（按 key；chunk 卸载重载后数据与扫描时一致，无需重扫） */
const scannedChunks = new Set<string>();

/**
 * 换维度/读档后重建电源登记：遍历已加载 chunk 找出电源方块（红石火把/开着的拉杆/红石块/on 态中继器），
 * 并对新发现的电源做局部重算恢复供能（灯亮、粉带电）。逐帧调用安全：只扫新加载的 chunk（增量）。
 * 同时重新登记侦测器（记录面朝格现状，不因读档误触发）与按下态按钮（不持久，读档后 1s 回弹）。
 * 注：后台惰性补齐的存档 chunk 若替换了已扫 chunk 的数据（applySavedChunk）可能漏扫，该 chunk 卸载重载后自动补扫。
 */
export function rescanSources(world: World): void {
  const found: [number, number, number][] = [];
  for (const chunk of world.chunks.values()) {
    const ck = chunkKey(chunk.cx, chunk.cz);
    if (scannedChunks.has(ck)) continue;
    scannedChunks.add(ck);
    const baseX = chunk.cx * CHUNK_SIZE;
    const baseZ = chunk.cz * CHUNK_SIZE;
    for (let i = 0; i < CHUNK_VOLUME; i++) {
      const id = chunk.data[i] as BlockId;
      if (!isSourceId(id) && !isObserverId(id)) continue;
      const x = baseX + (i % CHUNK_SIZE);
      const y = Math.floor(i / (CHUNK_SIZE * CHUNK_SIZE));
      const z = baseZ + (Math.floor(i / CHUNK_SIZE) % CHUNK_SIZE);
      const k = key(x, y, z);
      if (isObserverId(id)) {
        // 侦测器：记录面朝格现状（读档不触发脉冲，MC Java 放置/加载不触发）
        const f = BLOCKS[id].facing ?? 0;
        const [dx, dy, dz] = FACING_VEC[f];
        observers.set(k, world.getBlock(x + dx, y + dy, z + dz));
        continue;
      }
      sources.add(k);
      if (isRepeaterOnId(id)) dirSources.set(k, BLOCKS[id].facing ?? 0);
      if (isButtonOnId(id)) pendingPulses.push({ key: k, at: simTime + 1, kind: 'button' });
      found.push([x, y, z]);
    }
  }
  // 新发现的电源：局部重算让粉网络与元件恢复供能（按 R 去重，避免成片电源反复重算）
  const done: [number, number, number][] = [];
  for (const [x, y, z] of found) {
    if (done.some(([px, py, pz]) => Math.abs(px - x) <= R && Math.abs(py - y) <= R && Math.abs(pz - z) <= R)) continue;
    done.push([x, y, z]);
    recompute(world, x, y, z);
  }
}

/** 比较器电平变化 / 火把反相翻转后的结算重播位置（tickRedstone 消费） */
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

// ——— 脉冲（按钮回弹 / 侦测器与标靶的定时断电） ———

interface Pulse {
  key: string;
  at: number;
  kind: 'button' | 'observer' | 'target';
}

const pendingPulses: Pulse[] = [];

// ——— 压力板：踩中供电（玩家与生物，MC；信号 15） ———

/** 踩中的压力板位置（作为临时电源登记在 sources） */
const activePlates = new Set<string>();

/** 每 tick：比对玩家/生物脚下格与压力板，踩中登记供电、离开撤销 */
function tickPlates(world: World): void {
  const stood = new Set<string>();
  const check = (ex: number, ey: number, ez: number): void => {
    const bx = Math.floor(ex);
    const by = Math.floor(ey);
    const bz = Math.floor(ez);
    if (isPressurePlateId(world.getBlock(bx, by, bz))) stood.add(key(bx, by, bz));
  };
  check(playerPosition.x, playerPosition.y, playerPosition.z);
  for (const m of mobs) check(m.x, m.y, m.z);
  for (const k of stood) {
    if (activePlates.has(k)) continue;
    activePlates.add(k);
    sources.add(k);
    const [x, y, z] = k.split(',').map(Number);
    recompute(world, x, y, z);
  }
  for (const k of [...activePlates]) {
    if (stood.has(k)) continue;
    activePlates.delete(k);
    const [x, y, z] = k.split(',').map(Number);
    removeSource(x, y, z, k);
    recompute(world, x, y, z);
  }
}

// ——— 侦测器：检测面朝方向方块状态变化，背面输出 ~0.1s 脉冲（MC） ———

/** 已登记的侦测器：位置键 → 面朝格上次记录的方块 id（tick 比对变化触发脉冲） */
const observers = new Map<string, BlockId>();

/** 朝向取反（n↔s e↔w u↔d）：侦测器输出在检测面的背面 */
const OPPOSITE_FACING = [2, 3, 0, 1, 5, 4] as const;

/** 每 tick：比对各侦测器面朝格方块 id，变化则从背面发 0.1s 定向脉冲 */
function tickObservers(world: World): void {
  for (const [k, prev] of [...observers]) {
    const [x, y, z] = k.split(',').map(Number);
    const id = world.getBlock(x, y, z);
    if (!isObserverId(id)) {
      observers.delete(k); // 兜底：被挖/推走（正常由 notifyRedstone 清理）
      continue;
    }
    const f = BLOCKS[id].facing ?? 0;
    const [dx, dy, dz] = FACING_VEC[f];
    const cur = world.getBlock(x + dx, y + dy, z + dz);
    if (cur === prev) continue;
    observers.set(k, cur);
    sources.add(k);
    dirSources.set(k, OPPOSITE_FACING[f] ?? 2);
    const existing = pendingPulses.find((p) => p.key === k && p.kind === 'observer');
    if (existing) existing.at = simTime + 0.1;
    else pendingPulses.push({ key: k, at: simTime + 0.1, kind: 'observer' });
    recompute(world, x, y, z);
  }
}

/** 音符盒：各位置的调音（半音 0-23）与充能态（上升沿发声） */
const notePitches = new Map<string, number>();
const noteStates = new Map<string, boolean>();

/** 世界 tick 调用：结算重播 / 压力板检测 / 侦测器比对 / 脉冲到期 / 中继器延迟翻转（去抖——MC 特性） */
export function tickRedstone(world: World, dt: number): void {
  simTime += dt;
  if (pendingRecompute) {
    const [cx, cy, cz] = pendingRecompute;
    pendingRecompute = null;
    recompute(world, cx, cy, cz);
  }
  tickPlates(world);
  tickObservers(world);
  if (pendingPulses.length > 0) {
    const due = pendingPulses.filter((p) => p.at <= simTime);
    for (let i = pendingPulses.length - 1; i >= 0; i--) {
      if (pendingPulses[i].at <= simTime) pendingPulses.splice(i, 1);
    }
    for (const p of due) {
      const [x, y, z] = p.key.split(',').map(Number);
      if (p.kind === 'button') {
        // 按钮回弹（可能已被挖掉/读档后方块不在）
        const id = world.getBlock(x, y, z);
        if (isButtonOnId(id)) world.setBlock(x, y, z, BLOCK_BY_KEY[blockKeyOf(id).replace(/_on$/, '')].id);
      } else {
        // 侦测器/标靶脉冲到期：撤临时电源
        removeSource(x, y, z, p.key);
        recompute(world, x, y, z);
      }
    }
  }
  if (pendingFlips.length === 0) return;
  const due = pendingFlips.filter((f) => f.at <= simTime);
  for (let i = pendingFlips.length - 1; i >= 0; i--) {
    if (pendingFlips[i].at <= simTime) pendingFlips.splice(i, 1);
  }
  for (const f of due) {
    const [x, y, z] = f.key.split(',').map(Number);
    const id = world.getBlock(x, y, z);
    if (!isRepeaterIdInternal(id)) continue;
    const facing = BLOCKS[id].facing ?? 0;
    const [dx, dy, dz] = FACING_VEC[facing];
    const backKey = key(x - dx, y - dy, z - dz);
    const inputOn = sources.has(backKey) || weak.has(backKey) || (power.get(backKey) ?? 0) > 0;
    if (inputOn === isRepeaterOnId(id)) continue; // 去抖：输入已回一致
    const suf = ['n', 'e', 's', 'w'][facing];
    world.setBlock(x, y, z, BLOCK_BY_KEY[`repeater_${inputOn ? 'on_' : ''}${suf}`].id);
  }
}
