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
export const ICON_TILE_START = 448;
/** canvas 图标格数量（0-1 工作台、2 熔炉、3-15 装备/食物、16 箱子侧） */
export const ICON_TILE_COUNT = 17;
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
/** 注册一个 atlas 图标格（材料/物品贴图用，stem 支持 'item/xxx' 物品路径） */
export function tileIcon(stem: string): number {
  return t(stem);
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
  /** 挖掘加速工具（木 2x / 石 4x / 铁 6x / 钻 8x） */
  tool?: 'pickaxe' | 'axe' | 'shovel';
  /** MC：不用镐挖掘没有任何掉落（石头系/矿石/金属块） */
  needsPick?: boolean;
  /** 镐的最低层级（0 木 / 1 石 / 2 铁 / 3 钻），低于该层无掉落 */
  pickTier?: 0 | 1 | 2 | 3;
  /** 挖掘掉落的材料（矿石类；需满足 pickTier） */
  drop?: { material: string; count: [number, number] };
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
  /** 岩浆：发光液体，接触掉血（v1 不流动） */
  lava?: boolean;
  /** 发光强度 1-15（0/缺省不发光；火把 14、海晶灯/蛙明灯/信标 15） */
  light?: number;
  /** 形状（默认 cube 全方块）：slab 半高 / stairs 双箱 L 形 / fence 柱+臂 / cross 十字面片 / door 薄面板 / panel 贴墙薄片（藤蔓） */
  shape?: 'slab' | 'stairs' | 'fence' | 'cross' | 'door' | 'panel';
  /** 台阶是否上半（放置/合并用） */
  slabTop?: boolean;
  /** 台阶对应的完整方块 id（两个半砖合并） */
  fullBlock?: BlockId;
  /** 楼梯/藤蔓/活塞朝向（0 北 -z / 1 东 +x / 2 南 +z / 3 西 -x；活塞另有 4 上 / 5 下） */
  facing?: 0 | 1 | 2 | 3 | 4 | 5;
  /** 完整碰撞盒 [minX,minY,minZ,maxX,maxY,maxZ]（默认全格；门的薄面板按朝向） */
  box3?: [number, number, number, number, number, number];
  /** 门半格（上/下） */
  doorHalf?: 'bottom' | 'top';
  /** 门是否处于打开状态 */
  doorOpen?: boolean;
  /** 挖掘掉落的方块 id 覆盖（楼梯各朝向/顶半砖统一掉基础型） */
  dropBlock?: BlockId;
  /** 树苗对应的木材种类（长成该种树；lib/saplings.ts 驱动） */
  treeWood?: string;
  /** 双格高植物的底段（破坏/放置上下联动；顶段用 plantTop 标记） */
  twoHigh?: boolean;
  /** 双格高植物的顶段 */
  plantTop?: boolean;
  /** 悬挂植物：需顶面为不透明方块（洞穴藤蔓等；默认需底面支撑） */
  hang?: boolean;
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
// 流水 1-7 级（id 固定 14-20，须与 WATER_FLOW_1 连续；level 越小越满，7 为最浅；渲染高度见 mesher 的 WATER_TOP）
// 注意：必须用显式下标写入——CRAFTING_TABLE/FURNACE 占用 12/13，defs.push 会撞号
export const WATER_FLOW_1 = 14;
for (let lv = 1; lv <= 7; lv++) {
  defs[WATER_FLOW_1 + lv - 1] = {
    id: WATER_FLOW_1 + lv - 1, key: `water_flow_${lv}`, name: '流水',
    top: tileOf('water_still'), bottom: tileOf('water_still'), side: tileOf('water_still'),
    opaque: false, solid: false, digSound: null, placeSound: 'place', stepSound: null, digTime: 0, cat: 'ocean', fluid: true,
  };
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
// 岩浆：发光液体（v1 不流动，湖/池皆为源头方块）；id 为流水段之后第一个自增 id
export const LAVA = defs.length;
defs.push({
  id: LAVA, key: 'lava', name: '岩浆',
  top: t('lava_still'), bottom: t('lava_still'), side: t('lava_still'),
  opaque: true, solid: false, digSound: null, placeSound: 'place', stepSound: null, digTime: 0, cat: 'ocean', lava: true, light: 15,
});

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
add('obsidian', '黑曜石', 'obsidian', { cat: 'stone', tool: 'pickaxe', pickTier: 3, digTime: 250 });
add('crying_obsidian', '哭泣的黑曜石', 'crying_obsidian', { cat: 'stone', tool: 'pickaxe', pickTier: 3, digTime: 250, light: 10 });

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
// pickTier：0 木镐可挖（煤）、1 需石镐（铁/铜/金/青金石）、2 需铁镐（钻石/绿宝石）、3 需钻镐（黑曜石）
const ORES: [key: string, cn: string, tier: 0 | 1 | 2 | 3, material: string, count: [number, number]][] = [
  ['coal_ore', '煤矿石', 0, 'coal', [1, 1]],
  ['iron_ore', '铁矿石', 1, 'raw_iron', [1, 1]],
  ['copper_ore', '铜矿石', 1, 'raw_copper', [2, 5]],
  ['gold_ore', '金矿石', 1, 'raw_gold', [1, 1]],
  ['lapis_ore', '青金石矿石', 1, 'lapis', [4, 8]],
  ['redstone_ore', '红石矿石', 2, 'redstone', [4, 5]],
  ['diamond_ore', '钻石矿石', 2, 'diamond', [1, 1]],
  ['emerald_ore', '绿宝石矿石', 1, 'emerald', [1, 1]],
];
for (const [k, cn, tier, material, count] of ORES) {
  add(k, cn, k, { cat: 'ore', tool: 'pickaxe', pickTier: tier, drop: { material, count }, digTime: 15 });
}
for (const [k, cn, tier, material, count] of ORES) {
  const dk = `deepslate_${k}`;
  add(dk, `深层${cn}`, dk, { cat: 'ore', tool: 'pickaxe', pickTier: tier, drop: { material, count }, digTime: 22.5 });
}
add('raw_iron_block', '粗铁块', 'raw_iron_block', { cat: 'ore', tool: 'pickaxe', needsPick: true, digTime: 25 });
add('raw_gold_block', '粗金块', 'raw_gold_block', { cat: 'ore', tool: 'pickaxe', needsPick: true, digTime: 25 });
add('raw_copper_block', '粗铜块', 'raw_copper_block', { cat: 'ore', tool: 'pickaxe', needsPick: true, digTime: 25 });
add('iron_block', '铁块', 'iron_block', { cat: 'ore', tool: 'pickaxe', needsPick: true, digTime: 25 });
add('gold_block', '金块', 'gold_block', { cat: 'ore', tool: 'pickaxe', needsPick: true, digTime: 25 });
add('diamond_block', '钻石块', 'diamond_block', { cat: 'ore', tool: 'pickaxe', needsPick: true, digTime: 25 });
add('emerald_block', '绿宝石块', 'emerald_block', { cat: 'ore', tool: 'pickaxe', needsPick: true, digTime: 25 });
add('lapis_block', '青金石块', 'lapis_block', { cat: 'ore', tool: 'pickaxe', needsPick: true, digTime: 25 });
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
add('sea_lantern', '海晶灯', 'sea_lantern', { cat: 'ocean', digTime: 0.45, light: 15, ...GLASS_SND });
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
add('beacon', '信标', 'beacon', { cat: 'utility', opaque: false, digTime: 15, light: 15, ...GLASS_SND });
add('target', '标靶', { side: 'target_side', top: 'target_top' }, { cat: 'utility', tool: 'shovel', digTime: 0.75, ...GRASS_SND });
add('smithing_table', '锻造台', { side: 'smithing_table_side', top: 'smithing_table_top' }, { cat: 'utility', tool: 'axe', digTime: 3, ...WOOD_SND });
add('fletching_table', '制箭台', { side: 'fletching_table_side', top: 'fletching_table_top' }, { cat: 'utility', tool: 'axe', digTime: 3, ...WOOD_SND });
add('cartography_table', '制图台', { side: 'cartography_table_side1', top: 'cartography_table_top' }, { cat: 'utility', tool: 'axe', digTime: 3, ...WOOD_SND });
add('ochre_froglight', '赭黄蛙明灯', { side: 'ochre_froglight_side', top: 'ochre_froglight_top' }, { cat: 'utility', digTime: 0.45, light: 15, ...GLASS_SND });
add('verdant_froglight', '青翠蛙明灯', { side: 'verdant_froglight_side', top: 'verdant_froglight_top' }, { cat: 'utility', digTime: 0.45, light: 15, ...GLASS_SND });
add('pearlescent_froglight', '珠光蛙明灯', { side: 'pearlescent_froglight_side', top: 'pearlescent_froglight_top' }, { cat: 'utility', digTime: 0.45, light: 15, ...GLASS_SND });
add('sculk', '幽匿块', 'sculk', { cat: 'earth', tool: 'shovel', digTime: 0.3, ...GRASS_SND });
add('sculk_catalyst', '幽匿催发体', { side: 'sculk_catalyst_side', top: 'sculk_catalyst_top' }, { cat: 'earth', tool: 'shovel', digTime: 15, ...GRASS_SND });
add('sculk_sensor', '幽匿感测体', { side: 'sculk_sensor_side', top: 'sculk_sensor_top' }, { cat: 'earth', tool: 'shovel', digTime: 7.5, ...GRASS_SND });
add('sculk_shrieker', '幽匿尖啸体', { side: 'sculk_shrieker_side', top: 'sculk_shrieker_top' }, { cat: 'earth', tool: 'shovel', digTime: 15, ...GRASS_SND });

// ——— 台阶（底半/顶半；同类两块合并回完整方块） ———
const SLAB_BASES: [block: string, tex: string, cn: string, digTime: number][] = [
  ['stone', 'stone', '石头', 7.5],
  ['smooth_stone', 'smooth_stone', '平滑石头', 7.5],
  ['cobble', 'cobblestone', '圆石', 10],
  ['stone_bricks', 'stone_bricks', '石砖', 10],
  ['deepslate_bricks', 'deepslate_bricks', '深板岩砖', 15],
  ['brick', 'bricks', '砖块', 10],
  ['sandstone', 'sandstone', '砂岩', 4],
  ['planks', 'oak_planks', '橡木木板', 3],
  ['spruce_planks', 'spruce_planks', '云杉木板', 3],
  ['dark_oak_planks', 'dark_oak_planks', '深色橡木木板', 3],
];
for (const [base, tex, cn, digTime] of SLAB_BASES) {
  const full = defs.find((d) => d.key === base)!.id;
  const tool = base === 'planks' || base.endsWith('_planks') ? ('axe' as const) : ('pickaxe' as const);
  const bottom = add(`${base}_slab`, `${cn}台阶`, tex, {
    cat: 'stone', tool, digTime: digTime / 2, shape: 'slab', box3: [0, 0, 0, 1, 0.5, 1], fullBlock: full, opaque: false,
  });
  add(`${base}_slab_top`, `${cn}台阶（上）`, tex, {
    cat: 'stone', tool, digTime: digTime / 2, shape: 'slab', box3: [0, 0.5, 0, 1, 1, 1], slabTop: true, fullBlock: full, dropBlock: bottom.id, opaque: false,
  });
}

// ——— 楼梯（4 朝向 × 双箱 L 形；各朝向统一掉 0 朝向款） ———
const STAIR_BASES: [block: string, tex: string, cn: string, digTime: number][] = [
  ['cobble', 'cobblestone', '圆石', 10],
  ['stone_bricks', 'stone_bricks', '石砖', 10],
  ['deepslate_bricks', 'deepslate_bricks', '深板岩砖', 15],
  ['brick', 'bricks', '砖块', 10],
  ['planks', 'oak_planks', '橡木木板', 3],
  ['spruce_planks', 'spruce_planks', '云杉木板', 3],
  ['dark_oak_planks', 'dark_oak_planks', '深色橡木木板', 3],
];
const STAIR_DIR = ['', '_e', '_s', '_w'] as const;
for (const [base, tex, cn, digTime] of STAIR_BASES) {
  const tool = base === 'planks' || base.endsWith('_planks') ? ('axe' as const) : ('pickaxe' as const);
  let baseId = 0;
  for (let f = 0; f < 4; f++) {
    const d = add(`${base}_stairs${STAIR_DIR[f]}`, `${cn}楼梯`, tex, {
      cat: 'stone', tool, digTime, shape: 'stairs', facing: f as 0 | 1 | 2 | 3, opaque: false,
    });
    if (f === 0) baseId = d.id;
    else d.dropBlock = baseId;
  }
  // 倒置楼梯（顶半满铺 + 背向底半）：统一掉正立 0 朝向款
  for (let f = 0; f < 4; f++) {
    const d = add(`${base}_stairs_top${STAIR_DIR[f]}`, `${cn}楼梯（倒置）`, tex, {
      cat: 'stone', tool, digTime, shape: 'stairs', facing: f as 0 | 1 | 2 | 3, slabTop: true, opaque: false, dropBlock: baseId,
    });
    void d;
  }
}

// ——— 栅栏（柱 + 邻接臂，高 1.5 不可跳过） ———
for (const [w, cn] of [['oak', '橡木'], ['spruce', '云杉'], ['birch', '白桦'], ['dark_oak', '深色橡木']] as const) {
  add(`${w}_fence`, `${cn}栅栏`, `${w}_planks`, { cat: 'wood', tool: 'axe', digTime: 3, shape: 'fence', box3: [0, 0, 0, 1, 1.5, 1], opaque: false, ...WOOD_SND });
}

// ——— 花草（十字面片，无碰撞，需支撑，徒手即碎） ———
const PLANTS: [key: string, cn: string][] = [
  ['dandelion', '蒲公英'],
  ['poppy', '虞美人'],
  ['blue_orchid', '兰花'],
  ['allium', '绒球葱'],
  ['oxeye_daisy', '滨菊'],
  ['cornflower', '矢车菊'],
  ['red_tulip', '红色郁金香'],
  ['white_tulip', '白色郁金香'],
  ['short_grass', '草丛'],
  ['fern', '蕨'],
];
for (const [k, cn] of PLANTS) {
  add(k, cn, k, { cat: 'earth', shape: 'cross', opaque: false, solid: false, digTime: 0.05, ...GRASS_SND });
}

// ——— 群系标志性植被/方块 ———
// 仙人掌：实体近满格（碰撞收 1/16 边），沙漠生成；挖掉即掉自身
add('cactus', '仙人掌', { side: 'cactus_side', top: 'cactus_top', bottom: 'cactus_bottom' }, {
  cat: 'earth', box3: [0.0625, 0, 0.0625, 0.9375, 0.9375, 0.9375], digTime: 0.6, ...GRASS_SND,
});
// 甘蔗：十字面片，水边生成
add('sugar_cane', '甘蔗', 'sugar_cane', { cat: 'earth', shape: 'cross', opaque: false, solid: false, digTime: 0.05, ...GRASS_SND });
// 睡莲：薄板浮于水面（可站立），沼泽生成
add('lily_pad', '睡莲', 'lily_pad', {
  cat: 'earth', shape: 'slab', box3: [0, 0, 0, 1, 0.09375, 1], opaque: false, digTime: 0.05, ...GRASS_SND,
});
// 枯灌木/小蘑菇：十字面片（恶地沙漠 / 黑森林蘑菇岛）
for (const [k, cn] of [['dead_bush', '枯灌木'], ['red_mushroom', '红色蘑菇'], ['brown_mushroom', '棕色蘑菇']] as const) {
  add(k, cn, k, { cat: 'earth', shape: 'cross', opaque: false, solid: false, digTime: 0.05, ...GRASS_SND });
}
// 巨蘑菇部件（蘑菇岛；伞盖全肤，不做内侧贴图区分）
add('mushroom_stem', '蘑菇柄', 'mushroom_stem', { cat: 'earth', tool: 'axe', digTime: 0.3, ...GRASS_SND });
add('red_mushroom_block', '红色蘑菇方块', 'red_mushroom_block', { cat: 'earth', tool: 'axe', digTime: 0.3, ...GRASS_SND });
add('brown_mushroom_block', '棕色蘑菇方块', 'brown_mushroom_block', { cat: 'earth', tool: 'axe', digTime: 0.3, ...GRASS_SND });

// ——— 双格高植物（底段 twoHigh + 顶段 plantTop，联动破坏；MC 高草丛/大型蕨） ———
const tallGrass = add('tall_grass', '高草丛', 'tall_grass_bottom', { cat: 'earth', shape: 'cross', opaque: false, solid: false, digTime: 0.05, twoHigh: true, ...GRASS_SND });
add('tall_grass_top', '高草丛（上）', 'tall_grass_top', { cat: 'earth', shape: 'cross', opaque: false, solid: false, digTime: 0.05, plantTop: true, dropBlock: tallGrass.id, ...GRASS_SND });
const largeFern = add('large_fern', '大型蕨', 'large_fern_bottom', { cat: 'earth', shape: 'cross', opaque: false, solid: false, digTime: 0.05, twoHigh: true, ...GRASS_SND });
add('large_fern_top', '大型蕨（上）', 'large_fern_top', { cat: 'earth', shape: 'cross', opaque: false, solid: false, digTime: 0.05, plantTop: true, dropBlock: largeFern.id, ...GRASS_SND });

// 竹子：茎段 + 带叶顶段（丛林成丛生长；顶段掉茎段）
const bamboo = add('bamboo', '竹子', 'bamboo_stalk', { cat: 'earth', shape: 'cross', opaque: false, solid: false, digTime: 0.15, ...GRASS_SND });
add('bamboo_top', '竹子（顶）', 'bamboo_large_leaves', { cat: 'earth', shape: 'cross', opaque: false, solid: false, digTime: 0.15, dropBlock: bamboo.id, ...GRASS_SND });

// ——— 藤蔓（panel 薄面片贴附方块侧面，4 朝向，无碰撞；统一掉 n 款） ———
const PANEL_EDGE: [number, number, number, number, number, number][] = [
  [0, 0, 0, 1, 1, 0.0625], // n：北缘
  [0.9375, 0, 0, 1, 1, 1], // e：东缘
  [0, 0, 0.9375, 1, 1, 1], // s：南缘
  [0, 0, 0, 0.0625, 1, 1], // w：西缘
];
let vineBase = 0;
for (let f = 0; f < 4; f++) {
  const d = add(`vine_${(['n', 'e', 's', 'w'] as const)[f]}`, '藤蔓', 'vine', {
    cat: 'earth', shape: 'panel', facing: f as 0 | 1 | 2 | 3, box3: PANEL_EDGE[f], opaque: false, solid: false, digTime: 0.05, ...GRASS_SND,
  });
  if (f === 0) vineBase = d.id;
  else d.dropBlock = vineBase;
}

// ——— 滴水石笋（细柱盒：立地为笋、倒挂为钟乳） ———
const spikeUp = add('pointed_dripstone', '滴水石笋', 'pointed_dripstone_up_tip', {
  cat: 'stone', shape: 'slab', box3: [0.375, 0, 0.375, 0.625, 1, 0.625], opaque: false, solid: false, digTime: 0.3, ...GRASS_SND,
});
add('pointed_dripstone_down', '滴水石笋（倒挂）', 'pointed_dripstone_down_tip', {
  cat: 'stone', shape: 'slab', box3: [0.375, 0, 0.375, 0.625, 1, 0.625], opaque: false, solid: false, digTime: 0.3, dropBlock: spikeUp.id, ...GRASS_SND,
});

// ——— 繁茂洞穴植被：杜鹃花丛（十字）与洞穴藤蔓（悬挂，需顶面支撑） ———
add('azalea', '杜鹃花丛', 'azalea_side', { cat: 'earth', shape: 'cross', opaque: false, solid: false, digTime: 0.05, ...GRASS_SND });
add('flowering_azalea', '盛开的杜鹃花丛', 'flowering_azalea_side', { cat: 'earth', shape: 'cross', opaque: false, solid: false, digTime: 0.05, ...GRASS_SND });
add('cave_vines', '洞穴藤蔓', 'cave_vines', { cat: 'earth', shape: 'cross', opaque: false, solid: false, digTime: 0.05, hang: true, ...GRASS_SND });

// ——— 紫水晶洞/下界残余/覆雪 ———
add('smooth_basalt', '平滑玄武岩', 'smooth_basalt', { cat: 'stone', tool: 'pickaxe', needsPick: true });
add('amethyst_cluster', '紫水晶簇', 'amethyst_cluster', {
  cat: 'ore', shape: 'cross', opaque: false, solid: false, tool: 'pickaxe', digTime: 0.5, light: 5, ...GLASS_SND,
});
add('netherrack', '下界岩', 'netherrack', { cat: 'stone', tool: 'pickaxe', needsPick: true, digTime: 2 });
add('magma_block', '岩浆块', 'magma', { cat: 'stone', tool: 'pickaxe', needsPick: true, digTime: 2.5, light: 3 });
// ——— 下界 ———
// 灵魂沙：7/8 高（走上去略下沉，MC 一致）
add('soul_sand', '灵魂沙', 'soul_sand', {
  cat: 'earth', tool: 'shovel', shape: 'slab', box3: [0, 0, 0, 1, 0.875, 1], opaque: false, digTime: 0.75, ...DIRT_SND,
});
// 荧石：发光 15，挖掉掉荧石粉 2-4（MC）
add('glowstone', '荧石', 'glowstone', { cat: 'utility', digTime: 1.5, light: 15, drop: { material: 'glowstone_dust', count: [2, 4] }, ...GLASS_SND });
add('nether_quartz_ore', '下界石英矿石', 'nether_quartz_ore', { cat: 'ore', tool: 'pickaxe', pickTier: 0, drop: { material: 'quartz', count: [1, 1] }, digTime: 15 });
// ——— 下界群系（诡异/绯红森林、灵魂沙谷、玄武岩三角洲） ———
add('warped_nylium', '诡异菌岩', { side: 'warped_nylium_side', top: 'warped_nylium', bottom: 'netherrack' }, { cat: 'earth', tool: 'pickaxe', needsPick: true, digTime: 2 });
add('crimson_nylium', '绯红菌岩', { side: 'crimson_nylium_side', top: 'crimson_nylium', bottom: 'netherrack' }, { cat: 'earth', tool: 'pickaxe', needsPick: true, digTime: 2 });
add('warped_stem', '诡异菌柄', { side: 'warped_stem', top: 'warped_stem_top' }, { cat: 'wood', tool: 'axe', digTime: 3, ...WOOD_SND });
add('crimson_stem', '绯红菌柄', { side: 'crimson_stem', top: 'crimson_stem_top' }, { cat: 'wood', tool: 'axe', digTime: 3, ...WOOD_SND });
add('warped_wart_block', '诡异疣块', 'warped_wart_block', { cat: 'wood', tool: 'axe', digTime: 1.5, ...GRASS_SND });
add('nether_wart_block', '下界疣块', 'nether_wart_block', { cat: 'wood', tool: 'axe', digTime: 1.5, ...GRASS_SND });
// 菌光体：发光 15（巨型菌类树树冠内照明，MC）
add('shroomlight', '菌光体', 'shroomlight', { cat: 'utility', digTime: 1, light: 15, ...GRASS_SND });
// 玄武岩（柱状节理）与黑石（三角洲主体）
add('basalt', '玄武岩', { side: 'basalt_side', top: 'basalt_top' }, { cat: 'stone', tool: 'pickaxe', needsPick: true });
add('blackstone', '黑石', { side: 'blackstone', top: 'blackstone_top' }, { cat: 'stone', tool: 'pickaxe', needsPick: true });
add('soul_soil', '灵魂土', 'soul_soil', { cat: 'earth', tool: 'shovel', digTime: 0.75, ...DIRT_SND });
// 小菌类与菌索（十字植被）
for (const [k, cn] of [['warped_fungus', '诡异菌'], ['crimson_fungus', '绯红菌'], ['warped_roots', '诡异菌索'], ['crimson_roots', '绯红菌索']] as const) {
  add(k, cn, k, { cat: 'earth', shape: 'cross', opaque: false, solid: false, digTime: 0.05, ...GRASS_SND });
}
// 下界砖块（堡垒主体）；地狱疣：堡垒花园作物（种在灵魂沙上，挖掉掉 1-2 个）
add('nether_bricks', '下界砖块', 'nether_bricks', { cat: 'stone', tool: 'pickaxe', needsPick: true, digTime: 10 });
add('nether_wart', '地狱疣', 'nether_wart_stage2', { cat: 'earth', shape: 'cross', opaque: false, solid: false, digTime: 0.05, drop: { material: 'nether_wart', count: [1, 2] }, ...GRASS_SND });
// 雪层：薄板（1/8 高，无碰撞），寒带地表覆盖
add('snow_layer', '雪层', 'snow', {
  cat: 'earth', shape: 'slab', box3: [0, 0, 0, 1, 0.125, 1], opaque: false, solid: false, tool: 'shovel', digTime: 0.2, ...GRASS_SND,
});

// ——— 红石（供能网络见 lib/redstone.ts） ———
// 红石粉：贴地薄片，连接电源与元件
add('redstone_dust', '红石粉', 'redstone_dust_dot', {
  cat: 'utility', shape: 'slab', box3: [0, 0, 0, 1, 0.0625, 1], opaque: false, solid: false, digTime: 0.05, ...GRASS_SND,
});
// 红石火把：常亮电源（微光 7，MC 一致）
add('redstone_torch', '红石火把', 'redstone_torch', { cat: 'utility', shape: 'cross', opaque: false, solid: false, digTime: 0.05, light: 7, ...GRASS_SND });
// 拉杆：右击切换开/关（开时供能）
const leverOff = add('lever', '拉杆', 'lever', { cat: 'utility', shape: 'cross', opaque: false, solid: false, digTime: 0.05, ...GRASS_SND });
add('lever_on', '拉杆（开）', 'lever', { cat: 'utility', shape: 'cross', opaque: false, solid: false, digTime: 0.05, light: 7, dropBlock: leverOff.id, ...GRASS_SND });
// 红石块：永久电源（可被挖走）
add('redstone_block', '红石块', 'redstone_block', { cat: 'ore', tool: 'pickaxe', needsPick: true, digTime: 25 });
// 红石灯：供能点亮（发光 15），断能熄灭
const lampOff = add('redstone_lamp', '红石灯', 'redstone_lamp', { cat: 'utility', digTime: 0.45, ...GLASS_SND });
add('redstone_lamp_lit', '红石灯（亮）', 'redstone_lamp_on', { cat: 'utility', digTime: 0.45, light: 15, dropBlock: lampOff.id, ...GLASS_SND });

// ——— 红石中继器（lib/redstone.ts：信号再生 + 0.1-0.4s 延迟；facing = 输出方向，统一掉 n 款） ———
const repeaterN = add('repeater_n', '红石中继器', 'repeater', {
  cat: 'utility', shape: 'slab', box3: [0, 0, 0, 1, 0.125, 1], opaque: false, facing: 0, digTime: 0.05, ...GRASS_SND,
});
for (const [suf, f] of [['e', 1], ['s', 2], ['w', 3]] as const) {
  add(`repeater_${suf}`, '红石中继器', 'repeater', {
    cat: 'utility', shape: 'slab', box3: [0, 0, 0, 1, 0.125, 1], opaque: false, facing: f, digTime: 0.05, dropBlock: repeaterN.id, ...GRASS_SND,
  });
}
for (const [suf, f] of [['n', 0], ['e', 1], ['s', 2], ['w', 3]] as const) {
  add(`repeater_on_${suf}`, '红石中继器（开）', 'repeater_on', {
    cat: 'utility', shape: 'slab', box3: [0, 0, 0, 1, 0.125, 1], opaque: false, facing: f, digTime: 0.05, light: 7, dropBlock: repeaterN.id, ...GRASS_SND,
  });
}

// ——— 活塞（红石驱动推块，lib/pistons.ts；6 朝向各 1 id，破坏统一掉 n 款） ———
const pistonN = add('piston_n', '活塞', { side: 'piston_side', top: 'piston_top', bottom: 'piston_bottom' }, { cat: 'utility', facing: 0, digTime: 0.75 });
for (const [suf, f] of [['e', 1], ['s', 2], ['w', 3], ['u', 4], ['d', 5]] as const) {
  add(`piston_${suf}`, '活塞', { side: 'piston_side', top: 'piston_top', bottom: 'piston_bottom' }, { cat: 'utility', facing: f, digTime: 0.75, dropBlock: pistonN.id });
}
const stickyN = add('piston_sticky_n', '粘性活塞', { side: 'piston_side', top: 'piston_top_sticky', bottom: 'piston_bottom' }, { cat: 'utility', facing: 0, digTime: 0.75 });
for (const [suf, f] of [['e', 1], ['s', 2], ['w', 3], ['u', 4], ['d', 5]] as const) {
  add(`piston_sticky_${suf}`, '粘性活塞', { side: 'piston_side', top: 'piston_top_sticky', bottom: 'piston_bottom' }, { cat: 'utility', facing: f, digTime: 0.75, dropBlock: stickyN.id });
}
// 活塞头（推出态的前端块；背向无活塞自动消失，破坏统一掉活塞 n 款不现实——直接不掉落）
add('piston_head', '活塞头', { side: 'piston_side', top: 'piston_top', bottom: 'piston_inner' }, { cat: 'utility', digTime: 0.75 });

// ——— 下界传送门（打火石点燃黑曜石框；lib/portal.ts；面板朝向随门框轴向，不可破坏） ———
const portalNs = add('nether_portal_ns', '下界传送门', 'nether_portal', {
  cat: 'utility', shape: 'panel', facing: 0, box3: [0, 0, 0.4375, 1, 1, 0.5625], opaque: false, solid: false, unbreakable: true, digTime: 1, light: 11, ...GLASS_SND,
});
add('nether_portal_we', '下界传送门', 'nether_portal', {
  cat: 'utility', shape: 'panel', facing: 1, box3: [0.4375, 0, 0, 0.5625, 1, 1], opaque: false, solid: false, unbreakable: true, digTime: 1, light: 11, dropBlock: portalNs.id, ...GLASS_SND,
});
// 树苗（可生长，wood 见 lib/saplings.ts；红树在原版叫"红树胎生苗"）
const SAPLINGS: [key: string, tex: string, cn: string, wood: string][] = [
  ['oak_sapling', 'oak_sapling', '橡树树苗', 'oak'],
  ['spruce_sapling', 'spruce_sapling', '云杉树苗', 'spruce'],
  ['birch_sapling', 'birch_sapling', '白桦树苗', 'birch'],
  ['jungle_sapling', 'jungle_sapling', '丛林树苗', 'jungle'],
  ['acacia_sapling', 'acacia_sapling', '金合欢树苗', 'acacia'],
  ['dark_oak_sapling', 'dark_oak_sapling', '深色橡木树苗', 'dark_oak'],
  ['mangrove_sapling', 'mangrove_propagule', '红树胎生苗', 'mangrove'],
  ['cherry_sapling', 'cherry_sapling', '樱花树苗', 'cherry'],
];
for (const [k, tex, cn, wood] of SAPLINGS) {
  add(k, cn, tex, { cat: 'earth', shape: 'cross', opaque: false, solid: false, digTime: 0.05, treeWood: wood, ...GRASS_SND });
}

// ——— 耕地与小麦作物（耕种见 lib/crops.ts：锄头整地 → 播种 → 8 阶段生长） ———
// 耕地 15/16 高（台阶形网格/碰撞，无 fullBlock 不合并）；4 格内有水变湿润耕地，作物长得更快
add('farmland', '耕地', { top: 'farmland', side: 'dirt', bottom: 'dirt' }, {
  cat: 'earth', tool: 'shovel', digTime: 0.75, shape: 'slab', box3: [0, 0, 0, 1, 0.9375, 1], opaque: false, dropBlock: DIRT, ...DIRT_SND,
});
add('farmland_moist', '湿润耕地', { top: 'farmland_moist', side: 'dirt', bottom: 'dirt' }, {
  cat: 'earth', tool: 'shovel', digTime: 0.75, shape: 'slab', box3: [0, 0, 0, 1, 0.9375, 1], opaque: false, dropBlock: DIRT, ...DIRT_SND,
});
// 小麦 8 阶段（wheat_crop_0..7，十字面片；成熟收割掉小麦+种子，未熟只掉种子）
export const WHEAT_CROP_0 = defs.length;
for (let stage = 0; stage <= 7; stage++) {
  add(`wheat_crop_${stage}`, '小麦', `wheat_stage${stage}`, {
    cat: 'earth', shape: 'cross', opaque: false, solid: false, digTime: 0.05, ...GRASS_SND,
  });
}

// 火把：发光 14（放置需支撑；光照见 lib/lights.ts）
const torchDef = add('torch', '火把', 'torch', { cat: 'utility', shape: 'cross', opaque: false, solid: false, digTime: 0.05, light: 14, ...GRASS_SND });
// 酿造台：右键打开酿造界面（lib/brewing.ts；配方 烈焰棒×1 + 圆石×3）
add('brewing_stand', '酿造台', { side: 'brewing_stand', top: 'brewing_stand_base' }, { cat: 'utility', tool: 'pickaxe', digTime: 1 });
// 附魔台：右键打开附魔界面（lib/xp.ts；3/4 高，MC 造型）
add('enchanting_table', '附魔台', { side: 'enchanting_table_side', top: 'enchanting_table_top', bottom: 'enchanting_table_bottom' }, {
  cat: 'utility', shape: 'slab', box3: [0, 0, 0, 1, 0.75, 1], opaque: false, tool: 'pickaxe', needsPick: true, digTime: 12.5,
});
// 墙上火把（4 朝向，贴墙小十字，统一掉落地火把）
add('torch_wall_n', '火把', 'torch', { cat: 'utility', shape: 'cross', facing: 0, opaque: false, solid: false, digTime: 0.05, light: 14, ...GRASS_SND, dropBlock: torchDef.id });
add('torch_wall_e', '火把', 'torch', { cat: 'utility', shape: 'cross', facing: 1, opaque: false, solid: false, digTime: 0.05, light: 14, ...GRASS_SND, dropBlock: torchDef.id });
add('torch_wall_s', '火把', 'torch', { cat: 'utility', shape: 'cross', facing: 2, opaque: false, solid: false, digTime: 0.05, light: 14, ...GRASS_SND, dropBlock: torchDef.id });
add('torch_wall_w', '火把', 'torch', { cat: 'utility', shape: 'cross', facing: 3, opaque: false, solid: false, digTime: 0.05, light: 14, ...GRASS_SND, dropBlock: torchDef.id });

// 门：闭合时面板贴朝向边，打开时转到垂直边；上下两格同步
const DOOR_EDGE: [number, number, number, number, number, number][] = [
  [0, 0, 0, 1, 1, 0.1875], // n：北缘
  [0.8125, 0, 0, 1, 1, 1], // e：东缘
  [0, 0, 0.8125, 1, 1, 1], // s：南缘
  [0, 0, 0, 0.1875, 1, 1], // w：西缘
];
const DOOR_OPEN_EDGE = [3, 0, 1, 2] as const; // n→w e→n s→e w→s（顺时针转）
const DOOR_DIR = ['n', 'e', 's', 'w'] as const;
const doorBottom = (() => {
  let first = 0;
  for (let f = 0; f < 4; f++) {
    const closed = add(`oak_door_bottom_${DOOR_DIR[f]}`, '橡木门', 'oak_door_bottom', {
      cat: 'wood', tool: 'axe', digTime: 3, shape: 'door', facing: f as 0 | 1 | 2 | 3, doorHalf: 'bottom', doorOpen: false, box3: DOOR_EDGE[f], opaque: false, ...WOOD_SND,
    });
    add(`oak_door_top_${DOOR_DIR[f]}`, '橡木门', 'oak_door_top', {
      cat: 'wood', tool: 'axe', digTime: 3, shape: 'door', facing: f as 0 | 1 | 2 | 3, doorHalf: 'top', doorOpen: false, box3: DOOR_EDGE[f], opaque: false, dropBlock: closed.id, ...WOOD_SND,
    });
    add(`oak_door_open_bottom_${DOOR_DIR[f]}`, '橡木门（开）', 'oak_door_bottom', {
      cat: 'wood', tool: 'axe', digTime: 3, shape: 'door', facing: f as 0 | 1 | 2 | 3, doorHalf: 'bottom', doorOpen: true, box3: DOOR_EDGE[DOOR_OPEN_EDGE[f]], opaque: false, dropBlock: closed.id, ...WOOD_SND,
    });
    add(`oak_door_open_top_${DOOR_DIR[f]}`, '橡木门（开）', 'oak_door_top', {
      cat: 'wood', tool: 'axe', digTime: 3, shape: 'door', facing: f as 0 | 1 | 2 | 3, doorHalf: 'top', doorOpen: true, box3: DOOR_EDGE[DOOR_OPEN_EDGE[f]], opaque: false, dropBlock: closed.id, ...WOOD_SND,
    });
    if (f === 0) first = closed.id;
  }
  return first;
})();
void doorBottom;

// ——— 家具 ———
// 床：半高（复用台阶网格/碰撞），夜晚右键睡觉跳到日出并设重生点（无 fullBlock，不参与台阶合并）
add('red_bed', '红色床', { top: 'red_bed_foot_up', side: 'red_bed_foot_south', bottom: 'oak_planks' }, {
  cat: 'utility', tool: 'axe', digTime: 0.3, shape: 'slab', box3: [0, 0, 0, 1, 0.5, 1], opaque: false, ...WOOD_SND,
});

// ——— 容器（右键打开 27 格存储，lib/storage.ts；barrel 已在上方注册） ———
// 箱子：无现成贴图，侧面用 canvas 图标格（木板底 + 深色包边 + 锁扣），顶/底用木板
defs.push({
  id: defs.length, key: 'chest', name: '箱子',
  top: tileOf('oak_planks'), bottom: tileOf('oak_planks'), side: ICON_TILE_START + 16,
  opaque: true, solid: true, tool: 'axe', digTime: 3, cat: 'utility', ...WOOD_SND,
});

/** 以方块 id 为下标 */
export const BLOCKS: BlockDef[] = defs;

/** key → 方块（配方/选块等按 key 查找用） */
export const BLOCK_BY_KEY: Record<string, BlockDef> = Object.fromEntries(defs.map((d) => [d.key, d]));

/** 是否水系方块（水源或流水，可游泳/参与水渲染） */
export function isWaterId(id: BlockId): boolean {
  return BLOCKS[id]?.fluid === true;
}

/** 是否岩浆（发光液体，接触掉血） */
export function isLavaId(id: BlockId): boolean {
  return BLOCKS[id]?.lava === true;
}

/** 是否柱状植物（仙人掌/甘蔗/竹子）：破坏任一节，上方各节一并掉落 */
export function isColumnPlantId(id: BlockId): boolean {
  const k = BLOCKS[id]?.key;
  return k === 'cactus' || k === 'sugar_cane' || k === 'bamboo' || k === 'bamboo_top';
}

/** 热键栏 9 格（创造模式初始值，可在选块界面更换） */
export const HOTBAR_BLOCKS: BlockId[] = [GRASS, DIRT, STONE, COBBLE, LOG, PLANKS, GLASS, BRICK, CRAFTING_TABLE];
