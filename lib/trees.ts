// 树形库：世界生成（world.ts）与树苗生长（saplings.ts）共用，保证同种木材同形
// 每种树按 MC 观感分化：橡木小冠 / 白桦高直 / 云杉锥塔 / 丛林高干 / 金合欢折干平顶 / 深色橡木 2×2 粗干 / 樱花扇冠

import { BLOCK_BY_KEY, type BlockId } from './blocks';
import type { TreeKind } from './noise';

/**
 * 放块回调（世界坐标）：onlyAir=true 时目标非空气则跳过（树叶不覆盖已有方块）。
 * world.ts 生成时写 chunk 数组（带边界检查）；saplings.ts 生长时走 world.setBlock。
 */
export type PutFn = (x: number, y: number, z: number, id: BlockId, onlyAir: boolean) => void;

/** 树的可选装饰：vines = 树干四周垂下藤蔓（丛林/沼泽观感） */
export interface TreeOpts {
  vines?: boolean;
}

/** 藤蔓贴附方向表：藤格在树干 +z 侧贴北面（vine_n），+x 侧贴西面（vine_w），依此类推 */
const VINE_SIDE: [dx: number, dz: number, key: string][] = [
  [0, 1, 'vine_n'],
  [1, 0, 'vine_w'],
  [0, -1, 'vine_s'],
  [-1, 0, 'vine_e'],
];

/** 树干四面垂藤：从冠底向下 2-5 格（只进空气） */
function addVines(put: PutFn, x: number, z: number, canopyBaseY: number, rand: () => number): void {
  for (const [dx, dz, key] of VINE_SIDE) {
    if (rand() < 0.4) continue;
    const vine = BLOCK_BY_KEY[key].id;
    const len = 2 + Math.floor(rand() * 4);
    for (let i = 0; i < len; i++) put(x + dx, canopyBaseY - i, z + dz, vine, true);
  }
}

/** 各树种从地表（含）算起的最大总高（生成前用它判断世界顶能否放下） */
export const TREE_MAX_H: Record<TreeKind, number> = {
  oak: 6,
  birch: 8,
  spruce: 9,
  jungle: 17,
  acacia: 9,
  dark_oak: 11,
  cherry: 9,
};

const woodParts = (kind: TreeKind): [log: BlockId, leaves: BlockId] => [
  BLOCK_BY_KEY[kind === 'oak' ? 'log' : `${kind}_log`].id,
  BLOCK_BY_KEY[kind === 'oak' ? 'leaves' : `${kind}_leaves`].id,
];

/** 圆盘叶层：r=1 → 3×3，r=2 → 5×5；cutCorners 去四角（更圆） */
function layer(put: PutFn, cx: number, y: number, cz: number, r: number, id: BlockId, cutCorners: boolean): void {
  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) {
      if (cutCorners && Math.abs(dx) === r && Math.abs(dz) === r) continue;
      put(cx + dx, y, cz + dz, id, true);
    }
  }
}

/** 十字叶层（中心 + 四向 1 格） */
function plus(put: PutFn, cx: number, y: number, cz: number, id: BlockId): void {
  put(cx, y, cz, id, true);
  put(cx + 1, y, cz, id, true);
  put(cx - 1, y, cz, id, true);
  put(cx, y, cz + 1, id, true);
  put(cx, y, cz - 1, id, true);
}

