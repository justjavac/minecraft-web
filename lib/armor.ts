// 装备：部件 × 材质定义、护甲点数（数值对齐 MC：皮革 7、金 11、铁 15、钻/下界合金 20 点）

import { ICON_TILE_START, tileIcon } from './blocks';

export type ArmorPiece = 'helmet' | 'chestplate' | 'leggings' | 'boots';
export type ArmorMaterial = 'leather' | 'gold' | 'iron' | 'diamond' | 'netherite' | 'elytra';

export interface ArmorDef {
  piece: ArmorPiece;
  material: ArmorMaterial;
  name: string;
  /** 护甲点（每点 = 4% 减伤；MC 全套：皮革 7、金 11、铁 15、钻/合金 20） */
  points: number;
  /** 护甲韧性（MC：钻 2/件 全套 8，下界合金 3/件 全套 12，其他 0；高伤害时降低护甲击穿） */
  toughness: number;
  /** MC 耐久（皮革 55/80/75/65 → 下界合金 407/592/555/481） */
  durability: number;
  /** 合成材料用量（MC 配方 5/8/7/4；下界合金不可合成——锻造台升级） */
  cost: number;
  /** 图标 tile */
  iconTile: number;
}

const POINTS: Record<ArmorMaterial, Record<ArmorPiece, number>> = {
  leather: { helmet: 1, chestplate: 3, leggings: 2, boots: 1 },
  gold: { helmet: 2, chestplate: 5, leggings: 3, boots: 1 },
  iron: { helmet: 2, chestplate: 6, leggings: 5, boots: 2 },
  diamond: { helmet: 3, chestplate: 8, leggings: 6, boots: 3 },
  netherite: { helmet: 3, chestplate: 8, leggings: 6, boots: 3 },
  elytra: { helmet: 0, chestplate: 0, leggings: 0, boots: 0 }, // 鞘翅：无护甲（MC）
};

const DURABILITY: Record<ArmorMaterial, Record<ArmorPiece, number>> = {
  leather: { helmet: 55, chestplate: 80, leggings: 75, boots: 65 },
  gold: { helmet: 77, chestplate: 112, leggings: 105, boots: 91 },
  iron: { helmet: 165, chestplate: 240, leggings: 225, boots: 195 },
  diamond: { helmet: 363, chestplate: 528, leggings: 495, boots: 429 },
  netherite: { helmet: 407, chestplate: 592, leggings: 555, boots: 481 },
  elytra: { helmet: 432, chestplate: 432, leggings: 432, boots: 432 }, // MC 鞘翅耐久 432
};

/** MC 护甲韧性：钻 2/件（全套 8）、下界合金 3/件（全套 12）、其他 0 */
const TOUGHNESS: Record<ArmorMaterial, number> = {
  leather: 0,
  gold: 0,
  iron: 0,
  diamond: 2,
  netherite: 3,
  elytra: 0,
};

export const MATERIAL_NAME: Record<ArmorMaterial, string> = {
  leather: '皮革',
  gold: '金',
  iron: '铁',
  diamond: '钻石',
  netherite: '下界合金',
  elytra: '鞘翅',
};
export const PIECE_NAME: Record<ArmorPiece, string> = { helmet: '头盔', chestplate: '胸甲', leggings: '护腿', boots: '靴子' };
export const PIECE_COST: Record<ArmorPiece, number> = { helmet: 5, chestplate: 8, leggings: 7, boots: 4 };
/** 皮革图标沿用 canvas 格（项目早期绘制），其余材质用 Faithful 物品贴图 */
const LEATHER_ICON: Record<ArmorPiece, number> = {
  helmet: ICON_TILE_START + 4,
  chestplate: ICON_TILE_START + 5,
  leggings: ICON_TILE_START + 6,
  boots: ICON_TILE_START + 7,
};

