// 皮甲装备：部件定义、护甲点数（数值对齐 MC 皮革套装）

export type ArmorPiece = 'helmet' | 'chestplate' | 'leggings' | 'boots';

export interface ArmorDef {
  piece: ArmorPiece;
  name: string;
  /** 护甲点（MC 皮甲：头 1 胸 3 腿 2 靴 1，全套 7 点 = 28% 减伤） */
  points: number;
  /** MC 皮甲耐久：55/80/75/65 */
  durability: number;
  /** 皮革用量（MC 配方：5/8/7/4） */
  cost: number;
  /** 图标 tile */
  iconTile: number;
}

export const ARMOR_DEFS: Record<ArmorPiece, ArmorDef> = {
  helmet: { piece: 'helmet', name: '皮革头盔', points: 1, durability: 55, cost: 5, iconTile: 17 },
  chestplate: { piece: 'chestplate', name: '皮革胸甲', points: 3, durability: 80, cost: 8, iconTile: 18 },
  leggings: { piece: 'leggings', name: '皮革护腿', points: 2, durability: 75, cost: 7, iconTile: 19 },
  boots: { piece: 'boots', name: '皮革靴子', points: 1, durability: 65, cost: 4, iconTile: 20 },
};

export interface ArmorSlots {
  helmet: { durability: number } | null;
  chestplate: { durability: number } | null;
  leggings: { durability: number } | null;
  boots: { durability: number } | null;
}

export function emptyArmorSlots(): ArmorSlots {
  return { helmet: null, chestplate: null, leggings: null, boots: null };
}

/** 当前护甲点数（每点 = 4% 减伤） */
export function armorPoints(slots: ArmorSlots): number {
  let p = 0;
  for (const piece of Object.keys(ARMOR_DEFS) as ArmorPiece[]) {
    if (slots[piece]) p += ARMOR_DEFS[piece].points;
  }
  return p;
}
