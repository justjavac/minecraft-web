// 方块注册表：id、名称、atlas 贴图、物理属性、音效
// 覆盖主世界全立方体方块（石头/深板岩/矿石/16 色羊毛混凝土陶瓦玻璃/8 种木材/海洋冰雪/功能块）；
// 台阶/楼梯/门/栅栏/植物等非立方体需要形状网格系统，不在此列

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

export const ATLAS_COLS = 8;
/** 默认贴图单格分辨率（内置 Faithful 32x） */
export const TILE_PX = 32;
/** canvas 绘制图标（工作台/熔炉/装备/食物）的 atlas 起始格号；pack 贴图格数须小于它 */
export const ICON_TILE_START = 400;
/** canvas 图标格数量 */
export const ICON_TILE_COUNT = 16;
/** atlas 总行数（pack 格 + 图标格） */
export const ATLAS_ROWS = Math.ceil((ICON_TILE_START + ICON_TILE_COUNT) / ATLAS_COLS);

// ——— 贴图格注册：stem 即 pack 文件名（scripts/build-pack.ts 据此从贴图包提取为 pack/<格号>.png）———
const tileStems: string[] = [];
const tileIndex = new Map<string, number>();

/** 注册贴图格（重复 stem 共享一格），返回 atlas 格号 */
function t(stem: string): number {
  let i = tileIndex.get(stem);
  if (i === undefined) {
    i = tileStems.length;
    tileStems.push(stem);
    tileIndex.set(stem, i);
  }
  if (i >= ICON_TILE_START) throw new Error(`贴图格超出预留上限 ${ICON_TILE_START}`);
  return i;
}

/** 按 interning 顺序的全部贴图 stem（索引 = atlas 格号） */
export const TILE_STEMS = tileStems;
/** 运行时按 stem 查 atlas 格号（未注册返回 0） */
export function tileOf(stem: string): number {
  return tileIndex.get(stem) ?? 0;
}

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

/** 选块界面分类 */
export type BlockCat = 'stone' | 'earth' | 'ore' | 'wood' | 'color' | 'ocean' | 'utility';

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
  /** 挖掘加速工具（木 2x / 石 4x） */
  tool?: 'pickaxe' | 'axe' | 'shovel';
  /** MC：不用镐挖掘没有任何掉落（石头系/矿石/金属块） */
  needsPick?: boolean;
  /** 生存模式不可破坏（基岩/强化深板岩） */
  unbreakable?: boolean;
  /** 挖掘音效 */
  digSound: SoundGroup | null;
  /** 放置音效 */
  placeSound: SoundGroup;
  /** 在其上行走的脚步音效 */
  stepSound: SoundGroup | null;
  /** 长按挖掘时长（秒） */
  digTime: number;
  /** 流体（水/流水）：可游泳、不可选中、参与水渲染 */
  fluid?: boolean;
  cat: BlockCat;
}

// ——— 音效预设 ———
const STONE_SND = { digSound: 'dig_cracky', placeSound: 'place_hard', stepSound: 'step_hard' } as const;
const WOOD_SND = { digSound: 'dig_choppy', placeSound: 'place_hard', stepSound: 'step_wood' } as const;
const DIRT_SND = { digSound: 'dig_dirt', placeSound: 'place', stepSound: 'step_dirt' } as const;
const SAND_SND = { digSound: 'dig_dirt', placeSound: 'place', stepSound: 'step_sand' } as const;
const GRASS_SND = { digSound: 'dig_dirt', placeSound: 'place', stepSound: 'step_grass' } as const;
const GLASS_SND = { digSound: 'dig_glass', placeSound: 'place_hard', stepSound: 'step_hard' } as const;
const LEAVES_SND = { digSound: 'dig_leaves', placeSound: 'place', stepSound: 'step_grass' } as const;

type Tex = string | { top?: string; side?: string; bottom?: string };

/** 注册方块（id 按注册顺序自增，接续 0-13 的传统 id） */
const defs: BlockDef[] = [];
function add(key: string, name: string, tex: Tex, o: Partial<BlockDef> & { cat: BlockCat }): BlockDef {
  const face = typeof tex === 'string' ? { side: tex } : tex;
  const side = face.side ?? face.top;
  if (!side) throw new Error(`方块 ${key} 缺少 side 贴图`);
  const d: BlockDef = {
    id: defs.length,
    key,
    name,
    top: t(face.top ?? side),
    side: t(side),
    bottom: t(face.bottom ?? face.top ?? side),
    opaque: true,
    solid: true,
    digTime: 7.5,
    ...STONE_SND,
    ...o,
  };
  defs.push(d);
  return d;
}

