// 生物系统：类型化怪物（敌对/被动）+ 骷髅箭 + 苦力怕爆炸。纯数据逻辑（不依赖 three，可单测）

import { AIR, BLOCK_BY_KEY, BLOCKS, GRASS, isWaterId } from './blocks';
import { hash2, type Biome } from './noise';
import { dayFactorAt, bossState, pearlTeleport, survivalStats, worldClock } from './game';
import { effects } from './effects';
import { useGameStore } from './store';
import { XP_MOB } from './xp';
import { explodeAt } from './explosion';
import { endCrystals, hitCrystal } from './endfight';
import { spawnBlockDrop, spawnMaterialDrop } from './items';
import { bastionNear, fortressNear } from './netherstructures';
import { outerIslandContaining } from './end';
import { aabbFree, collideAxis } from './physics';
import { raycastBlock } from './raycast';
import { villageCenterNear } from './structures';
import { weather, precipAt, type WeatherKind } from './weather';
// 循环引用说明：redstone.ts 的 tickPlates 引用本文件 mobs 列表；此处 strikeTarget 仅运行时调用，ESM live binding 安全
import { strikeTarget } from './redstone';
import { type World } from './world';
import { chunkKey, localIndex, WORLD_HEIGHT } from './grid';

export type MobType = 'zombie' | 'skeleton' | 'spider' | 'creeper' | 'pig' | 'cow' | 'chicken' | 'villager' | 'mooshroom' | 'zombified_piglin' | 'piglin' | 'piglin_brute' | 'blaze' | 'wither_skeleton' | 'ghast' | 'sheep' | 'wolf' | 'enderman' | 'wither' | 'ender_dragon' | 'shulker' | 'slime' | 'phantom' | 'iron_golem';

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
  zombie: { name: '僵尸', hp: 20, speed: 2.3, hostile: true, burnsAtDay: true, damage: 3, attackRange: 1.4, attackCd: 1.2, drops: [{ material: 'rotten_flesh', count: [0, 2] }] },
  skeleton: { name: '骷髅', hp: 20, speed: 2.3, hostile: true, burnsAtDay: true, damage: 3, attackRange: 16, attackCd: 2, drops: [{ material: 'bone', count: [0, 2] }, { material: 'arrow', count: [0, 2] }] },
  spider: { name: '蜘蛛', hp: 16, speed: 3.2, hostile: true, burnsAtDay: false, damage: 2, attackRange: 1.4, attackCd: 1, drops: [{ material: 'string', count: [0, 2] }, { material: 'spider_eye', count: [0, 1] }] },
  creeper: { name: '苦力怕', hp: 20, speed: 2.2, hostile: true, burnsAtDay: false, damage: 0, attackRange: 3, attackCd: 1.5, drops: [{ material: 'gunpowder', count: [0, 2] }] },
  pig: { name: '猪', hp: 10, speed: 1.5, hostile: false, burnsAtDay: false, damage: 0, attackRange: 0, attackCd: 0, drops: [{ material: 'raw_pork', count: [1, 3] }] },
  cow: { name: '牛', hp: 10, speed: 1.4, hostile: false, burnsAtDay: false, damage: 0, attackRange: 0, attackCd: 0, drops: [{ material: 'leather', count: [0, 2] }, { material: 'raw_beef', count: [1, 3] }] },
  chicken: { name: '鸡', hp: 4, speed: 1.6, hostile: false, burnsAtDay: false, damage: 0, attackRange: 0, attackCd: 0, drops: [{ material: 'feather', count: [0, 2] }, { material: 'raw_chicken', count: [1, 1] }] },
  villager: { name: '村民', hp: 20, speed: 1.2, hostile: false, burnsAtDay: false, damage: 0, attackRange: 0, attackCd: 0, drops: [] },
  mooshroom: { name: '蘑菇牛', hp: 10, speed: 1.4, hostile: false, burnsAtDay: false, damage: 0, attackRange: 0, attackCd: 0, drops: [{ material: 'leather', count: [0, 2] }, { material: 'raw_beef', count: [1, 3] }] },
  // 僵尸猪灵：中立敌对——不被激怒时不攻击；受伤则群体仇恨（MC 下界特色）；掉腐肉 + 金粒（MC）
  zombified_piglin: { name: '僵尸猪灵', hp: 20, speed: 2.4, hostile: true, burnsAtDay: false, damage: 4, attackRange: 1.4, attackCd: 1.2, drops: [{ material: 'rotten_flesh', count: [0, 1] }, { material: 'gold_nugget', count: [0, 1] }] },
  // 猪灵：中立敌对——玩家穿任一金装备则不主动攻击（MC 金甲豁免）；受伤群体仇恨；可以物易物；死亡掉金粒（MC 概率掉落简化）
  piglin: { name: '猪灵', hp: 16, speed: 2.6, hostile: true, burnsAtDay: false, damage: 4, attackRange: 1.6, attackCd: 1, drops: [{ material: 'gold_nugget', count: [0, 2] }] },
  // 猪灵蛮兵：堡垒守卫——始终敌对、不受金甲豁免、不接受易物（MC）
  piglin_brute: { name: '猪灵蛮兵', hp: 50, speed: 2.8, hostile: true, burnsAtDay: false, damage: 7, attackRange: 1.6, attackCd: 1, drops: [] },
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
  enderman: { name: '末影人', hp: 40, speed: 3.2, hostile: true, burnsAtDay: false, damage: 7, attackRange: 1.6, attackCd: 1, drops: [{ material: 'ender_pearl', count: [0, 1] }],
  },
  // 凋灵：Boss——悬浮弹幕（凋灵骷髅弹带凋零 DOT），半血以下免疫箭矢（MC）；击杀掉下界之星
  wither: { name: '凋灵', hp: 300, speed: 2.2, hostile: true, burnsAtDay: false, damage: 8, attackRange: 30, attackCd: 2, drops: [{ material: 'nether_star', count: [1, 1] }],
  },
  // 末影龙：末地 Boss——盘旋/俯冲/栖息喷息三态（完全自管理飞行，穿方块）；掉落为空，结算见 lib/endfight.ts（龙蛋 + 返回门）
  ender_dragon: { name: '末影龙', hp: 200, speed: 0, hostile: true, burnsAtDay: false, damage: 8, attackRange: 2.5, attackCd: 1, drops: [] },
  // 潜影贝：末地城守卫——固着不动，玩家 12 格内开壳射追踪弹（命中漂浮，MC）
  shulker: { name: '潜影贝', hp: 30, speed: 0, hostile: true, burnsAtDay: false, damage: 4, attackRange: 12, attackCd: 2.5, drops: [{ material: 'shulker_shell', count: [0, 1] }] },
  // 史莱姆：三档体型（slimeSize 4/2/1），蹦跳前进；杀死大/中分裂 2-4 只小一档（MC），最小档掉黏液球
  slime: { name: '史莱姆', hp: 16, speed: 2.2, hostile: true, burnsAtDay: false, damage: 4, attackRange: 1.4, attackCd: 1, drops: [{ material: 'slime_ball', count: [0, 2] }] },
  // 幻翼：失眠惩罚怪——玩家 ≥3 天没睡，夜晚在头顶高空来袭（盘旋→俯冲→拉升）；白天自燃同僵尸；无幻翼膜材料，掉 0-1 羽毛
  phantom: { name: '幻翼', hp: 20, speed: 4.5, hostile: true, burnsAtDay: true, damage: 4, attackRange: 1.8, attackCd: 2, drops: [{ material: 'feather', count: [0, 1] }] },
  // 铁傀儡：村庄守卫——中立，猎杀威胁玩家的敌对怪；玩家攻击村民或它则仇恨玩家；高伤 7-14 随机（MC 普通 7-21 取低段）
  iron_golem: { name: '铁傀儡', hp: 100, speed: 1.1, hostile: true, burnsAtDay: false, damage: 7, attackRange: 1.8, attackCd: 1, drops: [{ material: 'iron_ingot', count: [1, 2] }] },
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
  /** 凋灵：破坏方块计时与弹幕计时 */
  smashTimer?: number;
  /** 猪灵：端详金锭剩余秒（以物易物中，静止不攻击） */
  barterTimer?: number;
  /** 史莱姆：体型档（4 大 / 2 中 / 1 小，MC）与蹦跳冲量 */
  slimeSize?: 4 | 2 | 1;
  hopX?: number;
  hopZ?: number;
  hopTimer?: number;
  /** 末影龙：三态飞行状态机（盘旋/俯冲/栖息）与目标点 */
  dragonPhase?: 'circle' | 'strafe' | 'perch';
  dragonAngle?: number;
  phaseTimer?: number;
  strafeX?: number;
  strafeY?: number;
  strafeZ?: number;
  /** 村庄锚点（村民/铁傀儡不远离村庄；生成时写入） */
  homeX?: number;
  homeZ?: number;
  /** 幻翼：三态（circle 高空盘旋 / dive 俯冲 / climb 拉升）与盘旋角 */
  phantomPhase?: 'circle' | 'dive' | 'climb';
  phantomAngle?: number;
  /** 烈焰人三连发：待发余量与发间间隔（MC 蓄力后快速三连） */
  burstLeft?: number;
  burstCd?: number;
  /** 鸡：下蛋倒计时（MC 每 5-10 分钟一个） */
  eggTimer?: number;
  /** 摔落距离（滞空累计、落地结算；与玩家 fallDist 同公式） */
  fallDist?: number;
  /** 距离消失计时（32-64 格持续远离 20-40s 后消失，MC 随机刻消失简版） */
  despawnTimer?: number;
  /** 击退水平冲量（击退附魔施加，随时间指数衰减；Boss/铁傀儡免疫） */
  kbx?: number;
  kbz?: number;
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
  /** 烈焰人火球（更大更亮，命中伤害 4）或恶魂爆裂火球（命中/撞墙爆炸）或凋灵骷髅弹（爆炸 + 凋零 DOT）或末影珍珠（落点传送）或末影之眼（飞向要塞后悬停碎裂/掉落） */
  kind?: 'fireball' | 'ghast' | 'pearl' | 'wither_skull' | 'eye' | 'shulker';
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
/** 铁傀儡猎杀对象（MC：威胁村庄的敌对怪） */
const GOLEM_TARGETS: readonly MobType[] = ['zombie', 'skeleton', 'spider', 'creeper', 'phantom'];
/** 摔落免疫（MC：鸡缓降不摔伤；烈焰人/恶魂等飞行者本就走悬浮分支，列名防御） */
const FALL_IMMUNE: readonly MobType[] = ['chicken', 'phantom', 'blaze', 'ghast', 'wither', 'ender_dragon'];

