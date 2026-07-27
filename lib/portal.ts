// 下界传送门：黑曜石框检测（最小内部 2×3）+ 打火石点燃 + 框破坏联动熄灭
// 传送判定见 lib/dimension.ts（站在门内数秒即传送）

import { AIR, BLOCK_BY_KEY, type BlockId } from './blocks';
import type { World } from './world';

const OBSIDIAN = () => BLOCK_BY_KEY.obsidian.id;
const PORTAL_NS = () => BLOCK_BY_KEY.nether_portal_ns.id;
const PORTAL_WE = () => BLOCK_BY_KEY.nether_portal_we.id;

export const isPortalId = (id: BlockId): boolean => id === PORTAL_NS() || id === PORTAL_WE();

interface Frame {
  /** 内部左下角（轴向小端、底行） */
  x: number;
  y: number;
  z: number;
  /** 内部宽（沿轴）与高 */
  w: number;
  h: number;
  /** 门框延展轴（'x' = 门沿 x 展开，面板朝 ±z） */
  axis: 'x' | 'z';
}

const isInterior = (world: World, x: number, y: number, z: number): boolean => {
  const id = world.getBlock(x, y, z);
  return id === AIR || isPortalId(id);
};

/** 以候选内部格 (x,y,z) 沿 axis 找完整黑曜石框（内部 ≥2×3 ≤21，外圈全黑曜石；各向扫描带硬上限防死循环） */
function findFrame(world: World, x: number, y: number, z: number, axis: 'x' | 'z'): Frame | null {
  const at = (ax: number, ay: number, az: number) =>
    axis === 'x' ? world.getBlock(ax, ay, az) : world.getBlock(az, ay, ax);
  const along = axis === 'x' ? x : z;
  const across = axis === 'x' ? z : x;
  const MAX = 25; // 扫描硬上限（MC 门最大 23）
  // 左端：最左内部格，其左必须是黑曜石柱
  let innerLo = along;
  for (let i = 0; i < MAX && isInterior(world, ...xyz(axis, innerLo - 1, y, across)); i++) innerLo--;
  if (at(innerLo - 1, y, across) !== OBSIDIAN()) return null;
  // 右端同理
  let innerHi = along;
  for (let i = 0; i < MAX && isInterior(world, ...xyz(axis, innerHi + 1, y, across)); i++) innerHi++;
  if (at(innerHi + 1, y, across) !== OBSIDIAN()) return null;
  const w = innerHi - innerLo + 1;
  if (w < 2 || w > 21) return null;
  // 底行：内部最低行，其下整行黑曜石
  let by = y;
  for (let i = 0; i < MAX && isInterior(world, ...xyz(axis, innerLo, by - 1, across)); i++) by--;
  for (let a = innerLo; a <= innerHi; a++) {
    if (at(a, by - 1, across) !== OBSIDIAN()) return null;
  }
  // 顶行：第一个非内部行，整行黑曜石；内部高 ≥3
  let top = by + 1;
  for (let i = 0; i < MAX && isInterior(world, ...xyz(axis, innerLo, top, across)); i++) top++;
  const h = top - by;
  if (h < 3 || h > 21) return null;
  for (let a = innerLo; a <= innerHi; a++) {
    if (at(a, top, across) !== OBSIDIAN()) return null;
  }
  // 两侧柱全段黑曜石 + 内部全空（或已是门）
  for (let dy = by; dy < top; dy++) {
    if (at(innerLo - 1, dy, across) !== OBSIDIAN()) return null;
    if (at(innerHi + 1, dy, across) !== OBSIDIAN()) return null;
    for (let a = innerLo; a <= innerHi; a++) {
      if (!isInterior(world, ...xyz(axis, a, dy, across))) return null;
    }
  }
  const [fx, , fz] = xyz(axis, innerLo, by, across);
  return { x: fx, y: by, z: fz, w, h, axis };
}

/** 坐标换算：axis 门内坐标 (along, y, across) → 世界 (x, y, z) */
function xyz(axis: 'x' | 'z', along: number, y: number, across: number): [number, number, number] {
  return axis === 'x' ? [along, y, across] : [across, y, along];
}

/** 打火石点燃：以点击面邻格为候选内部格，两个轴向各试一次；成功则填满门块 */
export function tryIgnitePortal(world: World, x: number, y: number, z: number): boolean {
  for (const axis of ['x', 'z'] as const) {
    const f = findFrame(world, x, y, z, axis);
    if (!f) continue;
    const id = axis === 'x' ? PORTAL_NS() : PORTAL_WE();
    for (let a = 0; a < f.w; a++) {
      for (let dy = 0; dy < f.h; dy++) {
        const [px, py, pz] = xyz(axis, (axis === 'x' ? f.x : f.z) + a, f.y + dy, axis === 'x' ? f.z : f.x);
        world.setBlock(px, py, pz, id);
      }
    }
    return true;
  }
  return false;
}

/** 方块破坏后的门联动：邻接门块若框已不完整，连通门块全部熄灭（actions.breakBlock 调用） */
export function clearBrokenPortals(world: World, x: number, y: number, z: number): void {
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
    const px = x + dx;
    const py = y + dy;
    const pz = z + dz;
    const id = world.getBlock(px, py, pz);
    if (!isPortalId(id)) continue;
    const axis = id === PORTAL_NS() ? 'x' : 'z';
    // 框完整性复验（不完整的门框 → 整片门熄灭）
    if (findFrame(world, px, py, pz, axis)) continue;
    // 洪泛清除连通门块
    const stack: [number, number, number][] = [[px, py, pz]];
    while (stack.length > 0) {
      const [qx, qy, qz] = stack.pop()!;
      if (!isPortalId(world.getBlock(qx, qy, qz))) continue;
      world.setBlock(qx, qy, qz, AIR);
      for (const [ex, ey, ez] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
        if (isPortalId(world.getBlock(qx + ex, qy + ey, qz + ez))) stack.push([qx + ex, qy + ey, qz + ez]);
      }
    }
  }
}
