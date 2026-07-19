// 生物系统：类型化怪物（敌对/被动）+ 骷髅箭 + 苦力怕爆炸。纯数据逻辑（不依赖 three，可单测）

import { BLOCKS, GRASS, isWaterId } from './blocks';
import { dayFactorAt, worldClock } from './game';
import { explodeAt } from './explosion';
import { spawnMaterialDrop } from './items';
import { aabbFree, collideAxis } from './physics';
import { raycastBlock } from './raycast';
import { villageCenterNear } from './structures';
import { WORLD_HEIGHT, type World } from './world';

export type MobType = 'zombie' | 'skeleton' | 'spider' | 'creeper' | 'pig' | 'cow' | 'chicken' | 'villager';

export interface MobDef {
  name: string;
  hp: number;
  speed: number;
  hostile: boolean;
  /** 白天自燃（亡灵系） */
  burnsAtDay: boolean;
  /** 近战伤害与判定 */
  damage: number;
  attackRange: number;
  attackCd: number;
  /** 击杀掉落（材料，数量区间） */
  drops: { material: string; count: [number, number] }[];
}

export const MOB_DEFS: Record<MobType, MobDef> = {
  zombie: { name: '僵尸', hp: 20, speed: 2.3, hostile: true, burnsAtDay: true, damage: 4, attackRange: 1.4, attackCd: 1.2, drops: [] },
  skeleton: { name: '骷髅', hp: 20, speed: 2.3, hostile: true, burnsAtDay: true, damage: 3, attackRange: 16, attackCd: 2, drops: [] },
  spider: { name: '蜘蛛', hp: 16, speed: 3.2, hostile: true, burnsAtDay: false, damage: 2, attackRange: 1.4, attackCd: 1, drops: [{ material: 'string', count: [0, 2] }] },
  creeper: { name: '苦力怕', hp: 20, speed: 2.2, hostile: true, burnsAtDay: false, damage: 0, attackRange: 3, attackCd: 1.5, drops: [] },
  pig: { name: '猪', hp: 10, speed: 1.5, hostile: false, burnsAtDay: false, damage: 0, attackRange: 0, attackCd: 0, drops: [{ material: 'raw_pork', count: [1, 3] }] },
  cow: { name: '牛', hp: 10, speed: 1.4, hostile: false, burnsAtDay: false, damage: 0, attackRange: 0, attackCd: 0, drops: [{ material: 'leather', count: [0, 2] }, { material: 'raw_beef', count: [1, 3] }] },
  chicken: { name: '鸡', hp: 4, speed: 1.6, hostile: false, burnsAtDay: false, damage: 0, attackRange: 0, attackCd: 0, drops: [{ material: 'feather', count: [0, 2] }, { material: 'raw_chicken', count: [1, 1] }] },
  villager: { name: '村民', hp: 20, speed: 1.2, hostile: false, burnsAtDay: false, damage: 0, attackRange: 0, attackCd: 0, drops: [] },
};

export interface Mob {
  id: number;
  type: MobType;
  x: number;
  y: number;
  z: number;
  velY: number;
  hp: number;
  attackCd: number;
  onGround: boolean;
  /** 被动游走状态 */
  wanderDir: number;
  wanderTimer: number;
  wanderMoving: boolean;
  /** 受击逃跑 */
  fleeTimer: number;
  fleeFromX: number;
  fleeFromZ: number;
  /** 骷髅射箭冷却 */
  arrowCd: number;
  /** 苦力怕引爆倒计时（<0 未引爆） */
  ignite: number;
  /** 幼体（喂食繁殖产生；体型 0.55，growUp 倒计时结束长成） */
  baby?: boolean;
  /** 幼体成长剩余秒数 */
  growUp?: number;
}

export interface Arrow {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  /** 玩家发射（命中生物而非玩家；缺省为骷髅射向玩家的箭） */
  fromPlayer?: boolean;
}

export const mobs: Mob[] = [];
export const arrows: Arrow[] = [];

const HALF_W = 0.3;
const HEIGHT = 1.8;
const GRAVITY = 26;
const MAX_HOSTILE = 8;
const MAX_PASSIVE = 6;
const SPAWN_MIN = 24;
const SPAWN_MAX = 48;
const SPAWN_INTERVAL = 4; // 秒
const CHASE_RANGE = 40;
const BURN_DAMAGE = 2; // 每秒（白天）

let nextId = 1;
let nextArrowId = 1;
let spawnTimer = 0;


