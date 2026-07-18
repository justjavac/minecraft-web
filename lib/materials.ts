// 材料（非方块物品）的显示信息：名称 + atlas 图标 tile

import { ICON_TILE_START } from './blocks';

export const MATERIAL_INFO: Record<string, { name: string; tile: number }> = {
  stick: { name: '木棍', tile: ICON_TILE_START + 8 },
  charcoal: { name: '木炭', tile: ICON_TILE_START + 9 },
  leather: { name: '皮革', tile: ICON_TILE_START + 3 },
  raw_pork: { name: '生猪排', tile: ICON_TILE_START + 10 },
  cooked_pork: { name: '熟猪排', tile: ICON_TILE_START + 11 },
  raw_beef: { name: '生牛肉', tile: ICON_TILE_START + 12 },
  cooked_beef: { name: '熟牛肉', tile: ICON_TILE_START + 13 },
  raw_chicken: { name: '生鸡肉', tile: ICON_TILE_START + 14 },
  cooked_chicken: { name: '熟鸡肉', tile: ICON_TILE_START + 15 },
};

export function materialName(material: string): string {
  return MATERIAL_INFO[material]?.name ?? material;
}

export function materialTile(material: string): number {
  return MATERIAL_INFO[material]?.tile ?? ICON_TILE_START + 3;
}
