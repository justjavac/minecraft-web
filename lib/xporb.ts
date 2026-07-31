// 经验球（MC）：死亡时掉落部分经验，可被捡回；小范围散落后被玩家吸附
// 世界作用域状态（维度切换清空）；纯逻辑可单测

import type { World } from './world';

export interface XpOrb {
  id: number;
  x: number;
  y: number;
  z: number;
  velX: number;
  velY: number;
  velZ: number;
  /** 本球的经验值（拾取时加给玩家） */
  value: number;
  /** 已存在秒数（>0.5 才可拾取，>300 消失——MC 5 分钟） */
  age: number;
}

export const xpOrbs: XpOrb[] = [];
let nextId = 1;

const GRAVITY = 16;
const PICKUP_DELAY = 0.5;
const PICKUP_RANGE = 1.25;
/** 吸附范围（MC 掉落物/经验球约 1-2 格内开始吸附） */
const ATTRACT_RANGE = 2.5;
const ATTRACT_SPEED = 8;
const MAX_AGE = 300;

/** 死亡掉落经验：MC 约 min(等级×7, 100) 点，拆成 3-6 球散落 */
export function spawnXpOrbs(x: number, y: number, z: number, total: number): void {
  if (total <= 0) return;
  const n = Math.min(6, Math.max(3, Math.floor(total / 5)));
  let left = total;
  for (let i = 0; i < n; i++) {
    const value = i === n - 1 ? left : Math.max(1, Math.floor(total / n));
    left -= value;
    const ang = Math.random() * Math.PI * 2;
    const sp = 1 + Math.random() * 2;
    xpOrbs.push({
      id: nextId++,
      x,
      y,
      z,
      velX: Math.cos(ang) * sp,
      velY: 2 + Math.random() * 2,
      velZ: Math.sin(ang) * sp,
      value,
      age: 0,
    });
  }
}

/** 每帧推进：重力 + 落地停 + 吸附 + 拾取（onPickup 回调加经验）；超龄消失 */
export function tickXpOrbs(
  world: World,
  dt: number,
  playerPos: { x: number; y: number; z: number },
  onPickup: (value: number) => void,
  isSolid: (x: number, y: number, z: number) => boolean,
): void {
  for (let i = xpOrbs.length - 1; i >= 0; i--) {
    const o = xpOrbs[i];
    o.age += dt;
    if (o.age > MAX_AGE) {
      xpOrbs.splice(i, 1);
      continue;
    }
    const dx = playerPos.x - o.x;
    const dy = playerPos.y + 0.5 - o.y;
    const dz = playerPos.z - o.z;
    const dist = Math.hypot(dx, dy, dz);
    // 拾取（MC：贴近即吸收）
    if (o.age >= PICKUP_DELAY && dist < PICKUP_RANGE) {
      onPickup(o.value);
      xpOrbs.splice(i, 1);
      continue;
    }
    // 吸附（MC：近距快速吸向玩家）
    if (o.age >= PICKUP_DELAY && dist < ATTRACT_RANGE && dist > 0.01) {
      o.velX = (dx / dist) * ATTRACT_SPEED;
      o.velY = (dy / dist) * ATTRACT_SPEED;
      o.velZ = (dz / dist) * ATTRACT_SPEED;
    } else {
      o.velY -= GRAVITY * dt;
      o.velX *= 1 - Math.min(1, 2 * dt);
      o.velZ *= 1 - Math.min(1, 2 * dt);
    }
    const ny = o.y + o.velY * dt;
    // 落地停（球半径约 0.25）
    if (o.velY < 0 && isSolid(o.x, Math.floor(ny - 0.25), o.z)) {
      o.y = Math.floor(ny - 0.25) + 1.25;
      o.velY = 0;
      o.velX = 0;
      o.velZ = 0;
    } else {
      o.y = ny;
    }
    o.x += o.velX * dt;
    o.z += o.velZ * dt;
  }
}

/** 清空（测试/维度切换用） */
export function clearXpOrbs(): void {
  xpOrbs.length = 0;
}
