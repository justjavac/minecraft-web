// 工具定义：挖掘速度倍率、耐久、近战伤害（数值对齐 MC Java：木/石/铁/钻 2x/4x/6x/8x）

import { tileOf } from './blocks';

export type ToolKind = 'pickaxe' | 'axe' | 'shovel' | 'sword';
export type ToolTier = 'wood' | 'stone' | 'iron' | 'diamond';
export type ToolType =
  | 'wooden_pickaxe' | 'stone_pickaxe' | 'iron_pickaxe' | 'diamond_pickaxe'
  | 'wooden_axe' | 'stone_axe' | 'iron_axe' | 'diamond_axe'
  | 'wooden_shovel' | 'stone_shovel' | 'iron_shovel' | 'diamond_shovel'
  | 'wooden_sword' | 'stone_sword' | 'iron_sword' | 'diamond_sword';

export interface ToolDef {
  type: ToolType;
  kind: ToolKind;
  tier: ToolTier;
  name: string;
  /** 对有效方块的挖掘速度倍率（MC：木 2x 石 4x 铁 6x 钻 8x） */
  speed: number;
  /** MC 耐久：木 59 石 131 铁 250 钻 1561 */
  durability: number;
  /** 近战伤害（剑 MC：木 4 石 5 铁 6 钻 7；其他工具作武器伤害较低） */
  attackDamage: number;
  /** 攻击冷却秒（剑 MC 攻速 1.6；工具/拳头按 4 攻速） */
  attackCd: number;
  /** 图标 tile（热键栏/掉落物显示用：木系用木板，石系用圆石，铁用铁块，钻用钻石块） */
  iconTile: number;
}

const PLANKS_TILE = tileOf('oak_planks');
const COBBLE_TILE = tileOf('cobblestone');
const IRON_TILE = tileOf('iron_block');
const DIAMOND_TILE = tileOf('diamond_block');

export const TOOLS: Record<ToolType, ToolDef> = {
  wooden_pickaxe: { type: 'wooden_pickaxe', kind: 'pickaxe', tier: 'wood', name: '木镐', speed: 2, durability: 59, attackDamage: 2, attackCd: 0.25, iconTile: PLANKS_TILE },
  stone_pickaxe: { type: 'stone_pickaxe', kind: 'pickaxe', tier: 'stone', name: '石镐', speed: 4, durability: 131, attackDamage: 3, attackCd: 0.25, iconTile: COBBLE_TILE },
  iron_pickaxe: { type: 'iron_pickaxe', kind: 'pickaxe', tier: 'iron', name: '铁镐', speed: 6, durability: 250, attackDamage: 4, attackCd: 0.25, iconTile: IRON_TILE },
  diamond_pickaxe: { type: 'diamond_pickaxe', kind: 'pickaxe', tier: 'diamond', name: '钻石镐', speed: 8, durability: 1561, attackDamage: 5, attackCd: 0.25, iconTile: DIAMOND_TILE },
  wooden_axe: { type: 'wooden_axe', kind: 'axe', tier: 'wood', name: '木斧', speed: 2, durability: 59, attackDamage: 3, attackCd: 0.25, iconTile: PLANKS_TILE },
  stone_axe: { type: 'stone_axe', kind: 'axe', tier: 'stone', name: '石斧', speed: 4, durability: 131, attackDamage: 4, attackCd: 0.25, iconTile: COBBLE_TILE },
  iron_axe: { type: 'iron_axe', kind: 'axe', tier: 'iron', name: '铁斧', speed: 6, durability: 250, attackDamage: 5, attackCd: 0.25, iconTile: IRON_TILE },
  diamond_axe: { type: 'diamond_axe', kind: 'axe', tier: 'diamond', name: '钻石斧', speed: 8, durability: 1561, attackDamage: 6, attackCd: 0.25, iconTile: DIAMOND_TILE },
  wooden_shovel: { type: 'wooden_shovel', kind: 'shovel', tier: 'wood', name: '木锹', speed: 2, durability: 59, attackDamage: 2, attackCd: 0.25, iconTile: PLANKS_TILE },
  stone_shovel: { type: 'stone_shovel', kind: 'shovel', tier: 'stone', name: '石锹', speed: 4, durability: 131, attackDamage: 3, attackCd: 0.25, iconTile: COBBLE_TILE },
  iron_shovel: { type: 'iron_shovel', kind: 'shovel', tier: 'iron', name: '铁锹', speed: 6, durability: 250, attackDamage: 3, attackCd: 0.25, iconTile: IRON_TILE },
  diamond_shovel: { type: 'diamond_shovel', kind: 'shovel', tier: 'diamond', name: '钻石锹', speed: 8, durability: 1561, attackDamage: 4, attackCd: 0.25, iconTile: DIAMOND_TILE },
  wooden_sword: { type: 'wooden_sword', kind: 'sword', tier: 'wood', name: '木剑', speed: 1, durability: 59, attackDamage: 4, attackCd: 0.625, iconTile: PLANKS_TILE },
  stone_sword: { type: 'stone_sword', kind: 'sword', tier: 'stone', name: '石剑', speed: 1, durability: 131, attackDamage: 5, attackCd: 0.625, iconTile: COBBLE_TILE },
  iron_sword: { type: 'iron_sword', kind: 'sword', tier: 'iron', name: '铁剑', speed: 1, durability: 250, attackDamage: 6, attackCd: 0.625, iconTile: IRON_TILE },
  diamond_sword: { type: 'diamond_sword', kind: 'sword', tier: 'diamond', name: '钻石剑', speed: 1, durability: 1561, attackDamage: 7, attackCd: 0.625, iconTile: DIAMOND_TILE },
};
