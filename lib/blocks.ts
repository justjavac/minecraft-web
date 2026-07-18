// 方块注册表：id、名称、atlas 贴图、物理属性、音效

export type BlockId = number;

export const AIR = 0;
export const GRASS = 1;
export const DIRT = 2;
export const STONE = 3;
export const COBBLE = 4;
export const SAND = 5;
export const LOG = 6;
export const PLANKS = 7;
export const LEAVES = 8;
export const GLASS = 9;
export const BRICK = 10;
export const WATER = 11;
export const CRAFTING_TABLE = 12;
export const FURNACE = 13;

/** atlas 布局：8×4 格，单格分辨率随贴图包（默认贴图为 32px Faithful） */
export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 4;
/** 默认贴图的单格分辨率（内置 Faithful 32x） */
export const TILE_PX = 32;

/**
 * 每个 tile 的默认贴图：`public/textures/pack/<n>.png` 的索引；null 表示纯 canvas 绘制。
 * 0-12 为方块贴图；工作台/熔炉借用木板/圆石打底再叠加绘制；其余为图标（全 canvas）。
 */
export const TILE_BASE: (number | null)[] = [
  0, // 0 草顶
  1, // 1 草侧面
  2, // 2 泥土
  3, // 3 石头
  4, // 4 圆石
  5, // 5 沙子
  6, // 6 树干侧面
  7, // 7 树干顶/底
  8, // 8 木板
  9, // 9 树叶
  10, // 10 玻璃
  11, // 11 砖块
  12, // 12 水
  8, // 13 工作台顶（木板底 + canvas 网格线）
  8, // 14 工作台侧（木板底 + canvas 边框）
  4, // 15 熔炉（圆石底 + canvas 炉口）
  null, // 16 皮革（canvas 全绘）
  null, // 17 皮革头盔图标
  null, // 18 皮革胸甲图标
  null, // 19 皮革护腿图标
  null, // 20 皮革靴子图标
  null, // 21 木棍图标
  null, // 22 木炭图标
  null, // 23 生猪排图标
  null, // 24 熟猪排图标
  null, // 25 生牛肉图标
  null, // 26 熟牛肉图标
  null, // 27 生鸡肉图标
  null, // 28 熟鸡肉图标
];

/** 音效组（对应 lib/sound.ts 中的文件组） */
export type SoundGroup =
  | 'dig_cracky'
  | 'dig_choppy'
  | 'dig_glass'
  | 'dig_dirt'
  | 'dig_leaves'
  | 'place'
  | 'place_hard'
  | 'step_grass'
  | 'step_dirt'
  | 'step_sand'
  | 'step_hard'
  | 'step_wood';

export interface BlockDef {
  id: BlockId;
  key: string;
  /** 中文名，显示在 HUD */
  name: string;
  /** atlas tile 索引 */
  top: number;
  bottom: number;
  side: number;
  /** 完全不透明（用于相邻面剔除） */
  opaque: boolean;
  /** 参与碰撞 / 可被射线选中 */
  solid: boolean;
  /** 热键栏图标文件名 */
  icon: string;
  /** 挖掘音效 */
  digSound: SoundGroup | null;
  /** 放置音效 */
  placeSound: SoundGroup;
  /** 在其上行走的脚步音效 */
  stepSound: SoundGroup | null;
  /** 长按挖掘时长（秒） */
  digTime: number;
}

const air: BlockDef = {
  id: AIR, key: 'air', name: '空气',
  top: -1, bottom: -1, side: -1,
  opaque: false, solid: false, icon: '',
  digSound: null, placeSound: 'place', stepSound: null,
  digTime: 0,
};

function cube(
  id: BlockId,
  key: string,
  name: string,
  tile: number,
  icon: string,
  digSound: SoundGroup | null,
  placeSound: SoundGroup,
  stepSound: SoundGroup | null,
  digTime: number,
): BlockDef {
  return { id, key, name, top: tile, bottom: tile, side: tile, opaque: true, solid: true, icon, digSound, placeSound, stepSound, digTime };
}

/** 以方块 id 为下标 */
export const BLOCKS: BlockDef[] = [
  air,
  { id: GRASS, key: 'grass', name: '草方块', top: 0, bottom: 2, side: 1, opaque: true, solid: true, icon: 'default_grass.png', digSound: 'dig_dirt', placeSound: 'place', stepSound: 'step_grass', digTime: 0.9 },
  cube(DIRT, 'dirt', '泥土', 2, 'default_dirt.png', 'dig_dirt', 'place', 'step_dirt', 0.75),
  cube(STONE, 'stone', '石头', 3, 'default_stone.png', 'dig_cracky', 'place_hard', 'step_hard', 7.5),
  cube(COBBLE, 'cobble', '圆石', 4, 'default_cobble.png', 'dig_cracky', 'place_hard', 'step_hard', 10),
  cube(SAND, 'sand', '沙子', 5, 'default_sand.png', 'dig_dirt', 'place', 'step_sand', 0.75),
  { id: LOG, key: 'log', name: '原木', top: 7, bottom: 7, side: 6, opaque: true, solid: true, icon: 'default_tree.png', digSound: 'dig_choppy', placeSound: 'place_hard', stepSound: 'step_wood', digTime: 3 },
  cube(PLANKS, 'planks', '木板', 8, 'default_wood.png', 'dig_choppy', 'place_hard', 'step_wood', 3),
  { id: LEAVES, key: 'leaves', name: '树叶', top: 9, bottom: 9, side: 9, opaque: false, solid: true, icon: 'default_leaves.png', digSound: 'dig_leaves', placeSound: 'place', stepSound: 'step_grass', digTime: 0.35 },
  { id: GLASS, key: 'glass', name: '玻璃', top: 10, bottom: 10, side: 10, opaque: false, solid: true, icon: 'default_glass.png', digSound: 'dig_glass', placeSound: 'place_hard', stepSound: 'step_hard', digTime: 0.45 },
  cube(BRICK, 'brick', '砖块', 11, 'default_brick.png', 'dig_cracky', 'place_hard', 'step_hard', 10),
  { id: WATER, key: 'water', name: '水', top: 12, bottom: 12, side: 12, opaque: false, solid: false, icon: 'default_water.png', digSound: null, placeSound: 'place', stepSound: null, digTime: 0 },
  { id: CRAFTING_TABLE, key: 'crafting_table', name: '工作台', top: 13, bottom: 8, side: 14, opaque: true, solid: true, icon: 'default_wood.png', digSound: 'dig_choppy', placeSound: 'place_hard', stepSound: 'step_wood', digTime: 3 },
  { id: FURNACE, key: 'furnace', name: '熔炉', top: 4, bottom: 4, side: 15, opaque: true, solid: true, icon: 'default_cobble.png', digSound: 'dig_cracky', placeSound: 'place_hard', stepSound: 'step_hard', digTime: 17.5 },
];

/** 热键栏 9 格（创造模式） */
export const HOTBAR_BLOCKS: BlockId[] = [GRASS, DIRT, STONE, SAND, LOG, PLANKS, GLASS, BRICK, CRAFTING_TABLE];
