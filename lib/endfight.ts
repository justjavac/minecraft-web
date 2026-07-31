// 末影龙战：末影水晶（柱顶实体，为龙回血、击毁爆炸）、龙已被击杀标记（IndexedDB 持久化）、击杀结算（龙蛋 + 返回门激活）
// 与 mobs 互有 import（本文件用 setDragonDeathHandler 注入回调、mobs 数组纠错；mobs 用 endCrystals/hitCrystal）——仅函数内使用，模块加载期不触 TDZ

import { BLOCK_BY_KEY } from './blocks';
import { endPillars } from './end';
import { explodeAt } from './explosion';
import { mobs, setDragonDeathHandler } from './mobs';
import { loadDragonSlain, saveDragonSlain } from './persistence';
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

/** 龙是否已被击杀（杀死后重进末地不再生成龙，祭坛保持激活；经 lib/persistence.ts 持久化，刷新页面后读档恢复） */
export const dragonState = { slain: false };

/** 折跃门位置与激活状态（MC：杀龙后在主岛缘生成通外岛的折跃门；世界作用域，init/clear 时重置） */
export const gatewayState = { x: 0.5, y: 0, z: 0.5, active: false };

/** 进入末地时初始化：未屠龙则每根柱顶放一颗水晶；惰性注册击杀回调（避免模块加载期触发循环依赖 TDZ）。
 *  返回的 Promise 在读档恢复屠龙标记后落定：已屠龙则清掉刚放的水晶与调用方在恢复前误生成的龙（World.tsx 不等恢复就生成龙，这里纠错） */
let handlerRegistered = false;
export function initEndFight(world: World): Promise<void> {
  if (!handlerRegistered) {
    setDragonDeathHandler(onDragonKilled);
    handlerRegistered = true;
  }
  endCrystals.length = 0;
  if (dragonState.slain) {
    spawnGateway(world); // 已屠龙：折跃门结构补齐（旧档/重进——同位置同方块，幂等）
    return Promise.resolve();
  }
  for (const p of endPillars(world.seedHash)) {
    endCrystals.push({ x: p.x + 0.5, y: p.top + 1.2, z: p.z + 0.5, alive: true });
  }
  return loadDragonSlain(world.seed).then((slain) => {
    if (!slain || dragonState.slain) return;
    dragonState.slain = true;
    endCrystals.length = 0;
    for (let i = mobs.length - 1; i >= 0; i--) if (mobs[i].type === 'ender_dragon') mobs.splice(i, 1);
  });
}

export function clearEndFight(): void {
  endCrystals.length = 0;
  gatewayState.active = false;
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

/** 杀龙后生成折跃门（MC：主岛缘浮空基岩台 + 门块，通外岛）；位置确定性（重进幂等重建） */
function spawnGateway(world: World): void {
  const gy = Math.max(world.terrain.heightAt(90, 0), world.terrain.heightAt(80, 0), 60) + 8;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) world.setBlock(90 + dx, gy, dz, K('bedrock'));
  }
  world.setBlock(90, gy + 1, 0, K('end_portal'));
  gatewayState.x = 90.5;
  gatewayState.y = gy + 1;
  gatewayState.z = 0.5;
  gatewayState.active = true;
}

/** 击杀结算（damageMob 注入回调）：标记屠龙并写入存档（刷新不复活）、清空水晶、祭坛激活——中心 3×3 变返回门（end_portal），中心柱顶放龙蛋（MC）；主岛缘生成折跃门（MC） */
function onDragonKilled(world: World): void {
  dragonState.slain = true;
  void saveDragonSlain(world.seed);
  endCrystals.length = 0;
  const ay = world.terrain.heightAt(0, 0);
  if (ay < 0) return;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) world.setBlock(dx, ay + 1, dz, K('end_portal'));
  }
  world.setBlock(0, ay + 3, 0, K('dragon_egg')); // 中心柱（ay+2 基岩）顶
  spawnGateway(world);
}

/** 测试/重置用 */
export function resetEndFight(): void {
  dragonState.slain = false;
  endCrystals.length = 0;
  healAcc = 0;
  gatewayState.active = false;
}