// ——— 传统 0-13（id 固定，存档/代码引用）———
add('air', '空气', 'stone', {
  cat: 'utility', top: -1, bottom: -1, side: -1,
  opaque: false, solid: false, digSound: null, placeSound: 'place', stepSound: null, digTime: 0,
});
// 注：air 的占位贴图注册了一格 'stone'（与石头共享，无害）
defs[GRASS] = {
  id: GRASS, key: 'grass', name: '草方块',
  top: t('grass_block_top'), bottom: t('dirt'), side: t('grass_block_side'),
  opaque: true, solid: true, tool: 'shovel', digTime: 0.9, cat: 'earth', ...GRASS_SND,
};
add('dirt', '泥土', 'dirt', { cat: 'earth', tool: 'shovel', digTime: 0.75, ...DIRT_SND });
add('stone', '石头', 'stone', { cat: 'stone', tool: 'pickaxe', needsPick: true });
add('cobble', '圆石', 'cobblestone', { cat: 'stone', tool: 'pickaxe', needsPick: true, digTime: 10 });
add('sand', '沙子', 'sand', { cat: 'earth', tool: 'shovel', digTime: 0.75, ...SAND_SND });
defs[LOG] = {
  id: LOG, key: 'log', name: '橡木原木',
  top: t('oak_log_top'), bottom: t('oak_log_top'), side: t('oak_log'),
  opaque: true, solid: true, tool: 'axe', digTime: 3, cat: 'wood', ...WOOD_SND,
};
add('planks', '橡木木板', 'oak_planks', { cat: 'wood', tool: 'axe', digTime: 3, ...WOOD_SND });
defs[LEAVES] = {
  id: LEAVES, key: 'leaves', name: '橡树树叶',
  top: t('oak_leaves'), bottom: t('oak_leaves'), side: t('oak_leaves'),
  opaque: false, solid: true, digTime: 0.35, cat: 'wood', ...LEAVES_SND,
};
defs[GLASS] = {
  id: GLASS, key: 'glass', name: '玻璃',
  top: t('glass'), bottom: t('glass'), side: t('glass'),
  opaque: false, solid: true, digTime: 0.45, cat: 'color', ...GLASS_SND,
};
add('brick', '砖块', 'bricks', { cat: 'stone', tool: 'pickaxe', needsPick: true, digTime: 10 });
defs[WATER] = {
  id: WATER, key: 'water', name: '水',
  top: t('water_still'), bottom: t('water_still'), side: t('water_still'),
  opaque: false, solid: false, digSound: null, placeSound: 'place', stepSound: null, digTime: 0, cat: 'ocean', fluid: true,
};
// 流水 1-7 级（level 越小越满，7 为最浅；渲染高度见 mesher 的 WATER_TOP）
export const WATER_FLOW_1 = 14;
for (let lv = 1; lv <= 7; lv++) {
  defs.push({
    id: defs.length, key: `water_flow_${lv}`, name: '流水',
    top: tileOf('water_still'), bottom: tileOf('water_still'), side: tileOf('water_still'),
    opaque: false, solid: false, digSound: null, placeSound: 'place', stepSound: null, digTime: 0, cat: 'ocean', fluid: true,
  });
}
defs[CRAFTING_TABLE] = {
  id: CRAFTING_TABLE, key: 'crafting_table', name: '工作台',
  top: ICON_TILE_START + 0, bottom: tileOf('oak_planks'), side: ICON_TILE_START + 1,
  opaque: true, solid: true, tool: 'axe', digTime: 3, cat: 'utility', ...WOOD_SND,
};
defs[FURNACE] = {
  id: FURNACE, key: 'furnace', name: '熔炉',
  top: tileOf('cobblestone'), bottom: tileOf('cobblestone'), side: ICON_TILE_START + 2,
  opaque: true, solid: true, tool: 'pickaxe', needsPick: true, digTime: 17.5, cat: 'utility', ...STONE_SND,
};

