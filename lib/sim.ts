// 统一模拟循环：每帧由 World.tsx 的主 useFrame 调用一次 tickWorld，原先散在
// World/Mobs/DayNight 三个组件 useFrame 里的世界 tick 全部收口到这里。
//
// 暂停策略（统一在此判定，消除过去「mobs 看 paused、熔炉故意不看」的语义混乱）：
// - paused 冻结「世界系统」：生物 AI、流体、重力、作物/树苗/柱状作物、昼夜时钟。
//   慢节奏系统消费累计模拟时间（accumulator）而非 performance.now 墙钟，
//   后台标签页切回不会爆发式补偿（dt 本身也已 clamp）。
// - 「站点系统」熔炉/酿造不受暂停门控：打开熔炉/酿造界面会解锁指针（paused=true），
//   门控会让烧炼/酿造整个冻结——保持既有行为。
// - 红石同站点系统：保持既有每帧实时结算（中继器/按钮/压力板 0.1s 级脉冲不能等慢节奏）。
// 玩家生存数值（tickSurvival）仍在 Player.tsx，不在此入口。

import { tickBrewing } from './brewing';
import { tickCrops } from './crops';
import { tickFluids } from './fluids';
import { tickFurnaces } from './furnace';
import { playerPosition, worldClock } from './game';
import { tickGravity } from './gravity';
import { tickGrowth } from './growth';
import { tickMobs } from './mobs';
import { rescanSources, tickRedstone } from './redstone';
import { tickSaplings } from './saplings';
import { useGameStore } from './store';
import type { World } from './world';

/** 单帧模拟 dt 上限（秒）：掉帧/后台切回时不放大步长，世界系统始终按小步长推进 */
const MAX_DT = 0.05;
/** 一昼夜 1200 秒（MC Java：全天 24000 tick = 20 分钟） */
const DAY_CYCLE_SECONDS = 1200;
/** 慢节奏系统（流体/重力/作物/树苗/柱状作物/红石电源重扫）的 tick 间隔（秒，模拟时间而非墙钟） */
const SLOW_INTERVAL = 0.4;

/** 慢节奏系统的模拟时间累加器（替代原 performance.now 墙钟：暂停/后台时不累计） */
let slowAcc = 0;

/** 重置模拟时钟（切换世界/维度时调用，避免旧累计带进新世界） */
export function resetSimClock(): void {
  slowAcc = 0;
}

/** 生物 AI 推进（原 Mobs.tsx useFrame 内的调用，参数语义不变） */
function tickMobsSystem(world: World, dt: number): void {
  const store = useGameStore.getState();
  const survival = store.worldMode === 'survival';
  const held = store.hotbarSlots[store.selectedSlot];
  const lureFood = held?.kind === 'material' ? held.material : null;
  // MC 创造模式正常刷怪（动物/怪物都有），只是敌对不追击不伤害——hostile=false 时 AI 用假目标
  tickMobs(
    world,
    dt,
    playerPosition,
    (dmg) => {
      if (survival && !useGameStore.getState().dead) useGameStore.getState().damagePlayer(dmg);
    },
    lureFood,
    survival,
  );
}

/** 统一模拟入口：每帧一次。rawDt 为渲染帧间隔（秒），内部统一 clamp 后分发 */
export function tickWorld(world: World, rawDt: number): void {
  const dt = Math.min(rawDt, MAX_DT);
  const paused = useGameStore.getState().paused;

  if (!paused) {
    // 昼夜时钟（原 DayNight 推进；DayNight 现在只读 worldClock.t 做视觉）
    worldClock.t = (worldClock.t + dt / DAY_CYCLE_SECONDS) % 1;
    try {
      tickMobsSystem(world, dt);
    } catch (err) {
      console.error('生物 tick 失败（下帧重试）', err);
    }
    // 慢节奏系统：消费累计模拟时间，每满 0.4s 结算一次（dt ≤ 0.05，每帧至多一次，不会补偿爆发）
    slowAcc += dt;
    if (slowAcc >= SLOW_INTERVAL) {
      slowAcc -= SLOW_INTERVAL;
      try {
        tickFluids(world);
        // 重力与流体同节奏：每 0.4s 下落一格（timer 0.08 < dt 保证每次结算恰好一格，
        // 与原「400ms 分支传 dt=0.2」的实际下落速度一致；dt 现在与节奏自洽）
        tickGravity(world, SLOW_INTERVAL);
        tickSaplings(world, SLOW_INTERVAL); // 内部按 2s 累计触发生长/凋零
        tickCrops(world, SLOW_INTERVAL); // 同上节奏推进小麦生长
        tickGrowth(world, SLOW_INTERVAL); // 柱状作物随机刻（仙人掌/甘蔗/竹子）
        rescanSources(world); // 重扫新加载 chunk 的电源（换维度/读档后恢复供能）
      } catch (err) {
        console.error('世界 tick 失败（下帧重试）', err);
      }
    }
  }

  // 红石 tick 每帧实时结算：中继器延迟翻转、按钮/侦测器/标靶脉冲（0.1s 级）、压力板检测
  try {
    tickRedstone(world, dt);
  } catch (err) {
    console.error('红石 tick 失败（下帧重试）', err);
  }
  // 站点系统不做暂停门控：打开熔炉/酿造界面会解锁指针（paused=true），门控会让烧炼/酿造整个冻结
  tickFurnaces(dt);
  tickBrewing(dt); // 酿造同理（MC 20s 一轮）
}
