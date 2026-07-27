// 点燃的 TNT 实体：重力下落 + 闪烁引信（MC 4 秒）+ 到期爆炸

import { BLOCKS } from './blocks';
import { explodeAt } from './explosion';
import type { World } from './world';

export interface PrimedTnt {
  id: number;
  x: number;
  y: number;
  z: number;
  vy: number;
  /** 剩余引信秒数（MC 80 tick = 4s） */
  fuse: number;
}

export const primedTnt: PrimedTnt[] = [];
let nextId = 1;

const FUSE_SECONDS = 4;

export function igniteTnt(x: number, y: number, z: number): void {
  primedTnt.push({ id: nextId++, x: x + 0.5, y: y + 0.02, z: z + 0.5, vy: 0.2, fuse: FUSE_SECONDS });
}

export function clearTnt(): void {
  primedTnt.length = 0;
}

/** 每帧推进：重力 + 碰撞（落方块顶面停住，不穿透）+ 引信 */
export function tickTnt(
  world: World,
  dt: number,
  playerPos: { x: number; y: number; z: number },
  onAttackPlayer: (damage: number) => void,
): void {
  for (let i = primedTnt.length - 1; i >= 0; i--) {
    const t = primedTnt[i];
    t.fuse -= dt;
    t.vy = Math.max(t.vy - 12 * dt, -40); // 实体重力（比玩家轻，缓落）
    const nextY = t.y + t.vy * dt;
    if (t.vy < 0) {
      // 下落：找本格与途经格的实心阻挡，停在顶面上（实体高 0.98）
      const floorY = Math.floor(nextY - 0.02);
      if (BLOCKS[world.getBlock(Math.floor(t.x), floorY, Math.floor(t.z))]?.solid) {
        t.y = floorY + 1.02;
        t.vy = 0;
      } else {
        t.y = Math.max(0, nextY);
      }
    } else {
      t.y = nextY;
    }
    if (t.fuse <= 0) {
      primedTnt.splice(i, 1);
      explodeAt(world, t.x, t.y, t.z, playerPos, onAttackPlayer, {
        radius: 4,
        maxDamage: 32, // TNT 贴脸约 16 心（普通难度），取一半刻度对齐苦力怕 22
        hurtRadius: 7,
      });
    }
  }
}