// ——— 石头/深板岩 ———
add('granite', '花岗岩', 'granite', { cat: 'stone', tool: 'pickaxe', needsPick: true });
add('polished_granite', '磨制花岗岩', 'polished_granite', { cat: 'stone', tool: 'pickaxe', needsPick: true });
add('diorite', '闪长岩', 'diorite', { cat: 'stone', tool: 'pickaxe', needsPick: true });
add('polished_diorite', '磨制闪长岩', 'polished_diorite', { cat: 'stone', tool: 'pickaxe', needsPick: true });
add('andesite', '安山岩', 'andesite', { cat: 'stone', tool: 'pickaxe', needsPick: true });
add('polished_andesite', '磨制安山岩', 'polished_andesite', { cat: 'stone', tool: 'pickaxe', needsPick: true });
add('stone_bricks', '石砖', 'stone_bricks', { cat: 'stone', tool: 'pickaxe', needsPick: true, digTime: 10 });
add('mossy_stone_bricks', '苔石砖', 'mossy_stone_bricks', { cat: 'stone', tool: 'pickaxe', needsPick: true, digTime: 10 });
add('cracked_stone_bricks', '裂纹石砖', 'cracked_stone_bricks', { cat: 'stone', tool: 'pickaxe', needsPick: true, digTime: 10 });
add('chiseled_stone_bricks', '雕纹石砖', 'chiseled_stone_bricks', { cat: 'stone', tool: 'pickaxe', needsPick: true, digTime: 10 });
add('smooth_stone', '平滑石头', 'smooth_stone', { cat: 'stone', tool: 'pickaxe', needsPick: true });
add('mossy_cobblestone', '苔石', 'mossy_cobblestone', { cat: 'stone', tool: 'pickaxe', needsPick: true, digTime: 10 });
add('tuff', '凝灰岩', 'tuff', { cat: 'stone', tool: 'pickaxe', needsPick: true });
add('calcite', '方解石', 'calcite', { cat: 'stone', tool: 'pickaxe', needsPick: true, digTime: 4 });
add('dripstone_block', '滴水石块', 'dripstone_block', { cat: 'stone', tool: 'pickaxe', needsPick: true });
add('deepslate', '深板岩', 'deepslate', { cat: 'stone', tool: 'pickaxe', needsPick: true, digTime: 15 });
add('cobbled_deepslate', '深板岩圆石', 'cobbled_deepslate', { cat: 'stone', tool: 'pickaxe', needsPick: true, digTime: 17.5 });
add('polished_deepslate', '磨制深板岩', 'polished_deepslate', { cat: 'stone', tool: 'pickaxe', needsPick: true, digTime: 15 });
add('deepslate_bricks', '深板岩砖', 'deepslate_bricks', { cat: 'stone', tool: 'pickaxe', needsPick: true, digTime: 15 });
add('cracked_deepslate_bricks', '裂纹深板岩砖', 'cracked_deepslate_bricks', { cat: 'stone', tool: 'pickaxe', needsPick: true, digTime: 15 });
add('deepslate_tiles', '深板岩瓦', 'deepslate_tiles', { cat: 'stone', tool: 'pickaxe', needsPick: true, digTime: 15 });
add('cracked_deepslate_tiles', '裂纹深板岩瓦', 'cracked_deepslate_tiles', { cat: 'stone', tool: 'pickaxe', needsPick: true, digTime: 15 });
add('chiseled_deepslate', '雕纹深板岩', 'chiseled_deepslate', { cat: 'stone', tool: 'pickaxe', needsPick: true, digTime: 15 });
add('reinforced_deepslate', '强化深板岩', { side: 'reinforced_deepslate_side', top: 'reinforced_deepslate_top', bottom: 'reinforced_deepslate_bottom' }, { cat: 'stone', unbreakable: true, digTime: 1 });
add('bedrock', '基岩', 'bedrock', { cat: 'stone', unbreakable: true, digTime: 1 });
add('obsidian', '黑曜石', 'obsidian', { cat: 'stone', tool: 'pickaxe', needsPick: true, digTime: 250 });
add('crying_obsidian', '哭泣的黑曜石', 'crying_obsidian', { cat: 'stone', tool: 'pickaxe', needsPick: true, digTime: 250 });

