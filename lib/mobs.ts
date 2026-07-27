// 生物系统：类型化怪物（敌对/被动）+ 骷髅箭 + 苦力怕爆炸。纯数据逻辑（不依赖 three，可单测）

import { AIR, BLOCK_BY_KEY, BLOCKS, GRASS, isWaterId } from './blocks';
import type { Biome } from './noise';
import { dayFactorAt, pearlTeleport, survivalStats, worldClock } from './game';
import { useGameStore } from './store';
import { XP_MOB } from './xp';
import { explodeAt } from './explosion';
import { spawnBlockDrop, spawnMaterialDrop } from './items';
import { fortressNear } from './netherstructures';
import { aabbFree, collideAxis } from './physics';
import { raycastBlock } from './raycast';
import { villageCenterNear } from './structures';
import { WORLD_HEIGHT, type World } from './world';

export type MobType = 'zombie' | 'skeleton' | 'spider' | 'creeper' | 'pig' | 'cow' | 'chicken' | 'villager' | 'mooshroom' | 'zombified_piglin' | 'blaze' | 'wither_skeleton' | 'ghast' | 'sheep' | 'wolf' | 'enderman';

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
  skeleton: { name: '骷髅', hp: 20, speed: 2.3, hostile: true, burnsAtDay: true, damage: 3, attackRange: 16, attackCd: 2, drops: [{ material: 'bone', count: [0, 2] }, { material: 'arrow', count: [0, 2] }] },
  spider: { name: '蜘蛛', hp: 16, speed: 3.2, hostile: true, burnsAtDay: false, damage: 2, attackRange: 1.4, attackCd: 1, drops: [{ material: 'string', count: [0, 2] }] },
  creeper: { name: '苦力怕', hp: 20, speed: 2.2, hostile: true, burnsAtDay: false, damage: 0, attackRange: 3, attackCd: 1.5, drops: [{ material: 'gunpowder', count: [0, 2] }] },
  pig: { name: '猪', hp: 10, speed: 1.5, hostile: false, burnsAtDay: false, damage: 0, attackRange: 0, attackCd: 0, drops: [{ material: 'raw_pork', count: [1, 3] }] },
  cow: { name: '牛', hp: 10, speed: 1.4, hostile: false, burnsAtDay: false, damage: 0, attackRange: 0, attackCd: 0, drops: [{ material: 'leather', count: [0, 2] }, { material: 'raw_beef', count: [1, 3] }] },
  chicken: { name: '鸡', hp: 4, speed: 1.6, hostile: false, burnsAtDay: false, damage: 0, attackRange: 0, attackCd: 0, drops: [{ material: 'feather', count: [0, 2] }, { material: 'raw_chicken', count: [1, 1] }] },
  villager: { name: '村民', hp: 20, speed: 1.2, hostile: false, burnsAtDay: false, damage: 0, attackRange: 0, attackCd: 0, drops: [] },
  mooshroom: { name: '蘑菇牛', hp: 10, speed: 1.4, hostile: false, burnsAtDay: false, damage: 0, attackRange: 0, attackCd: 0, drops: [{ material: 'leather', count: [0, 2] }, { material: 'raw_beef', count: [1, 3] }] },
  // 僵尸猪灵：中立敌对——不被激怒时不攻击；受伤则群体仇恨（MC 下界特色）
  zombified_piglin: { name: '僵尸猪灵', hp: 20, speed: 2.4, hostile: true, burnsAtDay: false, damage: 4, attackRange: 1.4, attackCd: 1.2, drops: [{ material: 'gold_ingot', count: [0, 1] }, { material: 'bone', count: [0, 1] }] },
  // 烈焰人：悬浮飞行，远程火球（MC 下界堡垒标志怪）
  blaze: { name: '烈焰人', hp: 20, speed: 2.0, hostile: true, burnsAtDay: false, damage: 4, attackRange: 14, attackCd: 2.5, drops: [{ material: 'blaze_rod', count: [0, 1] }] },
  // 凋灵骷髅：堡垒近战，命中附加凋零 DOT（MC）
  wither_skeleton: { name: '凋灵骷髅', hp: 20, speed: 2.6, hostile: true, burnsAtDay: false, damage: 5, attackRange: 1.4, attackCd: 1.2, drops: [{ material: 'coal', count: [0, 1] }, { material: 'bone', count: [0, 2] }] },
  // 恶魂：高空悬浮，远程爆炸火球（MC 下界空中巨怪）
  ghast: { name: '恶魂', hp: 10, speed: 0.8, hostile: true, burnsAtDay: false, damage: 0, attackRange: 40, attackCd: 3, drops: [{ material: 'ghast_tear', count: [0, 1] }, { material: 'gunpowder', count: [0, 1] }] },
  // 羊：毛色随机（掉落同色羊毛；剪刀剪毛可再生，见 tickMobs 吃草）
  sheep: { name: '羊', hp: 8, speed: 1.2, hostile: false, burnsAtDay: false, damage: 0, attackRange: 0, attackCd: 0, drops: [] },
  // 狼：野生中立（被打群体仇恨才攻击；hostile 走 aggro 门控）；骨头驯服后跟随玩家并护主
  wolf: { name: '狼', hp: 8, speed: 2.6, hostile: true, burnsAtDay: false, damage: 3, attackRange: 1.4, attackCd: 1, drops: [],
  },
  // 末影人：高个传送怪——对视/受击激怒，被追/受伤即瞬移（MC 标志）；水触即伤
  enderman: { name: '末影人', hp: 40, speed: 3.2, hostile: true, burnsAtDay: false, damage: 4, attackRange: 1.6, attackCd: 1, drops: [{ material: 'ender_pearl', count: [0, 1] }],
  },
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
  /** 恋爱剩余秒数（喂食后进入；与同种恋爱个体靠近才产仔） */
  loveTimer?: number;
  /** 繁殖冷却剩余秒数 */
  breedCd?: number;
  /** 僵尸猪灵仇恨剩余秒数（>0 时攻击玩家；群体传染） */
  aggroTimer?: number;
  /** 烈焰人悬浮起伏相位 */
  bob?: number;
  /** 羊：毛色（wool 颜色 key）与剪毛状态/吃草计时 */
  woolColor?: string;
  sheared?: boolean;
  grazeTimer?: number;
  /** 狼：已驯服（跟随玩家并护主） */
  tamed?: boolean;
  /** 末影人：传送计时（被追/受伤触发瞬移） */
  teleportTimer?: number;
  /** 村庄锚点（村民不远离村庄；生成时写入） */
  homeX?: number;
  homeZ?: number;
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
  /** 烈焰人火球（更大更亮，命中伤害 4）或恶魂爆裂火球（命中/撞墙爆炸）或末影珍珠（落点传送） */
  kind?: 'fireball' | 'ghast' | 'pearl';
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

