// 工具定义：挖掘速度倍率、耐久、近战伤害（数值对齐 MC Java：木/石/铁/钻 2x/4x/6x/8x，金 12x 最快但耐久仅 32）

import { tileIcon } from './blocks';

export type ToolKind = 'pickaxe' | 'axe' | 'shovel' | 'sword' | 'hoe' | 'bow' | 'shears' | 'fishing';
export type ToolTier = 'wood' | 'stone' | 'iron' | 'diamond' | 'netherite';
export type ToolType =
  | 'wooden_pickaxe' | 'stone_pickaxe' | 'iron_pickaxe' | 'golden_pickaxe' | 'diamond_pickaxe' | 'netherite_pickaxe'
  | 'wooden_axe' | 'stone_axe' | 'iron_axe' | 'golden_axe' | 'diamond_axe' | 'netherite_axe'
  | 'wooden_shovel' | 'stone_shovel' | 'iron_shovel' | 'golden_shovel' | 'diamond_shovel' | 'netherite_shovel'
  | 'wooden_sword' | 'stone_sword' | 'iron_sword' | 'golden_sword' | 'diamond_sword' | 'netherite_sword'
  | 'wooden_hoe' | 'stone_hoe' | 'iron_hoe' | 'diamond_hoe' | 'netherite_hoe'
  | 'bow'
  | 'shears'
  | 'fishing_rod';

export interface ToolDef {
  type: ToolType;
  kind: ToolKind;
  tier: ToolTier;
  name: string;
  /** 对有效方块的挖掘速度倍率（MC：木 2x 石 4x 铁 6x 钻 8x 金 12x） */
  speed: number;
  /** MC 耐久：木 59 石 131 铁 250 钻 1561 金 32 */
  durability: number;
  /** 近战伤害（MC Java：剑 木4/石5/铁6/钻7/合金8，斧 木金7/石铁钻9/合金10，其他工具作武器伤害较低） */
  attackDamage: number;
  /** 攻击冷却秒 = 1/攻速（MC Java：剑 1.6，斧 木石金 0.8/铁 0.9/钻合金 1.0，镐/锹/锄/徒手 4） */
  attackCd: number;
  /** 图标 tile（MC 原版工具贴图，经 tileIcon 注册进 atlas） */
  iconTile: number;
}