// ——— 土/泥/沙 ———
add('coarse_dirt', '砂土', 'coarse_dirt', { cat: 'earth', tool: 'shovel', digTime: 0.75, ...DIRT_SND });
add('podzol', '灰化土', { side: 'podzol_side', top: 'podzol_top', bottom: 'dirt' }, { cat: 'earth', tool: 'shovel', digTime: 0.75, ...DIRT_SND });
add('mycelium', '菌丝体', { side: 'mycelium_side', top: 'mycelium_top', bottom: 'dirt' }, { cat: 'earth', tool: 'shovel', digTime: 0.75, ...GRASS_SND });
add('snowy_grass', '覆雪草方块', { side: 'grass_block_snow', top: 'snow', bottom: 'dirt' }, { cat: 'earth', tool: 'shovel', digTime: 0.9, ...GRASS_SND });
add('rooted_dirt', '缠根泥土', 'rooted_dirt', { cat: 'earth', tool: 'shovel', digTime: 0.75, ...DIRT_SND });
add('mud', '泥巴', 'mud', { cat: 'earth', tool: 'shovel', digTime: 0.75, ...DIRT_SND });
add('packed_mud', '夯泥', 'packed_mud', { cat: 'earth', tool: 'pickaxe', needsPick: true, digTime: 5 });
add('mud_bricks', '泥砖', 'mud_bricks', { cat: 'earth', tool: 'pickaxe', needsPick: true });
add('moss_block', '苔藓块', 'moss_block', { cat: 'earth', digTime: 0.2, ...GRASS_SND });
add('red_sand', '红沙', 'red_sand', { cat: 'earth', tool: 'shovel', digTime: 0.75, ...SAND_SND });
add('sandstone', '砂岩', 'sandstone', { cat: 'stone', tool: 'pickaxe', needsPick: true, digTime: 4 });
add('chiseled_sandstone', '雕纹砂岩', 'chiseled_sandstone', { cat: 'stone', tool: 'pickaxe', needsPick: true, digTime: 4 });
add('cut_sandstone', '切制砂岩', 'cut_sandstone', { cat: 'stone', tool: 'pickaxe', needsPick: true, digTime: 4 });
add('smooth_sandstone', '平滑砂岩', 'sandstone_top', { cat: 'stone', tool: 'pickaxe', needsPick: true, digTime: 4 });
add('red_sandstone', '红砂岩', 'red_sandstone', { cat: 'stone', tool: 'pickaxe', needsPick: true, digTime: 4 });
add('chiseled_red_sandstone', '雕纹红砂岩', 'chiseled_red_sandstone', { cat: 'stone', tool: 'pickaxe', needsPick: true, digTime: 4 });
add('cut_red_sandstone', '切制红砂岩', 'cut_red_sandstone', { cat: 'stone', tool: 'pickaxe', needsPick: true, digTime: 4 });
add('smooth_red_sandstone', '平滑红砂岩', 'red_sandstone_top', { cat: 'stone', tool: 'pickaxe', needsPick: true, digTime: 4 });
add('gravel', '沙砾', 'gravel', { cat: 'earth', tool: 'shovel', digTime: 0.9, ...DIRT_SND });
add('clay', '黏土块', 'clay', { cat: 'earth', tool: 'shovel', digTime: 0.9, ...DIRT_SND });
add('terracotta', '陶瓦', 'terracotta', { cat: 'color', tool: 'pickaxe', needsPick: true, digTime: 6 });

// ——— 16 色家族 ———
const COLORS16 = [
  ['white', '白色'], ['orange', '橙色'], ['magenta', '品红色'], ['light_blue', '淡蓝色'],
  ['yellow', '黄色'], ['lime', '黄绿色'], ['pink', '粉红色'], ['gray', '灰色'],
  ['light_gray', '淡灰色'], ['cyan', '青色'], ['purple', '紫色'], ['blue', '蓝色'],
  ['brown', '棕色'], ['green', '绿色'], ['red', '红色'], ['black', '黑色'],
] as const;
for (const [c, cn] of COLORS16) {
  add(`${c}_terracotta`, `${cn}陶瓦`, `${c}_terracotta`, { cat: 'color', tool: 'pickaxe', needsPick: true, digTime: 6 });
  add(`${c}_wool`, `${cn}羊毛`, `${c}_wool`, { cat: 'color', digTime: 1.2, ...GRASS_SND });
  add(`${c}_concrete`, `${cn}混凝土`, `${c}_concrete`, { cat: 'color', tool: 'pickaxe', needsPick: true, digTime: 9 });
  add(`${c}_concrete_powder`, `${cn}混凝土粉末`, `${c}_concrete_powder`, { cat: 'color', tool: 'shovel', digTime: 0.75, ...SAND_SND });
  add(`${c}_stained_glass`, `${cn}染色玻璃`, `${c}_stained_glass`, { cat: 'color', opaque: false, digTime: 0.45, ...GLASS_SND });
}

