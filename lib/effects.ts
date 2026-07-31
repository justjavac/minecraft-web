// 药水/信标效果：时效增益状态，tick 递减；饮用药水（lib/brewing.ts）或信标金字塔（lib/beacon.ts）施加

export interface Effects {
  /** 迅捷：+20% 移动速度（II 级 +40%，见 effectLvls） */
  speed: number;
  /** 力量：+2 攻击伤害（II 级 +4，见 effectLvls） */
  strength: number;
  /** 抗火：免疫岩浆灼烧 */
  fireRes: number;
  /** 再生：每 2 秒回 1 点生命（II 级每 1 秒，见 effectLvls） */
  regen: number;
  /** 水肺：水下不耗氧气 */
  waterBreath: number;
  /** 急迫：+30% 挖掘速度（信标） */
  haste: number;
  /** 抗性：受伤减免 20%（信标） */
  resistance: number;
  /** 跳跃提升：跳得更高（信标） */
  jumpBoost: number;
  /** 漂浮：匀速上浮（潜影贝弹命中，MC） */
  levitation: number;
  /** 饥饿：exhaustion 持续额外消耗（腐肉 80%/生鸡肉 30% 概率获得 30s，MC；消耗速率见 lib/survival.ts） */
  hunger: number;
}

export const effects: Effects = { speed: 0, strength: 0, fireRes: 0, regen: 0, waterBreath: 0, haste: 0, resistance: 0, jumpBoost: 0, levitation: 0, hunger: 0 };

/** 药水效果等级（荧石粉增强版 = 2；仅时长字段 > 0 时有意义，读取处须先判时长） */
export const effectLvls: { speed: 1 | 2; strength: 1 | 2; regen: 1 | 2 } = { speed: 1, strength: 1, regen: 1 };

/** 每帧递减（秒） */
export function tickEffects(dt: number): void {
  effects.speed = Math.max(0, effects.speed - dt);
  effects.strength = Math.max(0, effects.strength - dt);
  effects.fireRes = Math.max(0, effects.fireRes - dt);
  effects.regen = Math.max(0, effects.regen - dt);
  effects.waterBreath = Math.max(0, effects.waterBreath - dt);
  effects.haste = Math.max(0, effects.haste - dt);
  effects.resistance = Math.max(0, effects.resistance - dt);
  effects.jumpBoost = Math.max(0, effects.jumpBoost - dt);
  effects.levitation = Math.max(0, effects.levitation - dt);
  effects.hunger = Math.max(0, effects.hunger - dt);
}

export function clearEffects(): void {
  effects.speed = 0;
  effects.strength = 0;
  effects.fireRes = 0;
  effects.regen = 0;
  effects.waterBreath = 0;
  effects.haste = 0;
  effects.resistance = 0;
  effects.jumpBoost = 0;
  effects.levitation = 0;
  effects.hunger = 0;
  effectLvls.speed = 1;
  effectLvls.strength = 1;
  effectLvls.regen = 1;
}