export const TOOLS: Record<ToolType, ToolDef> = {
  wooden_pickaxe: { type: 'wooden_pickaxe', kind: 'pickaxe', tier: 'wood', name: '木镐', speed: 2, durability: 59, attackDamage: 2, attackCd: 0.25, iconTile: tileIcon('item/wooden_pickaxe') },
  stone_pickaxe: { type: 'stone_pickaxe', kind: 'pickaxe', tier: 'stone', name: '石镐', speed: 4, durability: 131, attackDamage: 3, attackCd: 0.25, iconTile: tileIcon('item/stone_pickaxe') },
  iron_pickaxe: { type: 'iron_pickaxe', kind: 'pickaxe', tier: 'iron', name: '铁镐', speed: 6, durability: 250, attackDamage: 4, attackCd: 0.25, iconTile: tileIcon('item/iron_pickaxe') },
  diamond_pickaxe: { type: 'diamond_pickaxe', kind: 'pickaxe', tier: 'diamond', name: '钻石镐', speed: 8, durability: 1561, attackDamage: 5, attackCd: 0.25, iconTile: tileIcon('item/diamond_pickaxe') },
  // 下界合金（MC：锻造台钻石工具 + 合金锭升级；速度 9x、耐久 2031、伤害 +1，防火不烧）
  netherite_pickaxe: { type: 'netherite_pickaxe', kind: 'pickaxe', tier: 'netherite', name: '下界合金镐', speed: 9, durability: 2031, attackDamage: 6, attackCd: 0.25, iconTile: tileIcon('item/netherite_pickaxe') },
  // 金制（MC：速度 12 全游戏最快、耐久仅 32、攻击同木；采掘层级等同木——tier 字段即采掘层级，故取 'wood'）
  golden_pickaxe: { type: 'golden_pickaxe', kind: 'pickaxe', tier: 'wood', name: '金镐', speed: 12, durability: 32, attackDamage: 2, attackCd: 0.25, iconTile: tileIcon('item/golden_pickaxe') },
  // 斧（MC Java 1.9 战斗数值：伤害 木/金 7、石/铁/钻 9、合金 10；攻速 木/石/金 0.8、铁 0.9、钻/合金 1.0 → 冷却 1.25/1.11/1.0s）
  wooden_axe: { type: 'wooden_axe', kind: 'axe', tier: 'wood', name: '木斧', speed: 2, durability: 59, attackDamage: 7, attackCd: 1.25, iconTile: tileIcon('item/wooden_pickaxe') },
  stone_axe: { type: 'stone_axe', kind: 'axe', tier: 'stone', name: '石斧', speed: 4, durability: 131, attackDamage: 9, attackCd: 1.25, iconTile: tileIcon('item/stone_pickaxe') },
  iron_axe: { type: 'iron_axe', kind: 'axe', tier: 'iron', name: '铁斧', speed: 6, durability: 250, attackDamage: 9, attackCd: 1 / 0.9, iconTile: tileIcon('item/iron_pickaxe') },
  diamond_axe: { type: 'diamond_axe', kind: 'axe', tier: 'diamond', name: '钻石斧', speed: 8, durability: 1561, attackDamage: 9, attackCd: 1, iconTile: tileIcon('item/diamond_pickaxe') },
  netherite_axe: { type: 'netherite_axe', kind: 'axe', tier: 'netherite', name: '下界合金斧', speed: 9, durability: 2031, attackDamage: 10, attackCd: 1, iconTile: tileIcon('item/netherite_axe') },
  golden_axe: { type: 'golden_axe', kind: 'axe', tier: 'wood', name: '金斧', speed: 12, durability: 32, attackDamage: 7, attackCd: 1.25, iconTile: tileIcon('item/golden_pickaxe') },
  wooden_shovel: { type: 'wooden_shovel', kind: 'shovel', tier: 'wood', name: '木锹', speed: 2, durability: 59, attackDamage: 2, attackCd: 0.25, iconTile: tileIcon('item/wooden_pickaxe') },
  stone_shovel: { type: 'stone_shovel', kind: 'shovel', tier: 'stone', name: '石锹', speed: 4, durability: 131, attackDamage: 3, attackCd: 0.25, iconTile: tileIcon('item/stone_pickaxe') },
  iron_shovel: { type: 'iron_shovel', kind: 'shovel', tier: 'iron', name: '铁锹', speed: 6, durability: 250, attackDamage: 3, attackCd: 0.25, iconTile: tileIcon('item/iron_pickaxe') },
  diamond_shovel: { type: 'diamond_shovel', kind: 'shovel', tier: 'diamond', name: '钻石锹', speed: 8, durability: 1561, attackDamage: 4, attackCd: 0.25, iconTile: tileIcon('item/diamond_pickaxe') },
  netherite_shovel: { type: 'netherite_shovel', kind: 'shovel', tier: 'netherite', name: '下界合金锹', speed: 9, durability: 2031, attackDamage: 5, attackCd: 0.25, iconTile: tileIcon('item/netherite_shovel') },
  golden_shovel: { type: 'golden_shovel', kind: 'shovel', tier: 'wood', name: '金锹', speed: 12, durability: 32, attackDamage: 2, attackCd: 0.25, iconTile: tileIcon('item/golden_pickaxe') },
  wooden_sword: { type: 'wooden_sword', kind: 'sword', tier: 'wood', name: '木剑', speed: 1, durability: 59, attackDamage: 4, attackCd: 0.625, iconTile: tileIcon('item/wooden_pickaxe') },
  stone_sword: { type: 'stone_sword', kind: 'sword', tier: 'stone', name: '石剑', speed: 1, durability: 131, attackDamage: 5, attackCd: 0.625, iconTile: tileIcon('item/stone_pickaxe') },
  iron_sword: { type: 'iron_sword', kind: 'sword', tier: 'iron', name: '铁剑', speed: 1, durability: 250, attackDamage: 6, attackCd: 0.625, iconTile: tileIcon('item/iron_pickaxe') },
  diamond_sword: { type: 'diamond_sword', kind: 'sword', tier: 'diamond', name: '钻石剑', speed: 1, durability: 1561, attackDamage: 7, attackCd: 0.625, iconTile: tileIcon('item/diamond_pickaxe') },
  netherite_sword: { type: 'netherite_sword', kind: 'sword', tier: 'netherite', name: '下界合金剑', speed: 1, durability: 2031, attackDamage: 8, attackCd: 0.625, iconTile: tileIcon('item/netherite_sword') },
  golden_sword: { type: 'golden_sword', kind: 'sword', tier: 'wood', name: '金剑', speed: 1, durability: 32, attackDamage: 4, attackCd: 0.625, iconTile: tileIcon('item/golden_pickaxe') },
  // 弓：远程武器（MC 耐久 384），射箭消耗箭矢，近战极弱
  bow: { type: 'bow', kind: 'bow', tier: 'wood', name: '弓', speed: 1, durability: 384, attackDamage: 1, attackCd: 0.5, iconTile: tileIcon('item/bow') },
  // 锄头：整地工具（草方块/泥土 → 耕地），挖掘无加成
  wooden_hoe: { type: 'wooden_hoe', kind: 'hoe', tier: 'wood', name: '木锄', speed: 1, durability: 59, attackDamage: 1, attackCd: 0.25, iconTile: tileIcon('item/wooden_hoe') },
  stone_hoe: { type: 'stone_hoe', kind: 'hoe', tier: 'stone', name: '石锄', speed: 1, durability: 131, attackDamage: 1, attackCd: 0.25, iconTile: tileIcon('item/stone_hoe') },
  iron_hoe: { type: 'iron_hoe', kind: 'hoe', tier: 'iron', name: '铁锄', speed: 1, durability: 250, attackDamage: 1, attackCd: 0.25, iconTile: tileIcon('item/iron_hoe') },
  diamond_hoe: { type: 'diamond_hoe', kind: 'hoe', tier: 'diamond', name: '钻石锄', speed: 1, durability: 1561, attackDamage: 1, attackCd: 0.25, iconTile: tileIcon('item/diamond_hoe') },
  netherite_hoe: { type: 'netherite_hoe', kind: 'hoe', tier: 'netherite', name: '下界合金锄', speed: 1, durability: 2031, attackDamage: 1, attackCd: 0.25, iconTile: tileIcon('item/netherite_hoe') },
  // 剪刀：剪羊毛工具（MC 耐久 238，铁锭×2 合成）
  shears: { type: 'shears', kind: 'shears', tier: 'iron', name: '剪刀', speed: 1, durability: 238, attackDamage: 1, attackCd: 0.25, iconTile: tileIcon('item/shears') },
  // 钓竿：钓鱼工具（MC 耐久 64，3 木棍 + 2 线合成）
  fishing_rod: { type: 'fishing_rod', kind: 'fishing', tier: 'wood', name: '钓竿', speed: 1, durability: 64, attackDamage: 1, attackCd: 0.25, iconTile: tileIcon('item/fishing_rod') },
};

/**
 * MC Java 1.9 攻击冷却伤害缩放：0.2 + ((t+0.5)/T)² × 0.8（封顶 1）。
 * t = 冷却已走过秒数，T = 总冷却（= 1/攻速）；冷却未满出手伤害大减，冷却走满回到满额。
 */
export function attackCooldownScale(elapsed: number, total: number): number {
  if (total <= 0) return 1;
  const t = Math.max(0, Math.min(elapsed, total));
  return Math.min(1, 0.2 + ((t + 0.5) / total) ** 2 * 0.8);
}
