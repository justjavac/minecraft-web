// 闪电实体（对齐 MC Java）：雷暴期间每 tick 每 chunk ~1/100000 概率在降雨区落雷。
// sim.ts 慢节奏折算：一拍 0.4s = 8 tick，按已加载 chunk 数放大单次概率（strikeChancePerBeat）。
// 落点选玩家附近 2-48 格内的降雨地表（MC 雷可劈到玩家近旁；选点参考 mobs.ts 刷怪的环带随机）。
// 命中效果（MC）：
// - 命中点 3 格内生物受 5 点伤害（玩家同样，由调用方注入 onAttackPlayer）
// - 苦力怕 → 充能苦力怕（powered，爆炸增强）、猪 → 僵尸猪灵——转化优先于伤害
// 未实现的 Java 行为（见注释）：
// - 村民 → 女巫：MOB_DEFS 无女巫类型（无投掷药水 AI），村民按普通生物吃 5 点伤害
// - 命中点可燃方块点火：仓库无火方块/火势蔓延系统（blocks.ts 无 fire），跳过
// 视听：命中即天空 flash（weather.flash=1）+ 可见 bolt（白色分段折线，存活 0.2s，DayNight 渲染）
// + WebAudio 合成雷声（sound.ts thunder，音量按距离衰减；96 格外只闪不炸）。

import { BLOCKS } from './blocks';
import { WORLD_HEIGHT } from './grid';
import { damageMob, mobs, spawnMobAt, type Mob } from './mobs';
import { thunder } from './sound';
import { isThundering, precipAt, weather } from './weather';
import type { World } from './world';
import { registerWorldScope } from './worldScope';

/** MC Java：雷暴时每 tick 每 chunk 的落雷概率 */
export const LIGHTNING_CHANCE_PER_CHUNK_TICK = 1 / 100000;
/** 慢节奏拍长（秒，与 sim.ts SLOW_INTERVAL 一致） */
const BEAT = 0.4;
/** 一拍折算的 MC tick 数（20 tick/s） */
const TICKS_PER_BEAT = BEAT * 20;

/** 雷击伤害（MC：5 点 = 2.5 心） */
export const STRIKE_DAMAGE = 5;
/** 命中判定半径（格） */
export const STRIKE_RADIUS = 3;
/** 雷声可闻距离（格；之外只闪不炸） */
const THUNDER_RANGE = 96;
/** bolt 存活时长（秒） */
export const BOLT_TTL = 0.2;

/** 一拍内发生至少一次落雷的概率（按已加载 chunk 数放大 MC 每 tick 每 chunk 概率） */
export function strikeChancePerBeat(loadedChunks: number): number {
  if (loadedChunks <= 0) return 0;
  return Math.min(1, loadedChunks * LIGHTNING_CHANCE_PER_CHUNK_TICK * TICKS_PER_BEAT);
}

/** 一道可见闪电 bolt：折点自顶向下（渲染方按相邻点连线） */
export interface Bolt {
  x: number;
  y: number;
  z: number;
  /** 剩余存活秒数 */
  ttl: number;
  points: { x: number; y: number; z: number }[];
}

/** 场上存活的 bolt（世界作用域状态，随世界清理） */
export const bolts: Bolt[] = [];

/** 生成折线 bolt：从命中点上方 55 格蜿蜒到落点 */
function makeBolt(x: number, y: number, z: number, rand: () => number): Bolt {
  const top = y + 55;
  const points = [{ x, y: top, z }];
  let px = x;
  let pz = z;
  for (let yy = top - 7; yy > y; yy -= 7) {
    px += (rand() - 0.5) * 4;
    pz += (rand() - 0.5) * 4;
    points.push({ x: px, y: yy, z: pz });
  }
  points.push({ x, y, z });
  return { x, y, z, ttl: BOLT_TTL, points };
}

/**
 * 落雷命中结算（MC）：3 格内生物 5 点伤害；苦力怕充能、猪变僵尸猪灵（转化优先于伤害）。
 * 返回受影响的生物（转化后的新生物计入）。world 用于伤害结算（末影人受击瞬移等）。
 */