// ——— 矿石/金属块/紫水晶 ———
const ORES = [
  ['coal_ore', '煤矿石'], ['iron_ore', '铁矿石'], ['copper_ore', '铜矿石'], ['gold_ore', '金矿石'],
  ['redstone_ore', '红石矿石'], ['lapis_ore', '青金石矿石'], ['diamond_ore', '钻石矿石'], ['emerald_ore', '绿宝石矿石'],
] as const;
for (const [k, cn] of ORES) {
  add(k, cn, k, { cat: 'ore', tool: 'pickaxe', needsPick: true, digTime: 15 });
}
for (const [k, cn] of ORES) {
  const dk = `deepslate_${k}`;
  add(dk, `深层${cn}`, dk, { cat: 'ore', tool: 'pickaxe', needsPick: true, digTime: 22.5 });
}
add('raw_iron_block', '粗铁块', 'raw_iron_block', { cat: 'ore', tool: 'pickaxe', needsPick: true, digTime: 25 });
add('raw_gold_block', '粗金块', 'raw_gold_block', { cat: 'ore', tool: 'pickaxe', needsPick: true, digTime: 25 });
add('raw_copper_block', '粗铜块', 'raw_copper_block', { cat: 'ore', tool: 'pickaxe', needsPick: true, digTime: 25 });
add('iron_block', '铁块', 'iron_block', { cat: 'ore', tool: 'pickaxe', needsPick: true, digTime: 25 });
add('gold_block', '金块', 'gold_block', { cat: 'ore', tool: 'pickaxe', needsPick: true, digTime: 25 });
add('diamond_block', '钻石块', 'diamond_block', { cat: 'ore', tool: 'pickaxe', needsPick: true, digTime: 25 });
add('emerald_block', '绿宝石块', 'emerald_block', { cat: 'ore', tool: 'pickaxe', needsPick: true, digTime: 25 });
add('lapis_block', '青金石块', 'lapis_block', { cat: 'ore', tool: 'pickaxe', needsPick: true, digTime: 25 });
add('redstone_block', '红石块', 'redstone_block', { cat: 'ore', tool: 'pickaxe', needsPick: true, digTime: 25 });
add('coal_block', '煤块', 'coal_block', { cat: 'ore', tool: 'pickaxe', needsPick: true, digTime: 25 });
add('copper_block', '铜块', 'copper_block', { cat: 'ore', tool: 'pickaxe', needsPick: true, digTime: 25 });
add('amethyst_block', '紫水晶块', 'amethyst_block', { cat: 'ore', tool: 'pickaxe', needsPick: true, digTime: 7.5 });
add('budding_amethyst', '紫水晶母岩', 'budding_amethyst', { cat: 'ore', tool: 'pickaxe', needsPick: true, digTime: 7.5 });

// ——— 木材（橡木沿用 LOG/PLANKS/LEAVES 传统 id）———
const WOODS = [
  ['spruce', '云杉'], ['birch', '白桦'], ['jungle', '丛林'], ['acacia', '金合欢'],
  ['dark_oak', '深色橡木'], ['mangrove', '红树'], ['cherry', '樱花'],
] as const;
add('oak_wood', '橡木木头', 'oak_log', { cat: 'wood', tool: 'axe', digTime: 3, ...WOOD_SND });
add('stripped_oak_log', '去皮橡木原木', { side: 'stripped_oak_log', top: 'stripped_oak_log_top' }, { cat: 'wood', tool: 'axe', digTime: 3, ...WOOD_SND });
add('stripped_oak_wood', '去皮橡木木头', 'stripped_oak_log', { cat: 'wood', tool: 'axe', digTime: 3, ...WOOD_SND });
for (const [w, cn] of WOODS) {
  add(`${w}_log`, `${cn}原木`, { side: `${w}_log`, top: `${w}_log_top` }, { cat: 'wood', tool: 'axe', digTime: 3, ...WOOD_SND });
  add(`stripped_${w}_log`, `去皮${cn}原木`, { side: `stripped_${w}_log`, top: `stripped_${w}_log_top` }, { cat: 'wood', tool: 'axe', digTime: 3, ...WOOD_SND });
  add(`${w}_wood`, `${cn}木头`, `${w}_log`, { cat: 'wood', tool: 'axe', digTime: 3, ...WOOD_SND });
  add(`stripped_${w}_wood`, `去皮${cn}木头`, `stripped_${w}_log`, { cat: 'wood', tool: 'axe', digTime: 3, ...WOOD_SND });
  add(`${w}_planks`, `${cn}木板`, `${w}_planks`, { cat: 'wood', tool: 'axe', digTime: 3, ...WOOD_SND });
  add(`${w}_leaves`, `${cn}树叶`, `${w}_leaves`, { cat: 'wood', opaque: false, digTime: 0.35, ...LEAVES_SND });
}

