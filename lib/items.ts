// 掉落物实体：破坏方块/死亡时生成，旋转浮动，延时拾取，5 分钟消失。纯数据逻辑（可单测）

import { BLOCKS, type BlockId } from './blocks';
import type { ArmorPiece } from './armor';
import type { ToolType } from './tools';
import type { World } from './world';

export type DropKind =
  | { kind: 'block'; blockId: BlockId }
  | { kind: 'material'; material: string }
  | { kind: 'tool'; tool: ToolType }
  | { kind: 'armor'; piece: ArmorPiece };

export interface ItemDrop {
  id: number;
  drop: DropKind;
  count: number;
  /** 工具/装备的剩余耐久（其他类别为 undefined） */
  durability?: number;
  x: number;
  y: number;
  z: number;
  velY: number;
  /** 已存在秒数（>0.5 才可拾取，>300 消失） */
  age: number;
}

export const itemDrops: ItemDrop[] = [];

const GRAVITY = 18;
const PICKUP_DELAY = 0.5; // MC：掉落 0.5 秒后才能拾取
const PICKUP_RANGE = 1.25;
const LIFETIME = 300; // MC：5 分钟消失
const MAX_DROPS = 256;

let nextId = 1;


function spawn(drop: DropKind, x: number, y: number, z: number, count: number, durability?: number): void {
  if (itemDrops.length >= MAX_DROPS) itemDrops.shift(); // 超上限丢弃最旧的
  itemDrops.push({ id: nextId++, drop, count, durability, x, y, z, velY: 2, age: 0 });
}

export function spawnBlockDrop(blockId: BlockId, x: number, y: number, z: number, count = 1): void {
  spawn({ kind: 'block', blockId }, x, y, z, count);
}

export function spawnMaterialDrop(material: string, x: number, y: number, z: number, count = 1): void {
  spawn({ kind: 'material', material }, x, y, z, count);
}

export function spawnToolDrop(tool: ToolType, x: number, y: number, z: number, durability?: number): void {
  spawn({ kind: 'tool', tool }, x, y, z, 1, durability);
}

export function spawnArmorDrop(piece: ArmorPiece, x: number, y: number, z: number, durability: number): void {
  spawn({ kind: 'armor', piece }, x, y, z, 1, durability);
}

export function clearDrops(): void {
  itemDrops.length = 0;
}

/**
 * 每帧推进：重力、落地、拾取、消失。
 * onPickup(drop) 返回 true 才移除实体（背包满时可保留）。
 */
export function tickDrops(
  world: World,
  dt: number,
  playerPos: { x: number; y: number; z: number },
  onPickup: (drop: ItemDrop) => boolean,
): void {
  for (let i = itemDrops.length - 1; i >= 0; i--) {
    const d = itemDrops[i];
    d.age += dt;
    if (d.age >= LIFETIME) {
      itemDrops.splice(i, 1);
      continue;
    }

    // 重力与落地（中心点下方半格处为底面；单帧最多下落 1 格防穿透）
    d.velY = Math.max(d.velY - GRAVITY * dt, -30);
    let newY = d.y + d.velY * dt;
    if (newY < d.y - 1) newY = d.y - 1;
    d.y = newY;
    const by = Math.floor(d.y - 0.125);
    if (d.velY <= 0 && BLOCKS[world.getBlock(Math.floor(d.x), by, Math.floor(d.z))]?.solid) {
      d.y = by + 1 + 0.125;
      d.velY = 0;
    }
    if (d.y < -10) {
      itemDrops.splice(i, 1);
      continue;
    }

    // 延时后进入拾取范围
    if (d.age >= PICKUP_DELAY) {
      const dx = playerPos.x - d.x;
      const dy = playerPos.y + 0.5 - d.y;
      const dz = playerPos.z - d.z;
      if (dx * dx + dy * dy + dz * dz < PICKUP_RANGE * PICKUP_RANGE && onPickup(d)) {
        itemDrops.splice(i, 1);
      }
    }
  }
}