export function clearMobs(): void {
  mobs.length = 0;
  arrows.length = 0;
}

/** 夜晚（昼夜系数低） */
export function isNight(): boolean {
  return dayFactorAt(worldClock.t) < 0.4;
}

function pickSpawnType(night: boolean): MobType {
  const r = Math.random();
  if (night) {
    if (r < 0.4) return 'zombie';
    if (r < 0.65) return 'skeleton';
    if (r < 0.85) return 'spider';
    return 'creeper';
  }
  if (r < 0.4) return 'pig';
  if (r < 0.7) return 'cow';
  return 'chicken';
}

/** 喂食繁殖：在亲代身旁生成同种幼体（90s 长成） */
export function breedMob(parent: Mob): Mob {
  const baby = makeMob(parent.type, parent.x + 0.6, parent.y, parent.z + 0.6);
  baby.baby = true;
  baby.growUp = 90;
  mobs.push(baby);
  return baby;
}

function makeMob(type: MobType, x: number, y: number, z: number): Mob {
  return {
    id: nextId++, type, x, y, z,
    velY: 0, hp: MOB_DEFS[type].hp, attackCd: 0, onGround: false,
    wanderDir: 0, wanderTimer: 0, wanderMoving: false,
    fleeTimer: 0, fleeFromX: 0, fleeFromZ: 0,
    arrowCd: 1, ignite: -1,
  };
}

/** 在玩家周围环形区域找地表生成（夜晚敌对、白天被动且只在草地上；村庄附近生成村民） */
export function trySpawn(world: World, px: number, pz: number): boolean {
  const night = isNight();
  const hostileCount = mobs.filter((m) => MOB_DEFS[m.type].hostile).length;
  const passiveCount = mobs.length - hostileCount;
  if (night && hostileCount >= MAX_HOSTILE) return false;
  if (!night && passiveCount >= MAX_PASSIVE) return false;
  // 白天且靠近村庄中心：70% 生成村民
  const type = !night && villageCenterNear(world.seedHash, world.terrain, px, pz, 48) && Math.random() < 0.7
    ? 'villager'
    : pickSpawnType(night);
  const def = MOB_DEFS[type];
  for (let attempt = 0; attempt < 8; attempt++) {
    const ang = Math.random() * Math.PI * 2;
    const r = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
    const bx = Math.floor(px + Math.cos(ang) * r);
    const bz = Math.floor(pz + Math.sin(ang) * r);
    // 从世界顶向下找第一个实心方块作为地表
    let y = WORLD_HEIGHT - 1;
    while (y > 0 && !BLOCKS[world.getBlock(bx, y, bz)]?.solid) y--;
    if (y <= 0) continue;
    if (isWaterId(world.getBlock(bx, y, bz))) continue; // 不在水面生成
    if (!def.hostile && world.getBlock(bx, y, bz) !== GRASS) continue; // 被动只在草地上
    const sy = y + 1;
    if (!aabbFree(world, bx + 0.5, sy, bz + 0.5, HALF_W, HEIGHT)) continue;
    mobs.push(makeMob(type, bx + 0.5, sy, bz + 0.5));
    return true;
  }
  return false;
}

function spawnArrow(m: Mob, target: { x: number; y: number; z: number }): void {
  const ox = m.x;
  const oy = m.y + 1.5;
  const oz = m.z;
  const dx = target.x - ox;
  const dy = target.y + 1 - oy;
  const dz = target.z - oz;
  const d = Math.max(Math.hypot(dx, dy, dz), 0.01);
  const speed = 12;
  arrows.push({
    id: nextArrowId++,
    x: ox, y: oy, z: oz,
    vx: (dx / d) * speed,
    vy: (dy / d) * speed + d * 0.05, // 抬高补偿重力下坠
    vz: (dz / d) * speed,
    age: 0,
  });
}

/** 玩家射箭（弓）：初速快、无抬升补偿，命中生物扣 9 血 */
export function firePlayerArrow(origin: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }): void {
  const d = Math.max(Math.hypot(dir.x, dir.y, dir.z), 0.01);
  const speed = 22;
  arrows.push({
    id: nextArrowId++,
    x: origin.x, y: origin.y, z: origin.z,
    vx: (dir.x / d) * speed,
    vy: (dir.y / d) * speed,
    vz: (dir.z / d) * speed,
    age: 0,
    fromPlayer: true,
  });
}