/** 白天自燃判定：头顶露天（y+2 向上无遮挡）且头部不在水中（树荫/洞穴/水下不烧，MC 一致） */
function exposedToSky(world: World, m: Mob): boolean {
  const bx = Math.floor(m.x);
  const bz = Math.floor(m.z);
  if (isWaterId(world.getBlock(bx, Math.floor(m.y) + 1, bz))) return false;
  for (let y = Math.floor(m.y) + 2; y < WORLD_HEIGHT; y++) {
    if (world.getBlock(bx, y, bz) !== AIR) return false;
  }
  return true;
}

function pickSpawnType(night: boolean, biome?: Biome): MobType {
  const r = Math.random();
  if (night) {
    if (r < 0.37) return 'zombie';
    if (r < 0.62) return 'skeleton';
    if (r < 0.82) return 'spider';
    if (r < 0.9) return 'creeper';
    return 'enderman'; // 夜晚稀有末影人（MC）
  }
  // 白天被动：林地出狼、平原/热带草原出羊（MC 分布）
  const foresty = biome === 'forest' || biome === 'taiga' || biome === 'birch_forest' || biome === 'dark_forest' || biome === 'snowy';
  if (foresty && r < 0.25) return 'wolf';
  if (!foresty && r < 0.25) return 'sheep';
  if (r < 0.45) return 'pig';
  if (r < 0.75) return 'cow';
  if (r < 0.9) return 'chicken';
  return foresty ? 'wolf' : 'sheep';
}

/** 喂食繁殖：在亲代身旁生成同种幼体（90s 长成；产仔掉 1-7 经验，MC） */
export function breedMob(parent: Mob): Mob {
  const baby = makeMob(parent.type, parent.x + 0.6, parent.y, parent.z + 0.6);
  baby.baby = true;
  baby.growUp = 90;
  useGameStore.getState().addXp(1 + Math.floor(Math.random() * 7));
  mobs.push(baby);
  return baby;
}

/** 各物种的繁殖食物（材料名；MC：牛/猪/羊吃小麦，鸡吃种子） */
export const BREED_FOOD: Partial<Record<MobType, string>> = {
  cow: 'wheat',
  pig: 'wheat',
  sheep: 'wheat',
  chicken: 'wheat_seeds',
};

