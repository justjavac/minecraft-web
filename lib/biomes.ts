// 生物群系的表层组成：表方块/填充/水边/水下地表/水面覆盖

import { BLOCK_BY_KEY, type BlockId } from './blocks';
import type { Biome } from './noise';

export interface BiomeSurface {
  /** 地表方块 */
  top: BlockId;
  /** 地表下 3 格填充 */
  filler: BlockId;
  /** 水下地表候选（按列哈希取一，海洋/河流用） */
  underwater: BlockId[];
  /** 水面覆盖（寒带水面为冰） */
  waterTop?: BlockId;
  /** 水边（海平面 ±1 的岸滩，默认用 top） */
  beach?: BlockId;
}

const K = (key: string) => BLOCK_BY_KEY[key].id;

const GRASSY = { top: K('grass'), filler: K('dirt'), underwater: [K('dirt'), K('gravel')] };

export const BIOME_SURFACE: Record<Biome, BiomeSurface> = {
  plains: GRASSY,
  forest: GRASSY,
  birch_forest: GRASSY,
  dark_forest: GRASSY,
  jungle: GRASSY,
  savanna: GRASSY,
  basin: { top: K('grass'), filler: K('dirt'), underwater: [K('dirt'), K('gravel'), K('clay')] },
  taiga: { top: K('grass'), filler: K('dirt'), underwater: [K('dirt'), K('gravel')] },
  snowy: {
    top: K('snowy_grass'),
    filler: K('dirt'),
    underwater: [K('dirt'), K('gravel')],
    waterTop: K('ice'),
  },
  ice_spikes: {
    top: K('snowy_grass'),
    filler: K('dirt'),
    underwater: [K('dirt'), K('gravel')],
    waterTop: K('ice'),
  },
  desert: {
    top: K('sand'),
    filler: K('sand'),
    underwater: [K('sand'), K('sandstone')],
    beach: K('sand'),
  },
  swamp: {
    top: K('grass'),
    filler: K('dirt'),
    underwater: [K('mud'), K('clay'), K('dirt')],
    beach: K('mud'),
  },
  badlands: {
    top: K('red_sand'),
    filler: K('red_sandstone'),
    underwater: [K('red_sand'), K('red_sandstone')],
    beach: K('red_sand'),
  },
  // 山地表层由 world.ts 按雪线分带（草 → 裸岩 → 积雪），此处为兜底
  mountains: { top: K('stone'), filler: K('stone'), underwater: [K('gravel'), K('stone')] },
  mushroom_fields: {
    top: K('mycelium'),
    filler: K('dirt'),
    underwater: [K('clay'), K('dirt'), K('gravel')],
    beach: K('mycelium'),
  },
  river: {
    top: K('sand'),
    filler: K('dirt'),
    underwater: [K('sand'), K('gravel'), K('clay')],
    beach: K('sand'),
  },
  ocean: {
    top: K('gravel'),
    filler: K('gravel'),
    underwater: [K('gravel'), K('sand'), K('dirt'), K('clay')],
    beach: K('sand'),
  },
};

/** 恶地陶瓦分层色带（world.ts 按 y + 列偏移取色，复刻 MC 侵蚀恶地的彩色地层） */
export const BADLANDS_BANDS: BlockId[] = [
  K('red_terracotta'),
  K('terracotta'),
  K('orange_terracotta'),
  K('yellow_terracotta'),
  K('brown_terracotta'),
  K('white_terracotta'),
  K('light_gray_terracotta'),
];

// ——— 群系顶点色适用的方块 key ———
/** 草色倍率：草方块（仅顶面，mesher 按面过滤）与草类十字植物 */
export const GRASS_TINT_KEYS = new Set(['grass', 'short_grass', 'fern', 'tall_grass', 'tall_grass_top', 'large_fern', 'large_fern_top']);
/** 叶色倍率：随群系变的树叶（云杉/白桦/樱花固定色，atlas 已染好不参与） */
export const FOLIAGE_TINT_KEYS = new Set(['leaves', 'jungle_leaves', 'acacia_leaves', 'dark_oak_leaves', 'mangrove_leaves']);
// atlas 拼贴时草/叶灰度图已被平原基色染绿（lib/textures.ts TILE_TINTS），
// 此处给的是「相对平原基色的倍率」：顶点色 × (群系色 / 基色) = 目标群系色。

/** MC 群系草色（hex） */
export const BIOME_TINT_HEX: Record<Biome, number> = {
  plains: 0x91bd59,
  forest: 0x79c05a,
  birch_forest: 0x88bb67,
  dark_forest: 0x507a32,
  taiga: 0x86b783,
  snowy: 0x80b497,
  ice_spikes: 0x80b497,
  desert: 0xbfb755,
  savanna: 0xbfb755,
  jungle: 0x59c93c,
  swamp: 0x6a7039,
  badlands: 0x90814d,
  mountains: 0x8ab689,
  mushroom_fields: 0x55c93f,
  ocean: 0x8eb971,
  river: 0x8eb971,
  basin: 0x91bd59,
};

const BASE_GRASS: readonly [number, number, number] = [0x91 / 255, 0xbd / 255, 0x59 / 255];
const BASE_FOLIAGE: readonly [number, number, number] = [0x77 / 255, 0xab / 255, 0x2f / 255];

type RGB = [number, number, number];

const norm = (hex: number): RGB => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const ratio = (hex: number, base: readonly [number, number, number]): RGB => {
  const [r, g, b] = norm(hex);
  return [r / base[0], g / base[1], b / base[2]];
};

const mapTints = (base: readonly [number, number, number]): Record<Biome, RGB> =>
  Object.fromEntries((Object.entries(BIOME_TINT_HEX) as [Biome, number][]).map(([b, hex]) => [b, ratio(hex, base)])) as Record<Biome, RGB>;

/** 草类顶点色倍率（草方块顶面、草丛/蕨/高草丛/大型蕨） */
export const GRASS_TINT_RATIO: Record<Biome, RGB> = mapTints(BASE_GRASS);
/** 树叶顶点色倍率（橡木/丛林/金合欢/深色橡木/红树；云杉/白桦/樱花为固定色不乘） */
export const FOLIAGE_TINT_RATIO: Record<Biome, RGB> = mapTints(BASE_FOLIAGE);
