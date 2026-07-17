// 工具定义：挖掘速度倍率、耐久、近战伤害（数值对齐 MC Java）

import { BRICK, COBBLE, DIRT, FURNACE, GRASS, LOG, PLANKS, SAND, STONE, type BlockId } from './blocks';

export type ToolKind = 'pickaxe' | 'axe' | 'shovel' | 'sword';
export type ToolTier = 'wood' | 'stone';
export type ToolType =
  | 'wooden_pickaxe' | 'stone_pickaxe'
  | 'wooden_axe' | 'stone_axe'
  | 'wooden_shovel' | 'stone_shovel'
  | 'wooden_sword' | 'stone_sword';

export interface ToolDef {
  type: ToolType;
  kind: ToolKind;
  tier: ToolTier;
  name: string;
  /** 对有效方块的挖掘速度倍率（MC：木 2x 石 4x） */
  speed: number;
  /** MC 耐久：木 59 石 131 */
  durability: number;
  /** 近战伤害（剑 MC：木 4 石 5；其他工具作武器伤害较低） */
  attackDamage: number;
  /** 攻击冷却秒（剑 MC 攻速 1.6；工具/拳头按 4 攻速） */
  attackCd: number;
  /** 图标 tile（热键栏/掉落物显示用：木系用木板，石系用圆石） */
  iconTile: number;
}

export const TOOLS: Record<ToolType, ToolDef> = {
  wooden_pickaxe: { type: 'wooden_pickaxe', kind: 'pickaxe', tier: 'wood', name: '木镐', speed: 2, durability: 59, attackDamage: 2, attackCd: 0.25, iconTile: 8 },
  stone_pickaxe: { type: 'stone_pickaxe', kind: 'pickaxe', tier: 'stone', name: '石镐', speed: 4, durability: 131, attackDamage: 3, attackCd: 0.25, iconTile: 4 },
  wooden_axe: { type: 'wooden_axe', kind: 'axe', tier: 'wood', name: '木斧', speed: 2, durability: 59, attackDamage: 3, attackCd: 0.25, iconTile: 8 },
  stone_axe: { type: 'stone_axe', kind: 'axe', tier: 'stone', name: '石斧', speed: 4, durability: 131, attackDamage: 4, attackCd: 0.25, iconTile: 4 },
  wooden_shovel: { type: 'wooden_shovel', kind: 'shovel', tier: 'wood', name: '木锹', speed: 2, durability: 59, attackDamage: 2, attackCd: 0.25, iconTile: 8 },
  stone_shovel: { type: 'stone_shovel', kind: 'shovel', tier: 'stone', name: '石锹', speed: 4, durability: 131, attackDamage: 3, attackCd: 0.25, iconTile: 4 },
  wooden_sword: { type: 'wooden_sword', kind: 'sword', tier: 'wood', name: '木剑', speed: 1, durability: 59, attackDamage: 4, attackCd: 0.625, iconTile: 8 },
  stone_sword: { type: 'stone_sword', kind: 'sword', tier: 'stone', name: '石剑', speed: 1, durability: 131, attackDamage: 5, attackCd: 0.625, iconTile: 4 },
};

/** 各类工具的有效方块（剑无挖掘加成） */
export const EFFECTIVE_ON: Record<Exclude<ToolKind, 'sword'>, BlockId[]> = {
  pickaxe: [STONE, COBBLE, BRICK, FURNACE],
  axe: [LOG, PLANKS],
  shovel: [DIRT, SAND, GRASS],
};

/** MC：不用镐挖掘这些方块没有任何掉落 */
export const REQUIRES_PICKAXE: BlockId[] = [STONE, COBBLE, BRICK, FURNACE];
