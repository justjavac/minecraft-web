// 材料（非方块物品）的显示信息：名称 + atlas 图标 tile

export const MATERIAL_INFO: Record<string, { name: string; tile: number }> = {
  stick: { name: '木棍', tile: 21 },
  charcoal: { name: '木炭', tile: 22 },
  leather: { name: '皮革', tile: 16 },
  raw_pork: { name: '生猪排', tile: 23 },
  cooked_pork: { name: '熟猪排', tile: 24 },
  raw_beef: { name: '生牛肉', tile: 25 },
  cooked_beef: { name: '熟牛肉', tile: 26 },
  raw_chicken: { name: '生鸡肉', tile: 27 },
  cooked_chicken: { name: '熟鸡肉', tile: 28 },
};

export function materialName(material: string): string {
  return MATERIAL_INFO[material]?.name ?? material;
}

export function materialTile(material: string): number {
  return MATERIAL_INFO[material]?.tile ?? 8;
}
