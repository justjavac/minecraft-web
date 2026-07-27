// 钓鱼：浮标抛投（抛物线 → 落水漂浮）→ 等待咬钩（5-30s，雨天 ×0.8，MC）→ 1.5s 窗口 → 收竿得渔获
// 概率表对齐 MC Java：85% 鱼（60% 鳕鱼/25% 鲑鱼/15% 热带鱼）、10% 垃圾、5% 宝藏

import { BLOCKS } from './blocks';
import { weather } from './weather';
import type { World } from './world';

export type BobberState = 'flying' | 'waiting' | 'bite';

export interface Bobber {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  state: BobberState;
  /** waiting：距咬钩剩余秒（挂墙为 Infinity）；bite：剩余窗口秒 */
  timer: number;
  /** 漂浮水面的 y（落水时记录；咬钩时短暂下沉） */
  floatY: number;
}

/** 当前浮标（至多一个；收竿/卸载清空） */
export const bobber: { current: Bobber | null } = { current: null };

/** 渔获表：weight 总和 100（MC 分层概率展开） */
export const CATCH_TABLE: { tier: 'fish' | 'junk' | 'treasure'; material: string; count: [number, number]; weight: number }[] = [
  { tier: 'fish', material: 'raw_cod', count: [1, 1], weight: 51 }, // 85% × 60%
  { tier: 'fish', material: 'raw_salmon', count: [1, 1], weight: 21 }, // 85% × 25%
  { tier: 'fish', material: 'tropical_fish', count: [1, 1], weight: 13 }, // 85% × 15%
  { tier: 'junk', material: 'bone', count: [1, 1], weight: 3 },
  { tier: 'junk', material: 'string', count: [1, 1], weight: 3 },
  { tier: 'junk', material: 'leather', count: [1, 1], weight: 2 },
  { tier: 'junk', material: 'stick', count: [1, 1], weight: 2 },
  { tier: 'treasure', material: 'gold_ingot', count: [1, 1], weight: 2 },
  { tier: 'treasure', material: 'lapis', count: [2, 3], weight: 3 },
];

/** 抛竿：沿视线抛物线飞出（MC 手感：略上扬） */
export function castBobber(origin: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }): void {
  const d = Math.max(Math.hypot(dir.x, dir.y, dir.z), 0.01);
  bobber.current = {
    x: origin.x,
    y: origin.y,
    z: origin.z,
    vx: (dir.x / d) * 11,
    vy: (dir.y / d) * 11 + 2.5,
    vz: (dir.z / d) * 11,
    state: 'flying',
    timer: 0,
    floatY: 0,
  };
}

/** 收竿：咬钩窗口内返回渔获（否则 null），浮标移除 */
export function reelIn(): { material: string; count: number } | null {
  const b = bobber.current;
  bobber.current = null;
  if (!b || b.state !== 'bite') return null;
  return rollCatch();
}

/** 下次咬钩等待秒（MC 5-30s 均匀；雨天 ×0.8） */
function nextBiteWait(): number {
  const base = 5 + Math.random() * 25;
  return weather.kind === 'clear' ? base : base * 0.8;
}

function rollCatch(): { material: string; count: number } {
  let roll = Math.random() * 100;
  for (const c of CATCH_TABLE) {
    roll -= c.weight;
    if (roll < 0) return { material: c.material, count: c.count[0] + Math.floor(Math.random() * (c.count[1] - c.count[0] + 1)) };
  }
  return { material: 'raw_cod', count: 1 };
}

/** 每 tick 推进浮标：飞行抛物线 → 落水漂浮 → 等待 → 咬钩下沉（1.5s 窗口错过回等待） */
export function tickFishing(world: World, dt: number): void {
  const b = bobber.current;
  if (!b) return;
  if (b.state === 'flying') {
    b.vy -= 18 * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
    const bx = Math.floor(b.x);
    const by = Math.floor(b.y);
    const bz = Math.floor(b.z);
    // 目标块未加载：直接消失（读块会触发隐式生成，卡顿）
    if (!world.chunks.has(`${bx >> 4},${bz >> 4}`)) {
      bobber.current = null;
      return;
    }
    const id = world.getBlock(bx, by, bz);
    const def = BLOCKS[id];
    if (def?.fluid) {
      // 落水：半浸漂浮，开始等待
      b.state = 'waiting';
      b.floatY = by + 1 - 0.2;
      b.y = b.floatY;
      b.vx = b.vy = b.vz = 0;
      b.timer = nextBiteWait();
    } else if (def?.solid) {
      // 挂墙/挂地：停住不咬钩（MC 浮标挂上后静置，可收竿）
      b.state = 'waiting';
      b.floatY = b.y;
      b.vx = b.vy = b.vz = 0;
      b.timer = Infinity;
    } else if (b.y < -8) {
      bobber.current = null;
    }
    return;
  }
  if (b.state === 'waiting') {
    // 脚下水被排干：浮标落地静置（不再咬钩）
    const below = world.getBlock(Math.floor(b.x), Math.floor(b.y - 0.5), Math.floor(b.z));
    if (b.floatY !== 0 && !BLOCKS[below]?.fluid && b.timer !== Infinity) b.timer = Infinity;
    b.timer -= dt;
    if (b.timer <= 0) {
      b.state = 'bite';
      b.timer = 1.5; // MC 咬钩窗口
      b.y = b.floatY - 0.25; // 浮标猛地下沉
    }
    return;
  }
  // bite：窗口倒计时，错过回等待重新计时
  b.timer -= dt;
  if (b.timer <= 0) {
    b.state = 'waiting';
    b.y = b.floatY;
    b.timer = nextBiteWait();
  }
}

/** 清空（维度切换/测试用） */
export function clearFishing(): void {
  bobber.current = null;
}
