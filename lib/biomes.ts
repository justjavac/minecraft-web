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
  /** 水面覆盖（冰原水面为冰） */
  waterTop?: BlockId;
  /** 水边（海平面 ±1 的岸滩，默认用 top） */
  beach?: BlockId;
}

const K = (key: string) => BLOCK_BY_KEY[key].id;

export const BIOME_SURFACE: Record<Biome, BiomeSurface> = {
  plains: { top: K('grass'), filler: K('dirt'), underwater: [K('dirt'), K('gravel')] },
  forest: { top: K('grass'), filler: K('dirt'), underwater: [K('dirt'), K('gravel')] },
  basin: { top: K('grass'), filler: K('dirt'), underwater: [K('dirt'), K('gravel'), K('clay')] },
  desert: {
    top: K('sand'),
    filler: K('sand'),
    underwater: [K('sand'), K('sandstone')],
    beach: K('sand'),
  },
  ice: {
    top: K('snowy_grass'),
    filler: K('dirt'),
    underwater: [K('dirt'), K('gravel')],
    waterTop: K('ice'),
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
