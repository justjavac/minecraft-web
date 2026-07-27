// 药水/信标效果：时效增益状态，tick 递减；饮用药水（lib/brewing.ts）或信标金字塔（lib/beacon.ts）施加

export interface Effects {
  /** 迅捷：+20% 移动速度 */
  speed: number;
  /** 力量：+2 攻击伤害 */
  strength: number;
  /** 抗火：免疫岩浆灼烧 */
  fireRes: number;
  /** 再生：每 2 秒回 1 点生命 */
  regen: number;
  /** 急迫：+30% 挖掘速度（信标） */
  haste: number;
  /** 抗性：受伤减免 20%（信标） */
  resistance: number;
  /** 跳跃提升：跳得更高（信标） */
  jumpBoost: number;
  /** 漂浮：匀速上浮（潜影贝弹命中，MC） */
  levitation: number;
}

export const effects: Effects = { speed: 0, strength: 0, fireRes: 0, regen: 0, haste: 0, resistance: 0, jumpBoost: 0, levitation: 0 };

/** 每帧递减（秒） */
export function tickEffects(dt: number): void {
  effects.speed = Math.max(0, effects.speed - dt);
  effects.strength = Math.max(0, effects.strength - dt);
  effects.fireRes = Math.max(0, effects.fireRes - dt);
  effects.regen = Math.max(0, effects.regen - dt);
  effects.haste = Math.max(0, effects.haste - dt);
  effects.resistance = Math.max(0, effects.resistance - dt);
  effects.jumpBoost = Math.max(0, effects.jumpBoost - dt);
  effects.levitation = Math.max(0, effects.levitation - dt);
}

export function clearEffects(): void {
  effects.speed = 0;
  effects.strength = 0;
  effects.fireRes = 0;
  effects.regen = 0;
  effects.haste = 0;
  effects.resistance = 0;
  effects.jumpBoost = 0;
  effects.levitation = 0;
}
