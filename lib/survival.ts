// 生存数值 tick：掉落伤害 / 溺水 / 消耗度 / 回血（MC 规则，纯逻辑可单测）

import { survivalStats } from './game';
import { MAX_HEALTH, MAX_HUNGER } from './store';

export interface SurvivalEnv {
  dt: number;
  flying: boolean;
  inWater: boolean;
  headInWater: boolean;
  onGround: boolean;
  velY: number;
}

/** 可变的生存记忆（组件用 ref 持有） */
export interface SurvivalMem {
  /** 当前累计下落距离（格） */
  fallDist: number;
  /** 剩余憋气秒数（MC 15 秒） */
  air: number;
  /** 回血计时器 */
  regenTick: number;
}

export interface SurvivalSnapshotLite {
  worldMode: string;
  health: number;
  hunger: number;
  saturation: number;
}

export interface SurvivalActions {
  damagePlayer: (amount: number) => void;
  setHealth: (v: number) => void;
  setHunger: (v: number) => void;
  setSaturation: (v: number) => void;
}

export function tickSurvival(
  env: SurvivalEnv,
  mem: SurvivalMem,
  s: SurvivalSnapshotLite,
  actions: SurvivalActions,
): void {
  if (s.worldMode !== 'survival') return;

  // 掉落伤害：空中累计下落距离，着地结算（>3 格起，MC 公式 floor(dist-3)）
  if (!env.flying && !env.inWater && !env.onGround && env.velY < 0) {
    mem.fallDist -= env.velY * env.dt;
  }
  if (env.onGround || env.inWater || env.flying) {
    if (env.onGround && !env.inWater && !env.flying && mem.fallDist > 3) {
      actions.damagePlayer(Math.floor(mem.fallDist - 3));
    }
    mem.fallDist = 0;
  }

  // 溺水：MC 氧气 15 秒，耗尽后每秒 2 点伤害
  if (env.headInWater && !env.flying) {
    mem.air -= env.dt;
    if (mem.air <= 0) {
      actions.damagePlayer(2);
      mem.air = 1;
    }
  } else {
    mem.air = 15;
  }

  // 消耗度（MC exhaustion）：满 4 先扣饱和度，饱和耗尽后扣饥饿
  if (survivalStats.exhaustion >= 4) {
    survivalStats.exhaustion -= 4;
    if (s.saturation > 0) actions.setSaturation(Math.max(0, s.saturation - 1));
    else actions.setHunger(Math.max(0, s.hunger - 1));
  }

  // MC 回血：满饥饿且有饱和度时 0.5s/点快速回血，否则 4s/点；空腹挨饿保底 1 点
  mem.regenTick += env.dt;
  const regenInterval = s.hunger >= MAX_HUNGER && s.saturation > 0 ? 0.5 : 4;
  if (mem.regenTick >= regenInterval) {
    mem.regenTick = 0;
    if (s.hunger >= 18 && s.health < MAX_HEALTH) {
      actions.setHealth(Math.min(MAX_HEALTH, s.health + 1));
      survivalStats.exhaustion += 6; // MC：回血本身也消耗能量
    } else if (s.hunger === 0 && s.health > 1) {
      actions.setHealth(s.health - 1);
    }
  }
}

export function resetSurvivalMem(mem: SurvivalMem): void {
  mem.fallDist = 0;
  mem.air = 15;
  mem.regenTick = 0;
}