/** 在 (x, z) 列、地表高度 h 处长一棵树（树叶只占空气，先干后叶） */
export function writeTree(put: PutFn, kind: TreeKind, x: number, h: number, z: number, rand: () => number, opts?: TreeOpts): void {
  const [log, leaves] = woodParts(kind);
  switch (kind) {
    case 'oak': {
      for (let y = h + 1; y <= h + 4; y++) put(x, y, z, log, false);
      layer(put, x, h + 3, z, 1, leaves, false);
      layer(put, x, h + 4, z, 1, leaves, false);
      put(x, h + 5, z, leaves, true);
      if (opts?.vines) addVines(put, x, z, h + 3, rand);
      return;
    }
    case 'birch': {
      for (let y = h + 1; y <= h + 6; y++) put(x, y, z, log, false);
      layer(put, x, h + 4, z, 1, leaves, false);
      layer(put, x, h + 5, z, 1, leaves, false);
      put(x, h + 6, z, leaves, true);
      return;
    }
    case 'spruce': {
      // 锥形塔：3×3 与十字交替收分，MC 云杉观感
      const H = 7 + Math.floor(rand() * 3); // 7-9
      for (let y = h + 1; y <= h + H; y++) put(x, y, z, log, false);
      for (let dy = 2; dy < H; dy++) {
        if (dy % 2 === 0) layer(put, x, h + dy, z, 1, leaves, true);
        else plus(put, x, h + dy, z, leaves);
      }
      plus(put, x, h + H, z, leaves);
      put(x, h + H + 1, z, leaves, true);
      return;
    }
    case 'jungle': {
      // 高干小冠（10-14），树冠外扩 2 格；丛林树垂藤是 MC 标志
      const H = 10 + Math.floor(rand() * 5);
      for (let y = h + 1; y <= h + H; y++) put(x, y, z, log, false);
      layer(put, x, h + H - 1, z, 2, leaves, true);
      layer(put, x, h + H, z, 1, leaves, false);
      put(x, h + H + 1, z, leaves, true);
      addVines(put, x, z, h + H - 1, rand);
      return;
    }
    case 'acacia': {
      // 折干平顶：先直 2 格，斜走一步再直 3 格，冠层平顶盖在斜干顶
      const step: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      const [sx, sz] = step[Math.floor(rand() * 4)];
      put(x, h + 1, z, log, false);
      put(x, h + 2, z, log, false);
      const tx = x + sx;
      const tz = z + sz;
      for (let y = h + 3; y <= h + 5; y++) put(tx, y, tz, log, false);
      layer(put, tx, h + 6, tz, 2, leaves, true);
      layer(put, tx, h + 7, tz, 1, leaves, true);
      return;
    }
    case 'dark_oak': {
      // 2×2 粗干（6-8），厚冠两层
      const H = 6 + Math.floor(rand() * 3);
      for (let y = h + 1; y <= h + H; y++) {
        for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) put(x + dx, y, z + dz, log, false);
      }
      layer(put, x, h + H - 1, z, 2, leaves, true);
      layer(put, x, h + H, z, 2, leaves, true);
      layer(put, x, h + H + 1, z, 1, leaves, false);
      return;
    }
    case 'cherry': {
      // 扇形粉冠
      const H = 5 + Math.floor(rand() * 2); // 5-6
      for (let y = h + 1; y <= h + H; y++) put(x, y, z, log, false);
      layer(put, x, h + H - 1, z, 2, leaves, false);
      layer(put, x, h + H, z, 2, leaves, true);
      layer(put, x, h + H + 1, z, 1, leaves, false);
      return;
    }
  }
}

/** 巨蘑菇最大高（蘑菇岛/黑森林） */
export const HUGE_MUSHROOM_MAX_H = 9;

/** 巨蘑菇：菌柄 5-7 高 + 伞盖（红外扩 2 双层，棕平顶单层；红/棕按 rand 由调用方定） */
export function writeHugeMushroom(put: PutFn, red: boolean, x: number, h: number, z: number, rand: () => number): void {
  const stem = BLOCK_BY_KEY.mushroom_stem.id;
  const cap = BLOCK_BY_KEY[red ? 'red_mushroom_block' : 'brown_mushroom_block'].id;
  const H = 5 + Math.floor(rand() * 3); // 5-7
  for (let y = h + 1; y <= h + H; y++) put(x, y, z, stem, false);
  if (red) {
    layer(put, x, h + H - 1, z, 2, cap, true);
    layer(put, x, h + H, z, 1, cap, false);
  } else {
    layer(put, x, h + H, z, 2, cap, true);
  }
}