/** 幻翼失眠状态：连续未睡觉的完整游戏日数（≥3 的夜晚来袭，睡过清零）与来袭间隔计时 */
export const phantomState = { insomniaDays: 0, timer: 0 };
/** 上一帧的昼夜时钟（区分自然跨日与睡觉回拨：床把 worldClock.t 直接设回日出 0） */
let lastClockT = worldClock.t;

/** 睡觉（床）：失眠清零（MC 睡过重置幻翼计数），并重置跨日基准 lastClockT——否则下一 tick 会把「回拨到日出 0」误判为自然跨日而 +1（越睡越失眠） */
export function onSlept(): void {
  phantomState.insomniaDays = 0;
  lastClockT = 0;
}

/** tickMobs 遍历深度与延迟移除队列：遍历中 damageMob 不立即 splice（否则反向遍历索引错位、当前 mob 被前移双结算），遍历结束统一清理 */
let tickDepth = 0;
const pendingKill: Mob[] = [];

/** 移除 mob：遍历中（tickDepth>0）入延迟队列，否则立即 splice */
function removeMob(mob: Mob): void {
  if (tickDepth > 0) {
    if (!pendingKill.includes(mob)) pendingKill.push(mob);
    return;
  }
  const i = mobs.indexOf(mob);
  if (i >= 0) mobs.splice(i, 1);
}

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

// 本地降水缓存：biomeAt/snowlineAt 是多次噪声求值，按 (chunk, 天气) 缓存避免每帧每生物重算
const precipCache = new Map<string, boolean>();
let precipCacheKind: WeatherKind | null = null;

/** 该生物处是否正在下雨（MC：仅雨抑制自燃——雪与干旱群系不保护；沙漠全局雨天也照烧） */
function rainingAt(world: World, m: Mob): boolean {
  if (weather.kind === 'clear') return false;
  if (precipCacheKind !== weather.kind) {
    precipCache.clear();
    precipCacheKind = weather.kind;
  }
  const ck = `${Math.floor(m.x) >> 4},${Math.floor(m.z) >> 4}`;
  let v = precipCache.get(ck);
  if (v === undefined) {
    v = precipAt(world.terrain, weather.kind, Math.floor(m.x), Math.floor(m.y), Math.floor(m.z)) === 'rain';
    if (precipCache.size > 512) precipCache.clear();
    precipCache.set(ck, v);
  }
  return v;
}