// ——— 海洋/冰雪 ———
add('prismarine', '海晶石', 'prismarine', { cat: 'ocean', tool: 'pickaxe', needsPick: true });
add('prismarine_bricks', '海晶石砖', 'prismarine_bricks', { cat: 'ocean', tool: 'pickaxe', needsPick: true });
add('dark_prismarine', '暗海晶石', 'dark_prismarine', { cat: 'ocean', tool: 'pickaxe', needsPick: true });
add('sea_lantern', '海晶灯', 'sea_lantern', { cat: 'ocean', digTime: 0.45, ...GLASS_SND });
add('sponge', '海绵', 'sponge', { cat: 'ocean', digTime: 0.9, ...GRASS_SND });
add('wet_sponge', '湿海绵', 'wet_sponge', { cat: 'ocean', digTime: 0.9, ...GRASS_SND });
add('tube_coral_block', '管珊瑚块', 'tube_coral_block', { cat: 'ocean', tool: 'pickaxe', needsPick: true });
add('brain_coral_block', '脑纹珊瑚块', 'brain_coral_block', { cat: 'ocean', tool: 'pickaxe', needsPick: true });
add('bubble_coral_block', '气泡珊瑚块', 'bubble_coral_block', { cat: 'ocean', tool: 'pickaxe', needsPick: true });
add('fire_coral_block', '火珊瑚块', 'fire_coral_block', { cat: 'ocean', tool: 'pickaxe', needsPick: true });
add('horn_coral_block', '鹿角珊瑚块', 'horn_coral_block', { cat: 'ocean', tool: 'pickaxe', needsPick: true });
add('snow_block', '雪块', 'snow', { cat: 'earth', tool: 'shovel', digTime: 0.75, ...GRASS_SND });
add('ice', '冰', 'ice', { cat: 'earth', tool: 'pickaxe', opaque: false, digTime: 0.75, ...GLASS_SND });
add('packed_ice', '浮冰', 'packed_ice', { cat: 'earth', tool: 'pickaxe', digTime: 0.75 });
add('blue_ice', '蓝冰', 'blue_ice', { cat: 'earth', tool: 'pickaxe', digTime: 14 });