function buildDefs(): Record<ArmorMaterial, Record<ArmorPiece, ArmorDef>> {
  const out = {} as Record<ArmorMaterial, Record<ArmorPiece, ArmorDef>>;
  for (const material of Object.keys(POINTS) as ArmorMaterial[]) {
    out[material] = {} as Record<ArmorPiece, ArmorDef>;
    for (const piece of Object.keys(PIECE_NAME) as ArmorPiece[]) {
      out[material][piece] = {
        piece,
        material,
        name: `${MATERIAL_NAME[material]}${PIECE_NAME[piece]}`,
        points: POINTS[material][piece],
        toughness: TOUGHNESS[material],
        durability: DURABILITY[material][piece],
        cost: PIECE_COST[piece],
        iconTile:
          material === 'leather'
            ? LEATHER_ICON[piece]
            : tileIcon(material === 'elytra' ? 'item/elytra' : material === 'gold' ? `item/golden_${piece}` : `item/${material}_${piece}`), // MC 现代命名：金甲为 golden_xxx
      };
    }
  }
  return out;
}

export const ARMOR_DEFS: Record<ArmorMaterial, Record<ArmorPiece, ArmorDef>> = buildDefs();

/** 按材质 + 部位取定义 */
export function armorDef(material: ArmorMaterial, piece: ArmorPiece): ArmorDef {
  return ARMOR_DEFS[material][piece];
}

/** 槽位/装备实例的定义（material 缺省皮革——兼容旧存档与早期编码） */
export function armorDefOf(slot: { piece: ArmorPiece; material?: ArmorMaterial }): ArmorDef {
  return ARMOR_DEFS[slot.material ?? 'leather'][slot.piece];
}

export interface ArmorSlots {
  helmet: { durability: number; material?: ArmorMaterial; ench?: import('./xp').EnchMap } | null;
  chestplate: { durability: number; material?: ArmorMaterial; ench?: import('./xp').EnchMap } | null;
  leggings: { durability: number; material?: ArmorMaterial; ench?: import('./xp').EnchMap } | null;
  boots: { durability: number; material?: ArmorMaterial; ench?: import('./xp').EnchMap } | null;
}

export function emptyArmorSlots(): ArmorSlots {
  return { helmet: null, chestplate: null, leggings: null, boots: null };
}

/** 当前护甲点数（每点 = 4% 减伤；按各件实际材质计） */
export function armorPoints(slots: ArmorSlots): number {
  let p = 0;
  for (const piece of Object.keys(PIECE_NAME) as ArmorPiece[]) {
    const cur = slots[piece];
    if (cur) p += armorDefOf({ piece, material: cur.material }).points;
  }
  return p;
}

/** 当前护甲韧性总和（MC：钻 2/件 全套 8，下界合金 3/件 全套 12） */
export function armorToughness(slots: ArmorSlots): number {
  let t = 0;
  for (const piece of Object.keys(PIECE_NAME) as ArmorPiece[]) {
    const cur = slots[piece];
    if (cur) t += armorDefOf({ piece, material: cur.material }).toughness;
  }
  return t;
}

/**
 * MC Java 1.9+ 两段式减伤（跨代理契约函数，store.damagePlayer 等调用）：
 * 1. 护甲：reduction = min(20, max(armor/5, armor - amount/(2 + toughness/4))) / 25
 *    （减伤比例上限 80%；韧性越高，大伤害击穿护甲越少）
 * 2. 保护附魔：EPF = 各件保护等级之和（合计封顶 20），第一段之后再乘 (1 - 0.04×EPF)
 * Java 无「至少 1 点伤害」地板：小伤害可被减到趋近 0，由调用方自行舍入。
 */
export function damageAfterArmor(amount: number, slots: ArmorSlots): number {
  const armor = armorPoints(slots);
  const toughness = armorToughness(slots);
  const reduction = Math.min(20, Math.max(armor / 5, armor - amount / (2 + toughness / 4))) / 25;
  const epf = Math.min(
    20,
    Object.values(slots).reduce((n, p) => n + (p?.ench?.protection ?? 0), 0),
  );
  return amount * (1 - reduction) * (1 - 0.04 * epf);
}