function pickSpawnType(night: boolean, biome?: Biome): MobType {
  const r = Math.random();
  if (night) {
    if (biome === 'swamp' && r < 0.4) return 'slime'; // 沼泽夜晚史莱姆成群（MC 沼泽刷怪规则）
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

/** 生成凋灵 Boss（lib/wither.ts 召唤用；全程激怒并悬浮） */
export function makeWither(x: number, y: number, z: number): Mob {
  const m = makeMob('wither', x, y, z);
  m.aggroTimer = Number.MAX_SAFE_INTEGER; // Boss 全程激怒
  return m;
}

/** 末影龙：末地 Boss（盘旋初态，随机起始相位） */
export function makeEnderDragon(x: number, y: number, z: number): Mob {
  const m = makeMob('ender_dragon', x, y, z);
  m.dragonPhase = 'circle';
  m.dragonAngle = Math.random() * Math.PI * 2;
  m.phaseTimer = 5;
  return m;
}

/** 史莱姆：按体型档生成（MC hp：大 16 / 中 4 / 小 1；生成时为大或中） */
export function makeSlime(x: number, y: number, z: number, size: 4 | 2 | 1): Mob {
  const m = makeMob('slime', x, y, z);
  m.slimeSize = size;
  m.hp = size === 4 ? 16 : size === 2 ? 4 : 1;
  return m;
}

/** 在指定位置生成一只生物并加入世界（actions.ts 鸡蛋砸出小鸡等定点生成场景用；返回生成的生物） */
export function spawnMobAt(type: MobType, x: number, y: number, z: number): Mob {
  const m = makeMob(type, x, y, z);
  mobs.push(m);
  return m;
}

/** 史莱姆区块判定（MC：种子 + 区块坐标哈希，约 1/10 区块；区块内 y<40 无视亮度刷史莱姆） */
export function isSlimeChunk(seedHash: number, cx: number, cz: number): boolean {
  return hash2(seedHash ^ 0x3ad5e7c9, cx, cz) < 0.1;
}

/** 生成点亮度：方块光与天空光×昼夜系数取大（白天露天 15、深夜露天 ≈0、深洞恒 0；MC 敌对刷怪需 ≤7） */
export function spawnLightAt(world: World, x: number, y: number, z: number): number {
  if (y < 0 || y >= WORLD_HEIGHT) return 0;
  const c = world.chunks.get(chunkKey(x >> 4, z >> 4));
  if (!c) return 0;
  const i = localIndex(x & 15, y, z & 15);
  return Math.max(c.light[i], c.sky[i] * dayFactorAt(worldClock.t));
}

/** 玩家是否穿任一金装备（MC：猪灵不主动攻击穿金甲的玩家；蛮兵不吃这套） */
export function wearsGoldArmor(): boolean {
  const a = useGameStore.getState().armorSlots;
  return [a.helmet, a.chestplate, a.leggings, a.boots].some((p) => p?.material === 'gold');
}

/** 以物易物表（MC 1.16 权重展开的简化：8 样，权重和 100） */
export const BARTER_TABLE: { kind: 'material' | 'block'; key: string; count: [number, number]; weight: number }[] = [
  { kind: 'material', key: 'ender_pearl', count: [2, 4], weight: 10 },
  { kind: 'material', key: 'glowstone_dust', count: [2, 4], weight: 10 },
  { kind: 'material', key: 'quartz', count: [5, 12], weight: 20 },
  { kind: 'material', key: 'string', count: [4, 8], weight: 15 },
  { kind: 'material', key: 'leather', count: [2, 4], weight: 15 },
  { kind: 'block', key: 'soul_sand', count: [4, 12], weight: 10 },
  { kind: 'block', key: 'obsidian', count: [1, 1], weight: 10 },
  { kind: 'block', key: 'crying_obsidian', count: [1, 1], weight: 10 },
];

function rollBarter(): { kind: 'material' | 'block'; key: string; count: number } {
  let roll = Math.random() * 100;
  for (const c of BARTER_TABLE) {
    roll -= c.weight;
    if (roll < 0) return { kind: c.kind, key: c.key, count: c.count[0] + Math.floor(Math.random() * (c.count[1] - c.count[0] + 1)) };
  }
  return { kind: 'material', key: 'quartz', count: 5 };
}

/** 以物易物：玩家给金锭（调用方已消耗），猪灵端详 3s 后丢出随机易物；蛮兵不谈判（MC） */
export function barterWith(mob: Mob): boolean {
  if (mob.type !== 'piglin') return false;
  if ((mob.barterTimer ?? 0) > 0) return false;
  mob.barterTimer = 3;
  return true;
}

/** 在玩家周围环形区域找生成点（夜晚敌对、白天被动且只在草地上；昼夜都可能尝试地下洞穴刷敌对——MC 洞穴恒暗；
 *  敌对生成需点亮度 ≤7（天空光按昼夜折算）；村庄附近生成村民与铁傀儡守卫；蘑菇岛只出蘑菇牛且夜晚不刷怪） */
export function trySpawn(world: World, px: number, pz: number): boolean {
  const night = isNight();
  // 下界：只刷僵尸猪灵（下界岩上 2-3 只成群；不被激怒不攻击）
  if (world.terrain.kind === 'nether') return trySpawnNether(world, px, pz);
  // 末地：末影人成群（末地石表面；MC 末地主岛遍布末影人）
  if (world.terrain.kind === 'end') return trySpawnEnd(world, px, pz);
  // 靠近村庄中心：白天 70% 生成村民（锚定村庄，不远离）；村庄无守卫时刷 1 只铁傀儡（MC，不占刷怪上限）
  const village = villageCenterNear(world.seedHash, world.terrain, px, pz, 48);
  if (village && !mobs.some((m) => m.type === 'iron_golem' && Math.hypot(m.x - village.x, m.z - village.z) < 48) && Math.random() < 0.2) {
    if (trySpawnGolem(world, village)) return true;
  }
  const villageRoll = !night && village !== null && Math.random() < 0.85;
  const hostileCount = mobs.filter((m) => MOB_DEFS[m.type].hostile && !m.tamed && m.type !== 'iron_golem').length;
  const passiveCount = mobs.filter((m) => !MOB_DEFS[m.type].hostile).length;
  if (night && hostileCount >= MAX_HOSTILE) return false;
  // 村民单独限额（每村最多 3 只，MC 村庄必有村民——不与普通动物共享被动上限，否则被猪牛挤满永不出村民）
  if (villageRoll) {
    const villagerCount = mobs.filter((m) => m.type === 'villager' && Math.hypot(m.x - village!.x, m.z - village!.z) < 48).length;
    if (villagerCount >= 3) return false;
  } else if (!night && passiveCount >= MAX_PASSIVE) return false;
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
    // 从世界顶向下找第一个实心方块作为地表
    let y = WORLD_HEIGHT - 1;
    while (y > 0 && !BLOCKS[world.getBlock(bx, y, bz)]?.solid) y--;
    if (y <= 0) continue;
    // 地下洞穴刷敌对（MC：洞穴恒暗昼夜皆刷）——地表向下随机采样，找「固体地面 + 上方 2 格非固体非水」的洞穴平台
    if (biome !== 'mushroom_fields' && hostileCount < MAX_HOSTILE && Math.random() < (night ? 0.5 : 0.35)) {
      const depth = y - 6;
      let caveY = -1;
      for (let s = 0; s < 12 && depth > 4; s++) {
        const cy = 4 + Math.floor(Math.random() * (depth - 4));
        const floorId = world.getBlock(bx, cy, bz);
        const feet = world.getBlock(bx, cy + 1, bz);
        const head = world.getBlock(bx, cy + 2, bz);
        if (BLOCKS[floorId]?.solid && !BLOCKS[feet]?.solid && !isWaterId(feet) && !BLOCKS[feet]?.lava && !BLOCKS[head]?.solid && !isWaterId(head) && !BLOCKS[head]?.lava) {
          caveY = cy;
          break;
        }
      }
      if (caveY < 0) continue;
      const sy = caveY + 1;
      // 史莱姆区块（MC：约 1/10 区块 y<40 无视亮度刷史莱姆）
      const slimeChunk = sy < 40 && isSlimeChunk(world.seedHash, bx >> 4, bz >> 4);
      if (!slimeChunk && spawnLightAt(world, bx, sy, bz) > 7) continue; // 亮度门控（MC 敌对 ≤7）
      const type: MobType = slimeChunk ? 'slime' : pickSpawnType(true, biome);
      if (!aabbFree(world, bx + 0.5, sy, bz + 0.5, HALF_W, HEIGHT)) continue;
      mobs.push(type === 'slime' ? makeSlime(bx + 0.5, sy, bz + 0.5, Math.random() < 0.6 ? 4 : 2) : makeMob(type, bx + 0.5, sy, bz + 0.5));
      return true;
    }
    const wantType = biome === 'mushroom_fields' ? 'mooshroom' : villageRoll ? 'villager' : pickSpawnType(night, biome);
    const wantDef = MOB_DEFS[wantType];
    if (isWaterId(world.getBlock(bx, y, bz))) continue; // 不在水面生成
    // 被动只在草地上（蘑菇牛在菌丝上；村民可站村庄土径，MC）
    if (!wantDef.hostile) {
      const ground = world.getBlock(bx, y, bz);
      const gk = BLOCKS[ground]?.key;
      if (wantType === 'mooshroom' ? gk !== 'mycelium' : wantType === 'villager' ? ground !== GRASS && gk !== 'dirt' : ground !== GRASS) continue;
    }
    const sy = y + 1;
    // 亮度门控（MC：敌对在亮度 ≤7 生成；地表白天天空光 15 不刷，深夜露天 ≈0 可刷）
    if (wantDef.hostile && spawnLightAt(world, bx, sy, bz) > 7) continue;
    if (!aabbFree(world, bx + 0.5, sy, bz + 0.5, HALF_W, HEIGHT)) continue;
    const mob = wantType === 'slime' ? makeSlime(bx + 0.5, sy, bz + 0.5, Math.random() < 0.6 ? 4 : 2) : makeMob(wantType, bx + 0.5, sy, bz + 0.5); // 史莱姆生成大/中档（MC）
    if (mob.type === 'villager' && village) {
      mob.homeX = village.x;
      mob.homeZ = village.z;
    }
    mobs.push(mob);
    return true;
  }
  return false;
}

/** 村庄铁傀儡：中心附近地表生成 1 只并锚定村庄（MC 村庄守卫） */
function trySpawnGolem(world: World, village: { x: number; z: number }): boolean {
  for (let attempt = 0; attempt < 4; attempt++) {
    const bx = Math.floor(village.x + (Math.random() - 0.5) * 12);
    const bz = Math.floor(village.z + (Math.random() - 0.5) * 12);
    if (!world.chunks.has(`${bx >> 4},${bz >> 4}`)) continue;
    let y = WORLD_HEIGHT - 1;
    while (y > 0 && !BLOCKS[world.getBlock(bx, y, bz)]?.solid) y--;
    if (y <= 0 || isWaterId(world.getBlock(bx, y, bz))) continue;
    const sy = y + 1;
    if (!aabbFree(world, bx + 0.5, sy, bz + 0.5, HALF_W, HEIGHT)) continue;
    const g = makeMob('iron_golem', bx + 0.5, sy, bz + 0.5);
    g.homeX = village.x;
    g.homeZ = village.z;
    mobs.push(g);
    return true;
  }
  return false;
}

/** 下界刷怪：僵尸猪灵 2-3 只成群（下界岩/灵魂沙表面、岩浆海以上；MC 成群出没）；堡垒附近出凋灵骷髅/烈焰人 */
function trySpawnNether(world: World, px: number, pz: number): boolean {
  const hostileCount = mobs.filter((m) => MOB_DEFS[m.type].hostile && !m.tamed && m.type !== 'iron_golem').length;
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
      : bastionNear(world.seedHash, world.terrain, bx, bz, 48)
        ? roll < 0.5
          ? 'piglin_brute'
          : 'piglin'
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
            : biome === 'crimson_forest'
              ? roll < 0.6
                ? 'piglin'
                : 'zombified_piglin'
              : roll < 0.55
                ? 'zombified_piglin'
                : roll < 0.7
                  ? 'piglin'
                  : roll < 0.88
                    ? 'blaze'
                    : 'ghast';
    if (type === 'zombified_piglin' || type === 'piglin') {
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

/** 末地刷怪：末影人 1-3 只成群（末地石表面；MC 末地主岛遍布末影人，无昼夜限制） */
function trySpawnEnd(world: World, px: number, pz: number): boolean {
  const hostileCount = mobs.filter((m) => MOB_DEFS[m.type].hostile && !m.tamed && m.type !== 'iron_golem').length;
  if (hostileCount >= MAX_HOSTILE * 2) return false; // 末地密度更高（MC 末影人之岛）
  for (let attempt = 0; attempt < 8; attempt++) {
    const ang = Math.random() * Math.PI * 2;
    const r = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
    const bx = Math.floor(px + Math.cos(ang) * r);
    const bz = Math.floor(pz + Math.sin(ang) * r);
    if (!world.chunks.has(`${bx >> 4},${bz >> 4}`)) continue;
    let y = WORLD_HEIGHT - 8;
    while (y > 1 && !BLOCKS[world.getBlock(bx, y, bz)]?.solid) y--;
    if (y <= 1) continue;
    if (BLOCKS[world.getBlock(bx, y, bz)]?.key !== 'end_stone') continue;
    const sy = y + 1;
    if (!aabbFree(world, bx + 0.5, sy, bz + 0.5, HALF_W, HEIGHT)) continue;
    // 末地城（城岛）附近 60% 出潜影贝守卫（MC）；其余末影人成群
    const isle = outerIslandContaining(world.seedHash, bx, bz);
    if (isle?.city && Math.random() < 0.6) {
      mobs.push(makeMob('shulker', bx + 0.5, sy, bz + 0.5));
    } else {
      const pack = 1 + Math.floor(Math.random() * 3); // 1-3 只
      for (let i = 0; i < pack; i++) {
        mobs.push(makeMob('enderman', bx + 0.5 + (Math.random() - 0.5) * 2, sy, bz + 0.5 + (Math.random() - 0.5) * 2));
      }
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

function spawnArrow(m: Mob, target: { x: number; y: number; z: number }, kind?: 'fireball' | 'ghast' | 'wither_skull' | 'shulker'): void {
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

/** 玩家投掷末影之眼：朝最近要塞水平方向直飞（约 60-80 格，MC 远距指向），悬停后 20% 碎裂 / 80% 原地掉落（MC 规则） */
export function fireEyeOfEnder(origin: { x: number; y: number; z: number }, targetX: number, targetZ: number): void {
  const dx = targetX - origin.x;
  const dz = targetZ - origin.z;
  const d = Math.max(Math.hypot(dx, dz), 0.01);
  arrows.push({
    id: nextArrowId++,
    x: origin.x, y: origin.y, z: origin.z,
    vx: (dx / d) * 26,
    vy: 3.5, // 先升后平（MC 之眼先窜高）
    vz: (dz / d) * 26,
    age: 0,
    fromPlayer: true,
    kind: 'eye',
  });
}

/** 苦力怕爆炸：委托共享爆炸逻辑（防爆方块除外，MC 一致） */
function explode(
  world: World,
  m: Mob,
  playerPos: { x: number; y: number; z: number },
  onAttackPlayer: (damage: number) => void,
): void {
  explodeAt(world, m.x, m.y, m.z, playerPos, onAttackPlayer, { radius: 3, maxDamage: 43, hurtRadius: 4.5 }); // MC 普通难度贴脸约 43——标志性秒杀怪
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
    // 末影之眼：无重力直飞 2.6s（约 60-80 格，MC 远距指向要塞），随后减速悬停缓升；3.2s 到期 20% 碎裂 / 80% 原地掉落（MC）
    if (a.kind === 'eye') {
      if (a.age > 2.6) {
        a.vx *= Math.max(0, 1 - dt * 4);
        a.vz *= Math.max(0, 1 - dt * 4);
        a.vy = 1.2;
      }
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      a.z += a.vz * dt;
      if (a.age >= 3.2) {
        arrows.splice(i, 1);
        if (Math.random() >= 0.2) spawnMaterialDrop('eye_of_ender', a.x, a.y, a.z);
      }
      continue;
    }
    // 潜影弹：低速追踪玩家（MC 制导），4 秒自毁
    if (a.kind === 'shulker') {
      const dx = playerPos.x - a.x;
      const dy = playerPos.y + 0.9 - a.y;
      const dz = playerPos.z - a.z;
      const d = Math.max(Math.hypot(dx, dy, dz), 0.01);
      const sp = 5;
      a.vx += ((dx / d) * sp - a.vx) * Math.min(1, dt * 4);
      a.vy += ((dy / d) * sp - a.vy) * Math.min(1, dt * 4);
      a.vz += ((dz / d) * sp - a.vz) * Math.min(1, dt * 4);
      if (a.age > 4) {
        arrows.splice(i, 1);
        continue;
      }
    }
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
      // 标靶：箭命中触发 1s 全向红石脉冲（MC）
      if (!a.kind) strikeTarget(world, Math.floor(a.x), Math.floor(a.y), Math.floor(a.z));
      // 恶魂爆裂火球：撞墙即爆（MC）
      if (a.kind === 'ghast') explodeAt(world, a.x, a.y, a.z, playerPos, onAttackPlayer, { radius: 2, maxDamage: 10, hurtRadius: 3 });
      // 凋灵骷髅弹：撞墙即爆 + 爆圈玩家中凋零 DOT（MC 凋灵弹幕）
      if (a.kind === 'wither_skull') {
        explodeAt(world, a.x, a.y, a.z, playerPos, onAttackPlayer, { radius: 2, maxDamage: 8, hurtRadius: 3 });
        if (Math.hypot(playerPos.x - a.x, playerPos.y - a.y, playerPos.z - a.z) < 3.5) survivalStats.wither = 5;
      }
      // 末影珍珠：落点传送玩家 + 5 点伤害（MC 2.5 心）
      if (a.kind === 'pearl') {
        pearlTeleport.pending = { x: Math.floor(a.x) + 0.5, y: Math.ceil(a.y) + 0.01, z: Math.floor(a.z) + 0.5 };
        onAttackPlayer(5);
      }
      arrows.splice(i, 1);
      continue;
    }
    // 玩家射出的箭/珍珠：命中生物（AABB 粗略判定；珍珠不伤人、命中即传送到生物处；龙体型大判定放宽）
    if (a.fromPlayer) {
      // 末影水晶：箭命中即爆（MC 远程击毁水晶是标准打法）
      const c = endCrystals.find((c) => c.alive && Math.abs(c.x - a.x) < 0.9 && Math.abs(c.y - a.y) < 1 && Math.abs(c.z - a.z) < 0.9);
      if (c) {
        hitCrystal(c, world, playerPos, onAttackPlayer);
        arrows.splice(i, 1);
        continue;
      }
      const hitMob = mobs.find(
        (m) =>
          m.type === 'ender_dragon'
            ? Math.abs(m.x - a.x) < 2.5 && a.y > m.y - 1 && a.y < m.y + 2.5 && Math.abs(m.z - a.z) < 2.5
            : Math.abs(m.x - a.x) < 0.55 && a.y > m.y - 0.2 && a.y < m.y + 2 && Math.abs(m.z - a.z) < 0.55,
      );
      if (hitMob) {
        if (a.kind === 'pearl') {
          pearlTeleport.pending = { x: Math.floor(a.x) + 0.5, y: Math.ceil(a.y) + 0.01, z: Math.floor(a.z) + 0.5 };
          onAttackPlayer(5);
        } else if (hitMob.type === 'enderman') {
          // 末影人：弹射物命中前必瞬移闪避，箭永远伤不到（MC）
          teleportEnderman(world, hitMob);
        } else if (hitMob.type === 'wither' && hitMob.hp < MOB_DEFS.wither.hp / 2) {
          // 凋灵半血以下免疫箭矢（MC 规则：弹开不掉血）
        } else {
          damageMob(hitMob, 9, { x: a.x - a.vx, z: a.z - a.vz }, 0, world);
        }
        arrows.splice(i, 1);
        continue;
      }
    } else if (
      // 骷髅的箭/烈焰人的火球/恶魂的爆裂球/凋灵骷髅弹：命中玩家（AABB 粗略判定）
      Math.abs(playerPos.x - a.x) < 0.5 &&
      a.y > playerPos.y &&
      a.y < playerPos.y + 1.8 &&
      Math.abs(playerPos.z - a.z) < 0.5
    ) {
      if (a.kind === 'ghast') explodeAt(world, a.x, a.y, a.z, playerPos, onAttackPlayer, { radius: 2, maxDamage: 10, hurtRadius: 3 });
      else if (a.kind === 'wither_skull') {
        explodeAt(world, a.x, a.y, a.z, playerPos, onAttackPlayer, { radius: 2, maxDamage: 8, hurtRadius: 3 });
        survivalStats.wither = 5;
      } else if (a.kind === 'shulker') {
        onAttackPlayer(4);
        effects.levitation = Math.max(effects.levitation, 5); // 漂浮 5 秒（MC）
      } else onAttackPlayer(a.kind === 'fireball' ? 4 : 3);
      arrows.splice(i, 1);
      continue;
    }
    if (a.age > 10 || a.y < -10) arrows.splice(i, 1);
  }
}

/** 末影龙三态飞行（MC boss 战节奏）：盘旋绕岛 → 俯冲玩家（冲撞 8 伤）→ 栖息祭坛喷龙息（10 格 DOT 3/s）。
 *  完全自管理位置（MC 龙穿方块），不参与通用重力/碰撞。 */
function tickDragon(world: World, m: Mob, dt: number, playerPos: { x: number; y: number; z: number }, onAttackPlayer: (d: number) => void): void {
  m.phaseTimer = (m.phaseTimer ?? 6) - dt;
  m.attackCd = Math.max(0, m.attackCd - dt);
  const pd = Math.hypot(playerPos.x - m.x, playerPos.y - m.y, playerPos.z - m.z);
  if (m.dragonPhase === 'strafe') {
    // 俯冲：直线冲向锁定的目标点并掠过（飞过才拉升回盘旋，MC 龙俯冲轨迹）
    const tx = m.strafeX ?? playerPos.x;
    const ty = m.strafeY ?? playerPos.y;
    const tz = m.strafeZ ?? playerPos.z;
    const dx = tx - m.x;
    const dy = ty - m.y;
    const dz = tz - m.z;
    const d = Math.hypot(dx, dy, dz);
    const sp = 16;
    if (d > 0.01) {
      const ux = dx / d;
      const uy = dy / d;
      const uz = dz / d;
      m.x += ux * sp * dt;
      m.y += uy * sp * dt;
      m.z += uz * sp * dt;
      // 已越过目标点（位移方向与剩余方向反向）或超时 → 回盘旋
      const overshot = (m.x - tx) * ux + (m.y - ty) * uy + (m.z - tz) * uz >= 0;
      if (overshot || m.phaseTimer <= 0) {
        m.dragonPhase = 'circle';
        m.phaseTimer = 6 + Math.random() * 4;
      }
    } else {
      m.dragonPhase = 'circle';
      m.phaseTimer = 6 + Math.random() * 4;
    }
    // 冲撞：触碰玩家 8 伤害（MC 龙撞击带击退，简化只伤害；移动前后两点都判定，避免大步进跨过玩家）
    if ((pd < 2.2 || Math.hypot(playerPos.x - m.x, playerPos.y - m.y, playerPos.z - m.z) < 2.2) && m.attackCd <= 0) {
      m.attackCd = 1;
      onAttackPlayer(8);
    }
  } else if (m.dragonPhase === 'perch') {
    // 栖息祭坛上空：缓降至驻点，喷龙息（MC 栖息喷吐，区域 DOT）
    const perchY = Math.max(world.terrain.heightAt(0, 0), 56) + 6;
    m.x += (0.5 - m.x) * Math.min(1, dt * 3);
    m.z += (0.5 - m.z) * Math.min(1, dt * 3);
    m.y += (perchY - m.y) * Math.min(1, dt * 3);
    if (pd < 10 && m.attackCd <= 0) {
      m.attackCd = 1;
      onAttackPlayer(3); // 龙息 DOT（每秒 3 点）
    }
    if (m.phaseTimer <= 0) {
      m.dragonPhase = 'circle';
      m.phaseTimer = 8 + Math.random() * 5;
    }
  } else {
    // 盘旋：绕岛心半径 28，高度 76-92 正弦起伏
    m.dragonPhase = 'circle';
    m.dragonAngle = (m.dragonAngle ?? 0) + dt * 0.45;
    const targetY = 84 + Math.sin(m.dragonAngle * 1.7) * 8;
    const tx = Math.cos(m.dragonAngle) * 28 + 0.5;
    const tz = Math.sin(m.dragonAngle) * 28 + 0.5;
    m.x += (tx - m.x) * Math.min(1, dt * 2.5);
    m.z += (tz - m.z) * Math.min(1, dt * 2.5);
    m.y += (targetY - m.y) * Math.min(1, dt * 2);
    // 盘旋结束：玩家在岛上时 60% 俯冲、20% 栖息，否则继续盘旋（MC 节奏）
    if (m.phaseTimer <= 0) {
      const roll = Math.random();
      if (roll < 0.6 && playerPos.y > 40 && pd < 80) {
        m.dragonPhase = 'strafe';
        m.strafeX = playerPos.x;
        m.strafeY = playerPos.y + 1;
        m.strafeZ = playerPos.z;
        m.phaseTimer = 3;
      } else if (roll < 0.8) {
        m.dragonPhase = 'perch';
        m.phaseTimer = 4;
      } else {
        m.phaseTimer = 6 + Math.random() * 4;
      }
    }
  }
}

/** 幻翼三态飞行（MC）：高空绕玩家盘旋 → 俯冲攻击（命中 4 伤，MC 普通 2 心）→ 拉升回高空；自管理飞行（无重力碰撞） */
function tickPhantom(m: Mob, dt: number, playerPos: { x: number; y: number; z: number }, onAttackPlayer: (d: number) => void): void {
  m.attackCd = Math.max(0, m.attackCd - dt);
  const def = MOB_DEFS.phantom;
  if (m.phantomPhase === 'dive') {
    // 俯冲：直扑玩家；贴近命中（或玩家跑远）则拉升回高空
    const dx = playerPos.x - m.x;
    const dy = playerPos.y + 0.9 - m.y;
    const dz = playerPos.z - m.z;
    const d = Math.hypot(dx, dy, dz);
    const sp = 14;
    if (d < 1.4) {
      if (m.attackCd <= 0) {
        m.attackCd = def.attackCd;
        onAttackPlayer(def.damage);
      }
      m.phantomPhase = 'climb';
    } else if (d > 48) {
      m.phantomPhase = 'climb';
    } else {
      m.x += (dx / d) * sp * dt;
      m.y += (dy / d) * sp * dt;
      m.z += (dz / d) * sp * dt;
    }
    return;
  }
  if (m.phantomPhase === 'climb') {
    // 拉升：回到高空后恢复盘旋（MC 掠过后拉起）
    m.y += 7 * dt;
    if (m.y >= playerPos.y + 22) {
      m.phantomPhase = 'circle';
      m.phaseTimer = 6 + Math.random() * 6;
    }
    return;
  }
  // 盘旋：绕玩家半径 12、高度 +22±3（MC 高空盘旋等待俯冲窗口）
  m.phantomPhase = 'circle';
  m.phantomAngle = (m.phantomAngle ?? 0) + dt * 1.3;
  m.phaseTimer = (m.phaseTimer ?? 8) - dt;
  const tx = playerPos.x + Math.cos(m.phantomAngle) * 12;
  const tz = playerPos.z + Math.sin(m.phantomAngle) * 12;
  const ty = playerPos.y + 22 + Math.sin(m.phantomAngle * 2.3) * 3;
  const k = Math.min(1, dt * 3);
  m.x += (tx - m.x) * k;
  m.y += (ty - m.y) * k;
  m.z += (tz - m.z) * k;
  if (m.phaseTimer <= 0) m.phantomPhase = 'dive';
}

/** 每帧推进：生成/AI/攻击/箭/燃烧/清理；lureFood = 玩家手持的繁殖食物（引诱用）；
 *  hostile=false（创造模式）时正常刷怪但 AI 失去目标（MC 创造规则：生物存在但不追击不伤害玩家） */
export function tickMobs(
  world: World,
  dt: number,
  playerPos: { x: number; y: number; z: number },
  onAttackPlayer: (damage: number) => void,
  lureFood?: string | null,
  hostile = true,
): void {
  const night = isNight();
  // 创造模式：刷怪/despawn/Boss 血条用真实位置；AI 仇恨目标用超远假目标（不追击、箭不伤人）
  const targetPos = hostile ? playerPos : { x: 1e9, y: -999, z: 1e9 };
  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnTimer = SPAWN_INTERVAL;
    // 夜晚刷敌对（60%），白天刷被动（20%）
    if (night ? Math.random() < 0.6 : Math.random() < 0.2) trySpawn(world, playerPos.x, playerPos.z);
  }

  // 失眠追踪（MC 幻翼前置，仅生存）：时钟自然跨日（t 由 ~1 绕回 0）累计 1 天；睡觉（夜晚时钟直接回拨到日出 0）清零
  const ct = worldClock.t;
  if (hostile) {
    if (lastClockT > 0.9 && ct < 0.1) phantomState.insomniaDays += 1;
    else if (ct < lastClockT - 0.2) phantomState.insomniaDays = 0;
    lastClockT = ct;
  }

  // 幻翼（MC 失眠惩罚）：失眠 ≥3 天的夜晚，玩家头顶高空来袭 1-3 只（仅主世界，场上限 3 只）
  phantomState.timer -= dt;
  if (hostile && night && world.terrain.kind !== 'nether' && world.terrain.kind !== 'end' && phantomState.insomniaDays >= 3 && phantomState.timer <= 0) {
    phantomState.timer = 30 + Math.random() * 30;
    const count = mobs.filter((m) => m.type === 'phantom').length;
    const n = Math.min(3 - count, 1 + Math.floor(Math.random() * 3));
    for (let k = 0; k < n; k++) {
      const ang = Math.random() * Math.PI * 2;
      const r = 8 + Math.random() * 8;
      const p = spawnMobAt('phantom', playerPos.x + Math.cos(ang) * r, playerPos.y + 20 + Math.random() * 6, playerPos.z + Math.sin(ang) * r);
      p.phantomPhase = 'circle';
      p.phantomAngle = Math.random() * Math.PI * 2;
      p.phaseTimer = 6 + Math.random() * 6;
    }
  }

  tickArrows(world, dt, targetPos, onAttackPlayer);

  // Boss 血条状态：凋灵/末影龙存活且玩家在附近（凋灵 48 格、龙全岛 96 格；无则清空）
  const boss = mobs.find((m) => (m.type === 'wither' && Math.hypot(m.x - playerPos.x, m.z - playerPos.z) < 48) || (m.type === 'ender_dragon' && Math.hypot(m.x - playerPos.x, m.z - playerPos.z) < 96));
  if (boss) {
    bossState.name = MOB_DEFS[boss.type].name;
    bossState.hp = Math.max(0, boss.hp);
    bossState.max = MOB_DEFS[boss.type].hp;
  } else if (bossState.name) {
    bossState.name = '';
    bossState.hp = 0;
  }

  tickDepth++; // 遍历中 damageMob 延迟移除（pendingKill）：避免反向遍历索引错位、当前 mob 被双结算
  for (let i = mobs.length - 1; i >= 0; i--) {
    const m = mobs[i];
    if (m.hp <= 0) continue; // 已被 damageMob 标记待移除（pendingKill）的死 mob 跳过
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
    // 末影龙：完全自管理飞行（穿方块、无环境伤害），跳过通用管线
    if (m.type === 'ender_dragon') {
      tickDragon(world, m, dt, targetPos, onAttackPlayer);
      continue;
    }
    // 白天自燃（需露天且头部不在水中；本地正在下雨则不烧——MC 只认雨，雪/干旱群系不保护）
    if (!night && def.burnsAtDay && !rainingAt(world, m) && exposedToSky(world, m)) {
      m.hp -= BURN_DAMAGE * dt;
      if (m.hp <= 0) {
        mobs.splice(i, 1);
        continue;
      }
    }

    const dx = targetPos.x - m.x;
    const dz = targetPos.z - m.z;
    const dist = Math.hypot(dx, dz); // 追击/攻击距离（创造模式为 ~1e9 假目标，AI 自然不追不攻）
    const distReal = Math.hypot(playerPos.x - m.x, playerPos.z - m.z); // despawn 用真实玩家距离
    let mx = 0;
    let mz = 0;

    // 距离消失（MC 简版）：敌对 >64 立即消失；32-64 持续远离 20-40s 随机刻消失；驯服/村民（非敌对）/Boss/铁傀儡不消失
    if (def.hostile && !m.tamed && m.type !== 'wither' && m.type !== 'shulker' && m.type !== 'iron_golem') {
      if (distReal > 64) {
        mobs.splice(i, 1);
        continue;
      }
      if (distReal > 32) {
        m.despawnTimer = (m.despawnTimer ?? 20 + Math.random() * 20) - dt;
        if (m.despawnTimer <= 0) {
          mobs.splice(i, 1);
          continue;
        }
      } else {
        m.despawnTimer = undefined;
      }
    }
    // 幻翼：三态自管理飞行（盘旋/俯冲/拉升；无重力碰撞，白天自燃走上方通用判定）
    if (m.type === 'phantom') {
      tickPhantom(m, dt, targetPos, onAttackPlayer);
      continue;
    }

    // 末影人水触掉血（MC：不论是否激怒；掉血即激怒并瞬移逃离）
    if (m.type === 'enderman' && isWaterId(world.getBlock(Math.floor(m.x), Math.floor(m.y), Math.floor(m.z)))) {
      damageMob(m, 2 * dt, undefined, 0, world);
      if (m.hp <= 0) continue;
      if ((m.teleportTimer ?? 0) <= 0) {
        teleportEnderman(world, m);
        m.teleportTimer = 1;
      }
    }

    // 猪灵端详金锭（以物易物）：静止 3s 不移动不攻击，到点丢出随机易物（MC）
    if (m.type === 'piglin' && (m.barterTimer ?? 0) > 0) {
      m.barterTimer = (m.barterTimer ?? 0) - dt;
      if (m.barterTimer <= 0) {
        const c = rollBarter();
        if (c.kind === 'block') spawnBlockDrop(BLOCK_BY_KEY[c.key].id, m.x, m.y + 0.5, m.z, c.count);
        else spawnMaterialDrop(c.key, m.x, m.y + 0.5, m.z, c.count);
      }
    } else if (m.fleeTimer > 0) {
      // 受击逃跑
      m.fleeTimer -= dt;
      const fx = m.x - m.fleeFromX;
      const fz = m.z - m.fleeFromZ;
      const fd = Math.hypot(fx, fz);
      if (fd > 0.01) {
        mx = (fx / fd) * def.speed * 1.5;
        mz = (fz / fd) * def.speed * 1.5;
      }
    } else if (def.hostile && (m.type !== 'spider' || night) && (m.type !== 'zombified_piglin' || (m.aggroTimer ?? 0) > 0) && (m.type !== 'wolf' || (!m.tamed && (m.aggroTimer ?? 0) > 0)) && (m.type !== 'enderman' || (m.aggroTimer ?? 0) > 0) && (m.type !== 'piglin' || ((m.aggroTimer ?? 0) > 0 || !wearsGoldArmor())) && (m.type !== 'iron_golem' || (m.aggroTimer ?? 0) > 0)) {
      // 敌对 AI（蜘蛛白天中立；僵尸猪灵/野狼/末影人未被激怒时中立；铁傀儡只对激怒它的玩家出手）
      if (m.type === 'slime') {
        // 史莱姆：蹦跳前进（MC 标志移动）——着地蓄力，起跳带冲量，滞空惯性
        if (m.onGround) {
          m.hopTimer = (m.hopTimer ?? 0.5) - dt;
          mx = 0;
          mz = 0;
          if (m.hopTimer <= 0) {
            m.hopTimer = 0.6 + Math.random() * 0.3;
            m.velY = 6.5;
            if (dist < CHASE_RANGE && dist > 0.01) {
              m.hopX = (dx / dist) * def.speed * 2;
              m.hopZ = (dz / dist) * def.speed * 2;
            } else {
              m.hopX = Math.cos(m.wanderDir) * def.speed;
              m.hopZ = Math.sin(m.wanderDir) * def.speed;
            }
          }
        } else {
          mx = m.hopX ?? 0;
          mz = m.hopZ ?? 0;
        }
        // 近战伤害按体型（MC：大 4 / 中 2 / 小 0——小史莱姆不伤人）
        m.attackCd -= dt;
        const slimeDmg = m.slimeSize === 1 ? 0 : def.damage * ((m.slimeSize ?? 4) / 4);
        if (slimeDmg > 0 && dist < def.attackRange && m.attackCd <= 0) {
          m.attackCd = def.attackCd;
          onAttackPlayer(slimeDmg);
        }
      } else if (m.type === 'shulker') {
        // 潜影贝：固着不动，12 格内开壳射追踪弹（MC；命中漂浮）
        m.arrowCd -= dt;
        if (dist < def.attackRange && m.arrowCd <= 0) {
          m.arrowCd = def.attackCd;
          spawnArrow(m, playerPos, 'shulker');
        }
      } else if (m.type === 'wither') {
        // 凋灵 Boss：悬浮追踪 + 每 2s 凋灵骷髅弹幕 + 每 4s 粉碎周围方块（MC）
        if (dist > 0.01 && dist < CHASE_RANGE * 2) {
          mx = (dx / dist) * def.speed;
          mz = (dz / dist) * def.speed;
        }
        m.arrowCd -= dt;
        if (dist < def.attackRange && m.arrowCd <= 0) {
          m.arrowCd = def.attackCd;
          spawnArrow(m, playerPos, 'wither_skull');
        }
        // 破坏周围 3×3×3 方块（防爆除外；MC 凋灵破阵）
        m.smashTimer = (m.smashTimer ?? 4) - dt;
        if (m.smashTimer <= 0) {
          m.smashTimer = 4;
          const bx = Math.floor(m.x);
          const by = Math.floor(m.y);
          const bz = Math.floor(m.z);
          for (let sx = -1; sx <= 1; sx++) {
            for (let sy = -1; sy <= 1; sy++) {
              for (let sz = -1; sz <= 1; sz++) {
                const id = world.getBlock(bx + sx, by + sy, bz + sz);
                if (id !== AIR && !BLOCKS[id]?.unbreakable && BLOCKS[id]?.pickTier !== 3 && !isWaterId(id) && !BLOCKS[id]?.lava) {
                  world.setBlock(bx + sx, by + sy, bz + sz, AIR);
                }
              }
            }
          }
        }
      } else if (m.type === 'enderman') {
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
      } else if (m.type === 'blaze') {
        // 烈焰人：保持 8-14 距离；MC 节奏——蓄力停顿 0.5s 后快速三连发，发完进入冷却
        if (dist > 14 && dist > 0.01) {
          mx = (dx / dist) * def.speed;
          mz = (dz / dist) * def.speed;
        } else if (dist < 8 && dist > 0.01) {
          mx = (-dx / dist) * def.speed;
          mz = (-dz / dist) * def.speed;
        }
        if ((m.burstLeft ?? 0) > 0) {
          m.burstCd = (m.burstCd ?? 0) - dt;
          if (m.burstCd <= 0) {
            m.burstLeft = (m.burstLeft ?? 1) - 1;
            m.burstCd = 0.15; // 三连发间隔（MC 快速连射）
            spawnArrow(m, playerPos, 'fireball');
            if ((m.burstLeft ?? 0) <= 0) m.arrowCd = def.attackCd; // 三连发完进入冷却
          }
        } else {
          m.arrowCd -= dt;
          if (dist < def.attackRange && m.arrowCd <= 0) {
            m.burstLeft = 3;
            m.burstCd = 0.5; // 蓄力停顿（MC 烈焰人起燃）
          }
        }
      } else if (m.type === 'skeleton') {
        // 保持 8-14 距离并射箭
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
          spawnArrow(m, playerPos, undefined);
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
          // 铁傀儡高伤 7-14 随机（MC 普通 7-21 取低段）
          onAttackPlayer(m.type === 'iron_golem' ? 7 + Math.floor(Math.random() * 8) : def.damage);
        }
      }
    } else {
      // 驯服的狼：护主（攻击玩家刚打过的目标）→ 跟随（远了传送跟上，MC）
      let handled = false;
      // 铁傀儡：猎杀 24 格内威胁村庄的敌对怪（MC 村庄守卫；未被玩家激怒时），无目标则锚定村庄游走
      if (m.type === 'iron_golem') {
        let target: Mob | null = null;
        let best = 24;
        for (const o of mobs) {
          if (o === m || !GOLEM_TARGETS.includes(o.type)) continue;
          const od = Math.hypot(o.x - m.x, o.z - m.z);
          if (od < best) {
            best = od;
            target = o;
          }
        }
        if (target) {
          handled = true;
          const tx = target.x - m.x;
          const tz = target.z - m.z;
          const td = Math.hypot(tx, tz);
          if (td > 0.01) {
            mx = (tx / td) * def.speed;
            mz = (tz / td) * def.speed;
          }
          m.attackCd -= dt;
          if (m.attackCd <= 0 && td < def.attackRange && Math.abs(target.y - m.y) < 2.5) {
            m.attackCd = def.attackCd;
            damageMob(target, 7 + Math.floor(Math.random() * 8), undefined, 0, world); // 高伤 7-14（MC 普通 7-21 取低段）
          }
        }
      }
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
      // 鸡下蛋：成年鸡每 5-10 分钟一个（MC），落在脚下
      if (m.type === 'chicken' && !m.baby) {
        m.eggTimer = (m.eggTimer ?? 300 + Math.random() * 300) - dt;
        if (m.eggTimer <= 0) {
          m.eggTimer = 300 + Math.random() * 300;
          spawnMaterialDrop('egg', m.x, m.y + 0.2, m.z, 1);
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
      } else if ((m.type === 'villager' || m.type === 'iron_golem') && m.homeX !== undefined && m.homeZ !== undefined) {
        // 村民/铁傀儡锚定村庄：走太远就回家，近处正常游走
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

    // 击退冲量（击退附魔）：独立于行为移动的位移，指数衰减
    if (m.kbx || m.kbz) {
      m.x += (m.kbx ?? 0) * dt;
      collideAxis(world, m, 0, (m.kbx ?? 0) * dt, HALF_W, HEIGHT);
      m.z += (m.kbz ?? 0) * dt;
      collideAxis(world, m, 2, (m.kbz ?? 0) * dt, HALF_W, HEIGHT);
      const decay = Math.exp(-8 * dt);
      m.kbx = (m.kbx ?? 0) * decay;
      if (Math.abs(m.kbx) < 0.1) m.kbx = 0;
      m.kbz = (m.kbz ?? 0) * decay;
      if (Math.abs(m.kbz) < 0.1) m.kbz = 0;
    }

    // 移动 + 碰撞（与玩家同一套物理；烈焰人悬浮无重力）
    m.x += mx * dt;
    const hitX = collideAxis(world, m, 0, mx * dt, HALF_W, HEIGHT);
    m.z += mz * dt;
    const hitZ = collideAxis(world, m, 2, mz * dt, HALF_W, HEIGHT);
    // 被 1 格障碍挡住时跳起
    if ((hitX || hitZ) && m.onGround) m.velY = 8.5;

    if (m.type === 'blaze' || m.type === 'ghast' || m.type === 'wither') {
      // 悬浮：相位起伏，不受重力（恶魂/凋灵起伏更慢）
      m.bob = (m.bob ?? Math.random() * 6) + dt * (m.type === 'blaze' ? 2 : 0.8);
      m.y += Math.sin(m.bob) * (m.type === 'blaze' ? 0.5 : 0.3) * dt;
      m.velY = 0;
    } else {
      m.velY = Math.max(m.velY - GRAVITY * dt, -50);
      if (m.type === 'chicken' && m.velY < -2) m.velY = -2; // 鸡缓降（MC：扑翼飘落，落地不摔伤）
      const dy = m.velY * dt;
      m.y += dy;
      const hitY = collideAxis(world, m, 1, dy, HALF_W, HEIGHT);
      if (hitY) {
        if (dy < 0) {
          m.onGround = true;
          // 摔落伤害（与玩家同公式：>3 格每格 1 点；鸡/幻翼/飞行者免疫，落水不摔伤）
          if (!FALL_IMMUNE.includes(m.type) && (m.fallDist ?? 0) > 3 && !isWaterId(world.getBlock(Math.floor(m.x), Math.floor(m.y), Math.floor(m.z)))) {
            if (damageMob(m, Math.floor((m.fallDist ?? 0) - 3), undefined, 0, world)) continue; // 摔死
          }
          m.fallDist = 0;
        }
        m.velY = 0;
      } else if (dy !== 0) {
        m.onGround = false;
      }
      // 滞空累计下落距离（上升抵扣，与玩家 fallDist 同语义）
      if (!m.onGround) m.fallDist = Math.max(0, (m.fallDist ?? 0) - m.velY * dt);
    }

    if (m.y < -10) {
      mobs.splice(i, 1);
    }
  }
  tickDepth--;
  // 统一清理遍历中 damageMob 标记的待移除 mob（pendingKill 延迟移除，避免反向遍历索引错位双结算）
  for (const dead of pendingKill) {
    const di = mobs.indexOf(dead);
    if (di >= 0) mobs.splice(di, 1);
  }
  pendingKill.length = 0;
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
    const hitR = m.type === 'ender_dragon' ? 2.6 : 0.9; // 龙体型大，判定放宽（MC 龙碰撞箱长约 8 格）
    if (Math.hypot(m.x - px, m.y + 0.9 - py, m.z - pz) < hitR) {
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
/** 末影龙击杀回调（lib/endfight.ts 注入：龙蛋 + 返回门激活；避免 mobs ↔ endfight 循环依赖） */
let dragonDeathHandler: ((world: World) => void) | null = null;
export function setDragonDeathHandler(h: (world: World) => void): void {
  dragonDeathHandler = h;
}

export function damageMob(mob: Mob, damage: number, attackerPos?: { x: number; z: number }, lootBonus = 0, world?: World, knockback = 0): boolean {
  mob.hp -= damage;  if (attackerPos) {
    lastPlayerTarget.mob = mob;
    lastPlayerTarget.at = performance.now() / 1000;
  }
  // 击退附魔：远离攻击者的水平冲量 + 小浮空（MC；Boss/铁傀儡/潜影贝免疫击退）
  if (knockback > 0 && attackerPos && !['wither', 'ender_dragon', 'iron_golem', 'shulker'].includes(mob.type)) {
    const dx = mob.x - attackerPos.x;
    const dz = mob.z - attackerPos.z;
    const d = Math.hypot(dx, dz) || 1;
    const power = knockback * 6; // MC 击退 I 约 3-4 格
    mob.kbx = (dx / d) * power;
    mob.kbz = (dz / d) * power;
    if (mob.onGround) mob.velY = 4;
  }
  // 僵尸猪灵：受伤激怒自身与 32 格内同伴（MC 群体仇恨）
  if (mob.type === 'zombified_piglin') {
    for (const m of mobs) {
      if (m.type === 'zombified_piglin' && Math.hypot(m.x - mob.x, m.z - mob.z) <= 32) m.aggroTimer = 40;
    }
  }
  // 猪灵：受伤激怒自身与 32 格内同伴（MC 群体仇恨；蛮兵不传染）
  if (mob.type === 'piglin') {
    for (const m of mobs) {
      if (m.type === 'piglin' && Math.hypot(m.x - mob.x, m.z - mob.z) <= 32) m.aggroTimer = 40;
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
  // 铁傀儡：玩家攻击它则仇恨玩家（MC 中立守卫反击）
  if (mob.type === 'iron_golem' && attackerPos) mob.aggroTimer = 40;
  // 玩家攻击村民：32 格内铁傀儡仇恨玩家（MC 村庄守卫护村）
  if (mob.type === 'villager' && attackerPos) {
    for (const m of mobs) {
      if (m.type === 'iron_golem' && Math.hypot(m.x - mob.x, m.z - mob.z) <= 32) m.aggroTimer = 40;
    }
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
  // 史莱姆：大/中击杀分裂 2-4 只小一档（MC 标志特性）——分裂替代普通掉落（黏液球只由最小档掉）
  if (mob.type === 'slime' && (mob.slimeSize ?? 4) > 1 && world) {
    const nextSize = ((mob.slimeSize ?? 4) / 2) as 2 | 1;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      mobs.push(makeSlime(mob.x + (Math.random() - 0.5) * 1.6, mob.y + 0.1, mob.z + (Math.random() - 0.5) * 1.6, nextSize));
    }
    const i2 = mobs.indexOf(mob);
    if (i2 >= 0) removeMob(mob);
    useGameStore.getState().addXp((mob.slimeSize ?? 4) === 4 ? 4 : 2); // MC：大 4 / 中 2
    return true;
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
  // 凋灵骷髅：3% 掉头骨（召唤凋灵的材料，MC 稀有掉落）
  if (mob.type === 'wither_skeleton' && Math.random() < 0.03) {
    spawnBlockDrop(BLOCK_BY_KEY.wither_skeleton_skull.id, mob.x, mob.y + 0.3, mob.z, 1);
  }
  // 末影龙：击杀结算（龙蛋 + 返回门激活，lib/endfight.ts）
  if (mob.type === 'ender_dragon' && world) dragonDeathHandler?.(world);
  // 经验只发玩家击杀（attackerPos 有值）；摔死/烧死/铁傀儡代打等环境击杀不发（MC 规则）
  if (attackerPos) {
    useGameStore.getState().addXp(mob.type === 'slime' ? 1 : (XP_MOB[mob.type] ?? 5)); // 小史莱姆 1（MC）；新物种未登记经验时按 5 兜底
  }
  removeMob(mob);
  return true;
}
