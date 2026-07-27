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