/** 苦力怕爆炸：委托共享爆炸逻辑（防爆方块除外，MC 一致） */
function explode(
  world: World,
  m: Mob,
  playerPos: { x: number; y: number; z: number },
  onAttackPlayer: (damage: number) => void,
): void {
  explodeAt(world, m.x, m.y, m.z, playerPos, onAttackPlayer, { radius: 3, maxDamage: 22, hurtRadius: 4.5 });
}

function tickArrows(
  world: World,
  dt: number,
  playerPos: { x: number; y: number; z: number },
  onAttackPlayer: (damage: number) => void,
): void {
  for (let i = arrows.length - 1; i >= 0; i--) {
    const a = arrows[i];
    a.age += dt;
    a.vy -= 4 * dt; // 箭的重力（较轻，保证射程内能命中）
    a.x += a.vx * dt;
    a.y += a.vy * dt;
    a.z += a.vz * dt;
    if (BLOCKS[world.getBlock(Math.floor(a.x), Math.floor(a.y), Math.floor(a.z))]?.solid) {
      arrows.splice(i, 1);
      continue;
    }
    // 玩家射出的箭：命中生物（AABB 粗略判定）
    if (a.fromPlayer) {
      const hitMob = mobs.find(
        (m) =>
          Math.abs(m.x - a.x) < 0.55 &&
          a.y > m.y - 0.2 &&
          a.y < m.y + 2 &&
          Math.abs(m.z - a.z) < 0.55,
      );
      if (hitMob) {
        damageMob(hitMob, 9, { x: a.x - a.vx, z: a.z - a.vz });
        arrows.splice(i, 1);
        continue;
      }
    } else if (
      // 骷髅的箭：命中玩家（AABB 粗略判定）
      Math.abs(playerPos.x - a.x) < 0.5 &&
      a.y > playerPos.y &&
      a.y < playerPos.y + 1.8 &&
      Math.abs(playerPos.z - a.z) < 0.5
    ) {
      onAttackPlayer(3);
      arrows.splice(i, 1);
      continue;
    }
    if (a.age > 10 || a.y < -10) arrows.splice(i, 1);
  }
}

/** 每帧推进：生成/AI/攻击/箭/燃烧/清理 */
export function tickMobs(
  world: World,
  dt: number,
  playerPos: { x: number; y: number; z: number },
  onAttackPlayer: (damage: number) => void,
): void {
  const night = isNight();
  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnTimer = SPAWN_INTERVAL;
    // 夜晚刷敌对（60%），白天刷被动（20%）
    if (night ? Math.random() < 0.6 : Math.random() < 0.2) trySpawn(world, playerPos.x, playerPos.z);
  }

  tickArrows(world, dt, playerPos, onAttackPlayer);

  for (let i = mobs.length - 1; i >= 0; i--) {
    const m = mobs[i];
    const def = MOB_DEFS[m.type];
    // 幼体成长
    if (m.baby && m.growUp !== undefined) {
      m.growUp -= dt;
      if (m.growUp <= 0) {
        m.baby = false;
        m.growUp = undefined;
      }
    }
    // 白天自燃
    if (!night && def.burnsAtDay) {
      m.hp -= BURN_DAMAGE * dt;
      if (m.hp <= 0) {
        mobs.splice(i, 1);
        continue;
      }
    }

    const dx = playerPos.x - m.x;
    const dz = playerPos.z - m.z;
    const dist = Math.hypot(dx, dz);
    let mx = 0;
    let mz = 0;

    if (m.fleeTimer > 0) {
      // 受击逃跑
      m.fleeTimer -= dt;
      const fx = m.x - m.fleeFromX;
      const fz = m.z - m.fleeFromZ;
      const fd = Math.hypot(fx, fz);
      if (fd > 0.01) {
        mx = (fx / fd) * def.speed * 1.5;
        mz = (fz / fd) * def.speed * 1.5;
      }
    } else if (def.hostile && (m.type !== 'spider' || night)) {
      // 敌对 AI（蜘蛛白天中立）
      if (m.type === 'skeleton') {
        // 保持 8-16 距离并射箭
        if (dist > 14 && dist > 0.01) {
          mx = (dx / dist) * def.speed;
          mz = (dz / dist) * def.speed;
        } else if (dist < 8 && dist > 0.01) {
          mx = (-dx / dist) * def.speed;
          mz = (-dz / dist) * def.speed;
        }
        m.arrowCd -= dt;
        if (dist < 16 && m.arrowCd <= 0) {
          m.arrowCd = def.attackCd;
          spawnArrow(m, playerPos);
        }
      } else if (m.type === 'creeper') {
        if (m.ignite >= 0) {
          // 引爆中：站住不动，玩家逃远则解除
          m.ignite -= dt;
          if (dist > 7) m.ignite = -1;
          else if (m.ignite <= 0) {
            explode(world, m, playerPos, onAttackPlayer);
            mobs.splice(i, 1);
            continue;
          }
        } else if (dist > 0.01 && dist < CHASE_RANGE) {
          mx = (dx / dist) * def.speed;
          mz = (dz / dist) * def.speed;
          if (dist < 3) m.ignite = 1.5;
        }
      } else {
        if (dist > 0.01 && dist < CHASE_RANGE) {
          mx = (dx / dist) * def.speed;
          mz = (dz / dist) * def.speed;
        }
        m.attackCd -= dt;
        if (m.attackCd <= 0 && dist < def.attackRange && Math.abs(playerPos.y - m.y) < 2) {
          m.attackCd = def.attackCd;
          onAttackPlayer(def.damage);
        }
      }
    } else {
      // 被动游走：周期性换向或停下
      m.wanderTimer -= dt;
      if (m.wanderTimer <= 0) {
        m.wanderTimer = 2 + Math.random() * 4;
        m.wanderMoving = Math.random() < 0.6;
        m.wanderDir = Math.random() * Math.PI * 2;
      }
      if (m.wanderMoving) {
        mx = Math.cos(m.wanderDir) * def.speed * 0.5;
        mz = Math.sin(m.wanderDir) * def.speed * 0.5;
      }
    }

    // 移动 + 碰撞（与玩家同一套物理）
    m.x += mx * dt;
    const hitX = collideAxis(world, m, 0, mx * dt, HALF_W, HEIGHT);
    m.z += mz * dt;
    const hitZ = collideAxis(world, m, 2, mz * dt, HALF_W, HEIGHT);
    // 被 1 格障碍挡住时跳起
    if ((hitX || hitZ) && m.onGround) m.velY = 8.5;

    m.velY = Math.max(m.velY - GRAVITY * dt, -50);
    const dy = m.velY * dt;
    m.y += dy;
    const hitY = collideAxis(world, m, 1, dy, HALF_W, HEIGHT);
    if (hitY) {
      if (dy < 0) m.onGround = true;
      m.velY = 0;
    } else if (dy !== 0) {
      m.onGround = false;
    }

    if (m.y < -10) {
      mobs.splice(i, 1);
    }
  }
}

