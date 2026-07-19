// 点燃的 TNT 实体：重力下落 + 闪烁引信（MC 4 秒）+ 到期爆炸

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

/** 每帧推进：重力 + 引信；返回爆炸时伤害玩家的回调入参 */
export function tickTnt(
  world: World,
  dt: number,
  playerPos: { x: number; y: number; z: number },
  onAttackPlayer: (damage: number) => void,
): void {
  for (let i = primedTnt.length - 1; i >= 0; i--) {
    const t = primedTnt[i];
    t.fuse -= dt;
    t.vy -= 12 * dt; // 实体重力（比玩家轻，缓落）
    t.y = Math.max(0, t.y + t.vy * dt);
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