/** 喂食：进入 8s 恋爱模式并回复 4 血（MC 喂食回 2 心） */
export function feedMob(m: Mob): void {
  m.loveTimer = 8;
  m.hp = Math.min(MOB_DEFS[m.type].hp, m.hp + 4);
}

/** 羊毛色按 MC 分布（白 82 / 黑灰各 5 / 淡灰 5 / 棕 3 / 粉 1） */
function pickWoolColor(): string {
  const r = Math.random();
  if (r < 0.82) return 'white';
  if (r < 0.87) return 'black';
  if (r < 0.92) return 'gray';
  if (r < 0.97) return 'light_gray';
  if (r < 0.99) return 'brown';
  return 'pink';
}

/** 羊毛方块 id（颜色 key → *_wool 方块） */
export function woolBlockId(color: string): number {
  return BLOCK_BY_KEY[`${color}_wool`]?.id ?? BLOCK_BY_KEY.white_wool.id;
}

function makeMob(type: MobType, x: number, y: number, z: number): Mob {
  const mob: Mob = {
    id: nextId++, type, x, y, z,
    velY: 0, hp: MOB_DEFS[type].hp, attackCd: 0, onGround: false,
    wanderDir: 0, wanderTimer: 0, wanderMoving: false,
    fleeTimer: 0, fleeFromX: 0, fleeFromZ: 0,
    arrowCd: 1, ignite: -1,
  };
  if (type === 'sheep') mob.woolColor = pickWoolColor();
  return mob;
}

/** 在玩家周围环形区域找地表生成（夜晚敌对、白天被动且只在草地上；村庄附近生成村民；蘑菇岛只出蘑菇牛且夜晚不刷怪） */
export function trySpawn(world: World, px: number, pz: number): boolean {
  const night = isNight();
  // 下界：只刷僵尸猪灵（下界岩上 2-3 只成群；不被激怒不攻击）
  if (world.terrain.kind === 'nether') return trySpawnNether(world, px, pz);
  const hostileCount = mobs.filter((m) => MOB_DEFS[m.type].hostile).length;
  const passiveCount = mobs.length - hostileCount;
  if (night && hostileCount >= MAX_HOSTILE) return false;
  if (!night && passiveCount >= MAX_PASSIVE) return false;
  // 白天且靠近村庄中心：70% 生成村民（锚定村庄，不远离）
  const village = !night ? villageCenterNear(world.seedHash, world.terrain, px, pz, 48) : null;
  const villageRoll = village !== null && Math.random() < 0.7;
  for (let attempt = 0; attempt < 8; attempt++) {
    const ang = Math.random() * Math.PI * 2;
    const r = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
    const bx = Math.floor(px + Math.cos(ang) * r);
    const bz = Math.floor(pz + Math.sin(ang) * r);
    // 未加载的 chunk 不刷：读块会触发隐式全量生成（卡顿）
    if (!world.chunks.has(`${bx >> 4},${bz >> 4}`)) continue;
    // 群系规则（MC）：蘑菇岛不刷敌对生物，被动只出蘑菇牛；林地出狼、平原出羊
    const biome = world.terrain.biomeAt(bx, bz);
    if (biome === 'mushroom_fields' && night) return false;
    const wantType = biome === 'mushroom_fields' ? 'mooshroom' : villageRoll ? 'villager' : pickSpawnType(night, biome);
    const wantDef = MOB_DEFS[wantType];
    // 从世界顶向下找第一个实心方块作为地表
    let y = WORLD_HEIGHT - 1;
    while (y > 0 && !BLOCKS[world.getBlock(bx, y, bz)]?.solid) y--;
    if (y <= 0) continue;
    if (isWaterId(world.getBlock(bx, y, bz))) continue; // 不在水面生成
    // 被动只在草地上（蘑菇牛在菌丝上）
    if (!wantDef.hostile) {
      const ground = world.getBlock(bx, y, bz);
      if (wantType === 'mooshroom' ? BLOCKS[ground]?.key !== 'mycelium' : ground !== GRASS) continue;
    }
    const sy = y + 1;
    if (!aabbFree(world, bx + 0.5, sy, bz + 0.5, HALF_W, HEIGHT)) continue;
    const mob = makeMob(wantType, bx + 0.5, sy, bz + 0.5);
    if (mob.type === 'villager' && village) {
      mob.homeX = village.x;
      mob.homeZ = village.z;
    }
    mobs.push(mob);
    return true;
  }
  return false;
}