/** 玩家攻击判定：视线附近 reach 内最近的生物（投影距离 + 横向容差 + 墙体遮挡检查） */
export function mobInReach(
  world: World,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  reach: number,
): Mob | null {
  let best: Mob | null = null;
  let bestT = reach;
  for (const m of mobs) {
    const cx = m.x - ox;
    const cy = m.y + 0.9 - oy; // 身体中心
    const cz = m.z - oz;
    const t = cx * dx + cy * dy + cz * dz;
    if (t < 0 || t > bestT) continue;
    const px = ox + dx * t;
    const py = oy + dy * t;
    const pz = oz + dz * t;
    if (Math.hypot(m.x - px, m.y + 0.9 - py, m.z - pz) < 0.9) {
      best = m;
      bestT = t;
    }
  }
  // 射线在到达生物前先命中实心方块 → 隔墙打不到（与骷髅箭撞墙一致）
  if (best && raycastBlock(world, ox, oy, oz, dx, dy, dz, bestT)) return null;
  return best;
}

/** 对生物造成伤害（attackerPos 用于被动生物逃跑方向），返回是否击杀 */
export function damageMob(mob: Mob, damage: number, attackerPos?: { x: number; z: number }): boolean {
  mob.hp -= damage;
  if (mob.hp > 0) {
    // 被动生物受击逃跑
    if (!MOB_DEFS[mob.type].hostile && attackerPos) {
      mob.fleeTimer = 4;
      mob.fleeFromX = attackerPos.x;
      mob.fleeFromZ = attackerPos.z;
    }
    return false;
  }
  // 击杀掉落（数量在区间内随机）
  for (const drop of MOB_DEFS[mob.type].drops) {
    const count = drop.count[0] + Math.floor(Math.random() * (drop.count[1] - drop.count[0] + 1));
    if (count > 0) spawnMaterialDrop(drop.material, mob.x, mob.y + 0.3, mob.z, count);
  }
  const i = mobs.indexOf(mob);
  if (i >= 0) mobs.splice(i, 1);
  return true;
}