export function strikeLightning(world: World, x: number, y: number, z: number): Mob[] {
  const affected: Mob[] = [];
  // 快照遍历：伤害/转化可能移除或新增生物
  for (const m of mobs.slice()) {
    if (Math.hypot(m.x - x, m.y - y, m.z - z) > STRIKE_RADIUS) continue;
    if (m.type === 'creeper' && !m.powered) {
      m.powered = true; // MC：雷击充能苦力怕（爆炸威力增强，见 mobs.ts explode）
      affected.push(m);
      continue;
    }
    if (m.type === 'pig') {
      // MC：猪被雷击变成僵尸猪灵（满血新生，继承位置）
      const i = mobs.indexOf(m);
      if (i >= 0) mobs.splice(i, 1);
      affected.push(spawnMobAt('zombified_piglin', m.x, m.y, m.z));
      continue;
    }
    damageMob(m, STRIKE_DAMAGE, undefined, 0, world);
    affected.push(m);
  }
  return affected;
}

let acc = 0;

/** 完整落雷（视听 + 命中结算）：flash、bolt、雷声（距离衰减）、生物伤害/转化、玩家伤害 */
function strike(
  world: World,
  x: number,
  y: number,
  z: number,
  playerPos: { x: number; y: number; z: number },
  onAttackPlayer: ((damage: number) => void) | undefined,
  rand: () => number,
): void {
  weather.flash = 1; // 天空闪光（DayNight 已有 flash 通道）
  bolts.push(makeBolt(x, y, z, rand));
  strikeLightning(world, x, y, z);
  const dist = Math.hypot(playerPos.x - x, playerPos.y - y, playerPos.z - z);
  // 雷声按距离衰减；超出可闻距离只闪不炸（MC 远处的雷只见光）
  if (dist <= THUNDER_RANGE) thunder(Math.max(0.15, 1 - dist / THUNDER_RANGE));
  // 玩家在命中范围内同样受 5 点伤害（MC）
  if (dist <= STRIKE_RADIUS) onAttackPlayer?.(STRIKE_DAMAGE);
}

/**
 * 每帧推进（DayNight 在未暂停时调用）：bolt 衰减 + 按拍掷落雷概率。
 * 仅雷暴且主世界结算；落点限降雨区地表（MC：雪/干旱群系不落雷）。
 */
export function tickLightning(
  world: World,
  dt: number,
  playerPos: { x: number; y: number; z: number },
  onAttackPlayer?: (damage: number) => void,
  rand: () => number = Math.random,
): void {
  for (let i = bolts.length - 1; i >= 0; i--) {
    bolts[i].ttl -= dt;
    if (bolts[i].ttl <= 0) bolts.splice(i, 1);
  }
  acc += dt;
  if (acc < BEAT) return;
  acc -= BEAT;
  if (!isThundering()) return;
  if (world.terrain.kind === 'nether' || world.terrain.kind === 'end') return; // 两维度无天气（MC）
  if (rand() >= strikeChancePerBeat(world.chunks.size)) return;
  // 选点：玩家附近 2-48 格随机（参考刷怪选点；不避开玩家——MC 雷可劈到玩家近旁），已加载 chunk 内的降雨地表
  for (let attempt = 0; attempt < 8; attempt++) {
    const ang = rand() * Math.PI * 2;
    const r = 2 + rand() * 46;
    const bx = Math.floor(playerPos.x + Math.cos(ang) * r);
    const bz = Math.floor(playerPos.z + Math.sin(ang) * r);
    if (!world.isChunkLoaded(bx, bz)) continue; // 读未加载 chunk 会触发隐式全量生成（卡顿）
    let y = WORLD_HEIGHT - 1;
    while (y > 0 && !BLOCKS[world.getBlock(bx, y, bz)]?.solid) y--;
    if (y <= 0) continue;
    if (precipAt(world.terrain, weather.kind, bx, y + 1, bz) !== 'rain') continue; // MC：只在降雨区落雷
    strike(world, bx + 0.5, y + 1, bz + 0.5, playerPos, onAttackPlayer, rand);
    return;
  }
}

/** 清空（测试/维度切换用） */
export function clearLightning(): void {
  bolts.length = 0;
  acc = 0;
}

// 世界作用域自注册（lib/worldScope.ts）：bolt 与节奏累计随世界清理
registerWorldScope({ name: 'lightning', clear: clearLightning });