// ——— 功能/杂项 ———
add('bookshelf', '书架', 'bookshelf', { cat: 'utility', tool: 'axe', digTime: 3, ...WOOD_SND });
add('chiseled_bookshelf', '雕纹书架', { side: 'chiseled_bookshelf_empty', top: 'chiseled_bookshelf_top' }, { cat: 'utility', tool: 'axe', digTime: 3, ...WOOD_SND });
add('tnt', 'TNT', { side: 'tnt_side', top: 'tnt_top', bottom: 'tnt_bottom' }, { cat: 'utility', digTime: 0.05, ...GRASS_SND });
add('note_block', '音符盒', 'note_block', { cat: 'utility', tool: 'axe', digTime: 3, ...WOOD_SND });
add('jukebox', '唱片机', { side: 'jukebox_side', top: 'jukebox_top' }, { cat: 'utility', tool: 'axe', digTime: 3, ...WOOD_SND });
add('pumpkin', '南瓜', { side: 'pumpkin_side', top: 'pumpkin_top' }, { cat: 'utility', tool: 'axe', digTime: 1.5, ...WOOD_SND });
add('melon', '西瓜', { side: 'melon_side', top: 'melon_top' }, { cat: 'utility', tool: 'axe', digTime: 1.5, ...WOOD_SND });
add('hay_block', '干草捆', { side: 'hay_block_side', top: 'hay_block_top' }, { cat: 'utility', digTime: 0.75, ...GRASS_SND });
add('dried_kelp_block', '干海带块', { side: 'dried_kelp_side', top: 'dried_kelp_top' }, { cat: 'utility', digTime: 0.75, ...GRASS_SND });
add('honeycomb_block', '蜜脾块', 'honeycomb_block', { cat: 'utility', digTime: 0.9, ...GRASS_SND });
add('slime_block', '黏液块', 'slime_block', { cat: 'utility', opaque: false, digTime: 0.15, ...GRASS_SND });
add('honey_block', '蜂蜜块', { side: 'honey_block_side', top: 'honey_block_top', bottom: 'honey_block_bottom' }, { cat: 'utility', opaque: false, digTime: 0.15, ...GRASS_SND });
add('bone_block', '骨块', { side: 'bone_block_side', top: 'bone_block_top' }, { cat: 'utility', tool: 'pickaxe', needsPick: true, digTime: 10 });
add('barrel', '木桶', { side: 'barrel_side', top: 'barrel_top', bottom: 'barrel_bottom' }, { cat: 'utility', tool: 'axe', digTime: 3, ...WOOD_SND });
add('lodestone', '磁石', { side: 'lodestone_side', top: 'lodestone_top' }, { cat: 'utility', tool: 'pickaxe', needsPick: true, digTime: 17.5 });
add('respawn_anchor', '重生锚', { side: 'respawn_anchor_side0', top: 'respawn_anchor_top_off', bottom: 'respawn_anchor_bottom' }, { cat: 'utility', tool: 'pickaxe', needsPick: true, digTime: 25 });
add('beacon', '信标', 'beacon', { cat: 'utility', opaque: false, digTime: 15, ...GLASS_SND });
add('target', '标靶', { side: 'target_side', top: 'target_top' }, { cat: 'utility', tool: 'shovel', digTime: 0.75, ...GRASS_SND });
add('smithing_table', '锻造台', { side: 'smithing_table_side', top: 'smithing_table_top' }, { cat: 'utility', tool: 'axe', digTime: 3, ...WOOD_SND });
add('fletching_table', '制箭台', { side: 'fletching_table_side', top: 'fletching_table_top' }, { cat: 'utility', tool: 'axe', digTime: 3, ...WOOD_SND });
add('cartography_table', '制图台', { side: 'cartography_table_side1', top: 'cartography_table_top' }, { cat: 'utility', tool: 'axe', digTime: 3, ...WOOD_SND });
add('ochre_froglight', '赭黄蛙明灯', { side: 'ochre_froglight_side', top: 'ochre_froglight_top' }, { cat: 'utility', digTime: 0.45, ...GLASS_SND });
add('verdant_froglight', '青翠蛙明灯', { side: 'verdant_froglight_side', top: 'verdant_froglight_top' }, { cat: 'utility', digTime: 0.45, ...GLASS_SND });
add('pearlescent_froglight', '珠光蛙明灯', { side: 'pearlescent_froglight_side', top: 'pearlescent_froglight_top' }, { cat: 'utility', digTime: 0.45, ...GLASS_SND });
add('sculk', '幽匿块', 'sculk', { cat: 'earth', tool: 'shovel', digTime: 0.3, ...GRASS_SND });
add('sculk_catalyst', '幽匿催发体', { side: 'sculk_catalyst_side', top: 'sculk_catalyst_top' }, { cat: 'earth', tool: 'shovel', digTime: 15, ...GRASS_SND });
add('sculk_sensor', '幽匿感测体', { side: 'sculk_sensor_side', top: 'sculk_sensor_top' }, { cat: 'earth', tool: 'shovel', digTime: 7.5, ...GRASS_SND });
add('sculk_shrieker', '幽匿尖啸体', { side: 'sculk_shrieker_side', top: 'sculk_shrieker_top' }, { cat: 'earth', tool: 'shovel', digTime: 15, ...GRASS_SND });

/** 以方块 id 为下标 */
export const BLOCKS: BlockDef[] = defs;

/** key → 方块（配方/选块等按 key 查找用） */
export const BLOCK_BY_KEY: Record<string, BlockDef> = Object.fromEntries(defs.map((d) => [d.key, d]));

/** 是否水系方块（水源或流水，可游泳/参与水渲染） */
export function isWaterId(id: BlockId): boolean {
  return BLOCKS[id]?.fluid === true;
}

/** 热键栏 9 格（创造模式初始值，可在选块界面更换） */
export const HOTBAR_BLOCKS: BlockId[] = [GRASS, DIRT, STONE, COBBLE, LOG, PLANKS, GLASS, BRICK, CRAFTING_TABLE];