/** 下界刷怪：僵尸猪灵 2-3 只成群（下界岩/灵魂沙表面、岩浆海以上；MC 成群出没）；堡垒附近出凋灵骷髅/烈焰人 */
function trySpawnNether(world: World, px: number, pz: number): boolean {
  const hostileCount = mobs.filter((m) => MOB_DEFS[m.type].hostile).length;
  if (hostileCount >= MAX_HOSTILE) return false;
  for (let attempt = 0; attempt < 8; attempt++) {
    const ang = Math.random() * Math.PI * 2;
    const r = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
    const bx = Math.floor(px + Math.cos(ang) * r);
    const bz = Math.floor(pz + Math.sin(ang) * r);
    if (!world.chunks.has(`${bx >> 4},${bz >> 4}`)) continue;
    let y = WORLD_HEIGHT - 8;
    while (y > 32 && !BLOCKS[world.getBlock(bx, y, bz)]?.solid) y--;
    if (y <= 32) continue; // 岩浆海面上方
    const ground = world.getBlock(bx, y, bz);
    const gk = BLOCKS[ground]?.key;
    // 可生成地表（MC：下界岩/灵魂沙土/菌岩/黑石/玄武岩/下界砖）
    if (gk !== 'netherrack' && gk !== 'soul_sand' && gk !== 'nether_bricks' && gk !== 'blackstone' && gk !== 'basalt' && gk !== 'warped_nylium' && gk !== 'crimson_nylium' && gk !== 'soul_soil') continue;
    if (isWaterId(ground) || BLOCKS[ground]?.lava) continue;
    const sy = y + 1;
    if (!aabbFree(world, bx + 0.5, sy, bz + 0.5, HALF_W, HEIGHT)) continue;
    // 堡垒附近（48 格）：凋灵骷髅/烈焰人为主；灵魂沙谷恶魂成群（MC）；诡异森林末影人成群（MC）；远处猪灵成群、少量烈焰人与恶魂
    const roll = Math.random();
    const biome = world.terrain.biomeAt(bx, bz);
    const type: MobType = fortressNear(world.seedHash, world.terrain, bx, bz, 48)
      ? roll < 0.5
        ? 'wither_skeleton'
        : roll < 0.72
          ? 'blaze'
          : roll < 0.9
            ? 'zombified_piglin'
            : 'ghast'
      : biome === 'soul_sand_valley'
        ? roll < 0.5
          ? 'ghast'
          : roll < 0.75
            ? 'zombified_piglin'
            : 'blaze'
        : biome === 'warped_forest'
          ? roll < 0.7
            ? 'enderman'
            : 'zombified_piglin'
          : roll < 0.7
            ? 'zombified_piglin'
            : roll < 0.88
              ? 'blaze'
              : 'ghast';
    if (type === 'zombified_piglin') {
      const pack = 2 + Math.floor(Math.random() * 2); // 2-3 只
      for (let i = 0; i < pack; i++) {
        mobs.push(makeMob(type, bx + 0.5 + (Math.random() - 0.5) * 2, sy, bz + 0.5 + (Math.random() - 0.5) * 2));
      }
    } else if (type === 'ghast') {
      // 恶魂需要上方空域（悬浮生成）
      if (aabbFree(world, bx + 0.5, sy + 2, bz + 0.5, 1.2, 2.5)) mobs.push(makeMob(type, bx + 0.5, sy + 2, bz + 0.5));
    } else {
      mobs.push(makeMob(type, bx + 0.5, sy, bz + 0.5));
    }
    return true;
  }
  return false;
}

// 末影人：瞬移（MC 标志）与对视激怒

/** 末影人瞬移：±8 格内找安全落点（实心地面 + 上方 3 格空、非岩浆水），nearX/Z 给定则向其附近瞬移 */
export function teleportEnderman(world: World, m: Mob, nearX?: number, nearZ?: number): boolean {
  for (let i = 0; i < 8; i++) {
    const cx = (nearX ?? m.x) + (Math.random() - 0.5) * 16;
    const cz = (nearZ ?? m.z) + (Math.random() - 0.5) * 16;
    const bx = Math.floor(cx);
    const bz = Math.floor(cz);
    if (!world.chunks.has(`${bx >> 4},${bz >> 4}`)) continue;
    let y = Math.min(WORLD_HEIGHT - 5, Math.floor(m.y) + 5);
    while (y > 1 && !BLOCKS[world.getBlock(bx, y, bz)]?.solid) y--;
    if (y <= 1) continue;
    const ground = world.getBlock(bx, y, bz);
    if (BLOCKS[ground]?.lava || isWaterId(ground)) continue;
    const b1 = world.getBlock(bx, y + 1, bz);
    const b2 = world.getBlock(bx, y + 2, bz);
    const b3 = world.getBlock(bx, y + 3, bz);
    if (BLOCKS[b1]?.solid || BLOCKS[b2]?.solid || BLOCKS[b3]?.solid) continue;
    if (isWaterId(b1) || BLOCKS[b1]?.lava) continue;
    m.x = bx + 0.5;
    m.y = y + 1;
    m.z = bz + 0.5;
    m.velY = 0;
    return true;
  }
  return false;
}

