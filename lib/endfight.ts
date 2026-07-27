// 末影龙战：末影水晶（柱顶实体，为龙回血、击毁爆炸）、龙已被击杀标记、击杀结算（龙蛋 + 返回门激活）
// 依赖方向：本文件 import mobs 的回调注入点（setDragonDeathHandler），不反向被 import，无循环

import { BLOCK_BY_KEY } from './blocks';
import { endPillars } from './end';
import { explodeAt } from './explosion';
import { setDragonDeathHandler } from './mobs';
import type { World } from './world';

const K = (key: string) => BLOCK_BY_KEY[key].id;

export interface EndCrystal {
  x: number;
  y: number;
  z: number;
  alive: boolean;
}

/** 场上的末影水晶（每根黑曜石柱顶一个，MC） */
export const endCrystals: EndCrystal[] = [];

/** 水晶列表变更版本号（渲染组件重建用） */
export const crystalVersion = { v: 0 };

/** 龙是否已被击杀（内存态：杀死后重进末地不再生成龙，祭坛保持激活；页面刷新后按世界方块状态重新开战） */
export const dragonState = { slain: false };

/** 进入末地时初始化：未屠龙则每根柱顶放一颗水晶；惰性注册击杀回调（避免模块加载期触发循环依赖 TDZ） */
let handlerRegistered = false;
export function initEndFight(world: World): void {
  if (!handlerRegistered) {
    setDragonDeathHandler(onDragonKilled);
    handlerRegistered = true;
  }
  endCrystals.length = 0;
  crystalVersion.v++;
  if (dragonState.slain) return;
  for (const p of endPillars(world.seedHash)) {
    endCrystals.push({ x: p.x + 0.5, y: p.top + 1.2, z: p.z + 0.5, alive: true });
  }
  crystalVersion.v++;
}

export function clearEndFight(): void {
  endCrystals.length = 0;
  crystalVersion.v++;
}

/** 击毁水晶：爆炸（MC 威力 6，比 TNT 强），龙失去一条回血来源 */
export function hitCrystal(
  c: EndCrystal,
  world: World,
  playerPos: { x: number; y: number; z: number },
  onAttackPlayer: (d: number) => void,
): void {
  if (!c.alive) return;
  c.alive = false;
  crystalVersion.v++;
  explodeAt(world, c.x, c.y, c.z, playerPos, onAttackPlayer, { radius: 3, maxDamage: 12, hurtRadius: 4.5 });
}

/** 准星射线（origin + dir）reach 内的存活水晶（攻击判定；MC 水晶碰撞箱约 1 格） */
export function crystalInReach(
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  reach: number,
): EndCrystal | null {
  for (const c of endCrystals) {
    if (!c.alive) continue;
    const cx = c.x - origin.x;
    const cy = c.y - origin.y;
    const cz = c.z - origin.z;
    const t = cx * dir.x + cy * dir.y + cz * dir.z;
    if (t < 0 || t > reach) continue;
    const px = origin.x + dir.x * t - c.x;
    const py = origin.y + dir.y * t - c.y;
    const pz = origin.z + dir.z * t - c.z;
    if (px * px + py * py + pz * pz < 1.1) return c;
  }
  return null;
}

/** 每 tick：龙在存活水晶 32 格内时每 0.5s 回 1 血（MC 水晶治疗光束） */
let healAcc = 0;
export function tickCrystals(dragon: { x: number; y: number; z: number; hp: number } | null, dt: number): void {
  healAcc += dt;
  if (healAcc < 0.5) return;
  healAcc = 0;
  if (!dragon || dragon.hp <= 0 || dragon.hp >= 200) return;
  const near = endCrystals.some((c) => c.alive && Math.hypot(c.x - dragon.x, c.y - dragon.y, c.z - dragon.z) <= 32);
  if (near) dragon.hp = Math.min(200, dragon.hp + 1);
}

/** 击杀结算（damageMob 注入回调）：标记屠龙、清空水晶、祭坛激活——中心 3×3 变返回门（end_portal），中心柱顶放龙蛋（MC） */
function onDragonKilled(world: World): void {
  dragonState.slain = true;
  endCrystals.length = 0;
  crystalVersion.v++;
  const ay = world.terrain.heightAt(0, 0);
  if (ay < 0) return;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) world.setBlock(dx, ay + 1, dz, K('end_portal'));
  }
  world.setBlock(0, ay + 3, 0, K('dragon_egg')); // 中心柱（ay+2 基岩）顶
}

/** 测试/重置用 */
export function resetEndFight(): void {
  dragonState.slain = false;
  endCrystals.length = 0;
  healAcc = 0;
  crystalVersion.v++;
}