/** 玩家视线是否盯在末影人身上（Player 每秒调用；盯上即激怒——MC 对视规则） */
export function checkEndermanStare(
  world: World,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
): boolean {
  const mob = mobInReach(world, ox, oy, oz, dx, dy, dz, 24);
  if (mob?.type === 'enderman' && (mob.aggroTimer ?? 0) <= 0) {
    mob.aggroTimer = 30;
    return true;
  }
  return false;
}

function spawnArrow(m: Mob, target: { x: number; y: number; z: number }, kind?: 'fireball' | 'ghast'): void {
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
    vy: (dy / d) * speed + (kind ? 0 : d * 0.05), // 箭抬高补偿重力下坠；火球类直线飞行
    vz: (dz / d) * speed,
    age: 0,
    kind,
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

/** 玩家射末影珍珠：弧线投掷，落点传送玩家（lib/game.ts pearlTeleport 消费） */
export function fireEnderPearl(origin: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }): void {
  const d = Math.max(Math.hypot(dir.x, dir.y, dir.z), 0.01);
  const speed = 15;
  arrows.push({
    id: nextArrowId++,
    x: origin.x, y: origin.y, z: origin.z,
    vx: (dir.x / d) * speed,
    vy: (dir.y / d) * speed + 1.5, // 抬高成弧（MC 珍珠抛物线）
    vz: (dir.z / d) * speed,
    age: 0,
    fromPlayer: true,
    kind: 'pearl',
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
    if (!a.kind || a.kind === 'pearl') a.vy -= 4 * dt; // 箭与珍珠的重力（较轻，保证射程内能命中）；火球类无重力（MC）
    const nx = a.x + a.vx * dt;
    const ny = a.y + a.vy * dt;
    const nz = a.z + a.vz * dt;
    // 目标位置 chunk 未加载：直接移除（读块会触发隐式全量生成，卡顿）
    if (!world.chunks.has(`${Math.floor(nx) >> 4},${Math.floor(nz) >> 4}`)) {
      arrows.splice(i, 1);
      continue;
    }
    a.x = nx;
    a.y = ny;
    a.z = nz;
    if (BLOCKS[world.getBlock(Math.floor(a.x), Math.floor(a.y), Math.floor(a.z))]?.solid) {
      // 恶魂爆裂火球：撞墙即爆（MC）
      if (a.kind === 'ghast') explodeAt(world, a.x, a.y, a.z, playerPos, onAttackPlayer, { radius: 2, maxDamage: 10, hurtRadius: 3 });
      // 末影珍珠：落点传送玩家 + 2 点伤害（MC）
      if (a.kind === 'pearl') {
        pearlTeleport.pending = { x: Math.floor(a.x) + 0.5, y: Math.ceil(a.y) + 0.01, z: Math.floor(a.z) + 0.5 };
        onAttackPlayer(2);
      }
      arrows.splice(i, 1);
      continue;
    }
    // 玩家射出的箭/珍珠：命中生物（AABB 粗略判定；珍珠不伤人、命中即传送到生物处）
    if (a.fromPlayer) {
      const hitMob = mobs.find(
        (m) =>
          Math.abs(m.x - a.x) < 0.55 &&
          a.y > m.y - 0.2 &&
          a.y < m.y + 2 &&
          Math.abs(m.z - a.z) < 0.55,
      );
      if (hitMob) {
        if (a.kind === 'pearl') {
          pearlTeleport.pending = { x: Math.floor(a.x) + 0.5, y: Math.ceil(a.y) + 0.01, z: Math.floor(a.z) + 0.5 };
          onAttackPlayer(2);
        } else {
          damageMob(hitMob, 9, { x: a.x - a.vx, z: a.z - a.vz });
        }
        arrows.splice(i, 1);
        continue;
      }
    } else if (
      // 骷髅的箭/烈焰人的火球/恶魂的爆裂球：命中玩家（AABB 粗略判定；爆裂球命中即爆）
      Math.abs(playerPos.x - a.x) < 0.5 &&
      a.y > playerPos.y &&
      a.y < playerPos.y + 1.8 &&
      Math.abs(playerPos.z - a.z) < 0.5
    ) {
      if (a.kind === 'ghast') explodeAt(world, a.x, a.y, a.z, playerPos, onAttackPlayer, { radius: 2, maxDamage: 10, hurtRadius: 3 });
      else onAttackPlayer(a.kind === 'fireball' ? 4 : 3);
      arrows.splice(i, 1);
      continue;
    }
    if (a.age > 10 || a.y < -10) arrows.splice(i, 1);
  }
}

/** 每帧推进：生成/AI/攻击/箭/燃烧/清理；lureFood = 玩家手持的繁殖食物（引诱用） */
export function tickMobs(
  world: World,
  dt: number,
  playerPos: { x: number; y: number; z: number },
  onAttackPlayer: (damage: number) => void,
  lureFood?: string | null,
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
    // 恋爱/繁殖冷却倒数；僵尸猪灵仇恨倒数
    if (m.loveTimer !== undefined && m.loveTimer > 0) m.loveTimer -= dt;
    if (m.breedCd !== undefined && m.breedCd > 0) m.breedCd -= dt;
    if (m.aggroTimer !== undefined && m.aggroTimer > 0) m.aggroTimer -= dt;
    // 白天自燃（需露天且头部不在水中）
    if (!night && def.burnsAtDay && exposedToSky(world, m)) {
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

    // 末影人水触掉血（MC：不论是否激怒；掉血即激怒并瞬移逃离）
    if (m.type === 'enderman' && isWaterId(world.getBlock(Math.floor(m.x), Math.floor(m.y), Math.floor(m.z)))) {
      damageMob(m, 2 * dt, undefined, 0, world);
      if (m.hp <= 0) continue;
      if ((m.teleportTimer ?? 0) <= 0) {
        teleportEnderman(world, m);
        m.teleportTimer = 1;
      }
    }

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
    } else if (def.hostile && (m.type !== 'spider' || night) && (m.type !== 'zombified_piglin' || (m.aggroTimer ?? 0) > 0) && (m.type !== 'wolf' || (!m.tamed && (m.aggroTimer ?? 0) > 0)) && (m.type !== 'enderman' || (m.aggroTimer ?? 0) > 0)) {
      // 敌对 AI（蜘蛛白天中立；僵尸猪灵/野狼/末影人未被激怒时中立）
      if (m.type === 'enderman') {
        // 末影人：高速追击 + 近身/受击瞬移闪避 + 定期瞬移逼近（MC）
        if (dist < 4) {
          // 近身即瞬移闪避（MC）
          if ((m.teleportTimer ?? 0) <= 0) {
            teleportEnderman(world, m);
            m.teleportTimer = 2;
          }
        } else {
          if (dist > 0.01 && dist < CHASE_RANGE) {
            mx = (dx / dist) * def.speed;
            mz = (dz / dist) * def.speed;
          }
          // 远处定期瞬移逼近玩家（MC）
          m.teleportTimer = (m.teleportTimer ?? 4) - dt;
          if (m.teleportTimer <= 0 && dist > 8) {
            teleportEnderman(world, m, playerPos.x, playerPos.z);
            m.teleportTimer = 3 + Math.random() * 3;
          }
        }
        m.attackCd -= dt;
        if (m.attackCd <= 0 && dist < def.attackRange && Math.abs(playerPos.y - m.y) < 2) {
          m.attackCd = def.attackCd;
          onAttackPlayer(def.damage);
        }
      } else if (m.type === 'ghast') {        // 恶魂：高空慢漂移，40 格内射爆裂火球（MC）
        if (dist > 30 && dist > 0.01) {
          mx = (dx / dist) * def.speed;
          mz = (dz / dist) * def.speed;
        } else if (dist < 16 && dist > 0.01) {
          mx = (-dx / dist) * def.speed;
          mz = (-dz / dist) * def.speed;
        }
        m.arrowCd -= dt;
        if (dist < def.attackRange && m.arrowCd <= 0) {
          m.arrowCd = def.attackCd;
          spawnArrow(m, playerPos, 'ghast');
        }
      } else if (m.type === 'skeleton' || m.type === 'blaze') {
        // 保持 8-14 距离并远程射击（骷髅箭 / 烈焰人火球）
        if (dist > 14 && dist > 0.01) {
          mx = (dx / dist) * def.speed;
          mz = (dz / dist) * def.speed;
        } else if (dist < 8 && dist > 0.01) {
          mx = (-dx / dist) * def.speed;
          mz = (-dz / dist) * def.speed;
        }
        m.arrowCd -= dt;
        if (dist < def.attackRange && m.arrowCd <= 0) {
          m.arrowCd = def.attackCd;
          spawnArrow(m, playerPos, m.type === 'blaze' ? 'fireball' : undefined);
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
          // 凋灵骷髅命中附加凋零 DOT（MC 凋零效果 5 秒）
          if (m.type === 'wither_skeleton') survivalStats.wither = 5;
          onAttackPlayer(def.damage);
        }
      }
    } else {
      // 驯服的狼：护主（攻击玩家刚打过的目标）→ 跟随（远了传送跟上，MC）
      let handled = false;
      if (m.type === 'wolf' && m.tamed) {
        handled = true;
        const target =
          lastPlayerTarget.mob && lastPlayerTarget.mob !== m && lastPlayerTarget.mob.hp > 0 && performance.now() / 1000 - lastPlayerTarget.at < 10
            ? lastPlayerTarget.mob
            : null;
        if (target) {
          const tx = target.x - m.x;
          const tz2 = target.z - m.z;
          const td = Math.hypot(tx, tz2);
          if (td > 0.01 && td < 40) {
            mx = (tx / td) * def.speed;
            mz = (tz2 / td) * def.speed;
          }
          m.attackCd -= dt;
          if (m.attackCd <= 0 && td < def.attackRange && Math.abs(target.y - m.y) < 2) {
            m.attackCd = def.attackCd;
            damageMob(target, def.damage, undefined);
          }
        } else if (dist > 12) {
          // 传送跟上（MC：距离过远直接瞬移到玩家身边）
          m.x = playerPos.x + 1;
          m.z = playerPos.z + 1;
          m.y = playerPos.y;
          m.velY = 0;
        } else if (dist > 3 && dist > 0.01) {
          mx = (dx / dist) * def.speed;
          mz = (dz / dist) * def.speed;
        }
      }
      // 羊吃草长毛（MC：剪毛后吃草再生，草方块变泥土）
      if (m.type === 'sheep' && m.sheared) {
        m.grazeTimer = (m.grazeTimer ?? 30 + Math.random() * 30) - dt;
        if (m.grazeTimer <= 0) {
          const bx2 = Math.floor(m.x);
          const by2 = Math.floor(m.y) - 1;
          const bz2 = Math.floor(m.z);
          if (world.getBlock(bx2, by2, bz2) === GRASS) {
            world.setBlock(bx2, by2, bz2, BLOCK_BY_KEY.dirt.id);
            m.sheared = false;
          }
          m.grazeTimer = 30 + Math.random() * 30;
        }
      }
      if (handled) {
        // 驯狼分支已处理移动
      } else if ((m.loveTimer ?? 0) > 0) {
        // 恋爱中：寻找 8 格内同种恋爱个体，走过去；贴近则产仔（双方进 60s 冷却）
        let partner: Mob | null = null;
        for (const other of mobs) {
          if (other === m || other.type !== m.type || other.baby || (other.loveTimer ?? 0) <= 0) continue;
          const od = Math.hypot(other.x - m.x, other.z - m.z);
          if (od > 8) continue;
          if ((other.breedCd ?? 0) > 0 || (m.breedCd ?? 0) > 0) continue;
          partner = other;
          break;
        }
        if (partner) {
          const px = partner.x - m.x;
          const pz = partner.z - m.z;
          const pd = Math.hypot(px, pz);
          if (pd > 1.2) {
            mx = (px / pd) * def.speed;
            mz = (pz / pd) * def.speed;
          } else {
            // 配对成功：产仔并清恋爱、进冷却
            partner.loveTimer = 0;
            m.loveTimer = 0;
            partner.breedCd = 60;
            m.breedCd = 60;
            if (mobs.length < 40) breedMob(m);
          }
        }
      } else if (
        // 持食引诱：玩家手持该物种食物时跟着走（MC 诱饵）
        lureFood && BREED_FOOD[m.type] === lureFood && dist < 10 && dist > 1.6
      ) {
        mx = (dx / dist) * def.speed;
        mz = (dz / dist) * def.speed;
      } else if (m.type === 'villager' && m.homeX !== undefined && m.homeZ !== undefined) {
        // 村民锚定村庄：走太远就回家，近处正常游走
        const hx = m.homeX - m.x;
        const hz = m.homeZ - m.z;
        const hd = Math.hypot(hx, hz);
        if (hd > 16) {
          mx = (hx / hd) * def.speed;
          mz = (hz / hd) * def.speed;
        } else {
          m.wanderTimer -= dt;
          if (m.wanderTimer <= 0) {
            m.wanderTimer = 2 + Math.random() * 4;
            m.wanderMoving = Math.random() < 0.5;
            // 游走方向偏向村庄中心（不走出 ~12 格）
            m.wanderDir = hd > 12 ? Math.atan2(hz, hx) : Math.random() * Math.PI * 2;
          }
          if (m.wanderMoving) {
            mx = Math.cos(m.wanderDir) * def.speed * 0.5;
            mz = Math.sin(m.wanderDir) * def.speed * 0.5;
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
    }

    // 移动 + 碰撞（与玩家同一套物理；烈焰人悬浮无重力）
    m.x += mx * dt;
    const hitX = collideAxis(world, m, 0, mx * dt, HALF_W, HEIGHT);
    m.z += mz * dt;
    const hitZ = collideAxis(world, m, 2, mz * dt, HALF_W, HEIGHT);
    // 被 1 格障碍挡住时跳起
    if ((hitX || hitZ) && m.onGround) m.velY = 8.5;

    if (m.type === 'blaze' || m.type === 'ghast') {
      // 悬浮：相位起伏，不受重力（恶魂起伏更慢）
      m.bob = (m.bob ?? Math.random() * 6) + dt * (m.type === 'ghast' ? 0.8 : 2);
      m.y += Math.sin(m.bob) * (m.type === 'ghast' ? 0.3 : 0.5) * dt;
      m.velY = 0;
    } else {
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

/** 玩家最近攻击的目标（驯狼护主用；attackerPos 存在即记录） */
export const lastPlayerTarget: { mob: Mob | null; at: number } = { mob: null, at: 0 };

/** 对生物造成伤害（attackerPos 用于被动生物逃跑方向；lootBonus = 抢夺附魔等级；world 用于末影人受击瞬移），返回是否击杀 */
export function damageMob(mob: Mob, damage: number, attackerPos?: { x: number; z: number }, lootBonus = 0, world?: World): boolean {
  mob.hp -= damage;
  if (attackerPos) {
    lastPlayerTarget.mob = mob;
    lastPlayerTarget.at = performance.now() / 1000;
  }
  // 僵尸猪灵：受伤激怒自身与 32 格内同伴（MC 群体仇恨）
  if (mob.type === 'zombified_piglin') {
    for (const m of mobs) {
      if (m.type === 'zombified_piglin' && Math.hypot(m.x - mob.x, m.z - mob.z) <= 32) m.aggroTimer = 40;
    }
  }
  // 野狼：受伤激怒自身与 16 格内同伴（MC 狼群复仇）
  if (mob.type === 'wolf' && !mob.tamed) {
    for (const m of mobs) {
      if (m.type === 'wolf' && !m.tamed && Math.hypot(m.x - mob.x, m.z - mob.z) <= 16) m.aggroTimer = 20;
    }
  }
  // 末影人：受击激怒，且六成概率立即瞬移闪避（MC）
  if (mob.type === 'enderman') {
    mob.aggroTimer = 30;
    if (world && Math.random() < 0.6) teleportEnderman(world, mob);
  }
  if (mob.hp > 0) {
    // 被动生物受击逃跑
    if (!MOB_DEFS[mob.type].hostile && attackerPos) {
      mob.fleeTimer = 4;
      mob.fleeFromX = attackerPos.x;
      mob.fleeFromZ = attackerPos.z;
    }
    return false;
  }
  // 击杀掉落（数量在区间内随机；抢夺附魔每件 +0~lvl）与杀怪经验（MC）
  for (const drop of MOB_DEFS[mob.type].drops) {
    const count = drop.count[0] + Math.floor(Math.random() * (drop.count[1] - drop.count[0] + 1)) + (lootBonus > 0 ? Math.floor(Math.random() * (lootBonus + 1)) : 0);
    if (count > 0) spawnMaterialDrop(drop.material, mob.x, mob.y + 0.3, mob.z, count);
  }
  // 羊：掉同色羊毛 ×1（剪过毛的不掉，MC）
  if (mob.type === 'sheep' && !mob.sheared) {
    spawnBlockDrop(woolBlockId(mob.woolColor ?? 'white'), mob.x, mob.y + 0.3, mob.z, 1 + (lootBonus > 0 ? Math.floor(Math.random() * lootBonus) : 0));
  }
  useGameStore.getState().addXp(XP_MOB[mob.type]);
  const i = mobs.indexOf(mob);
  if (i >= 0) mobs.splice(i, 1);
  return true;
}
