// 药水效果：时效增益状态（速度/力量/抗火），tick 递减；饮用即施加（lib/brewing.ts 药水定义）

export interface Effects {
  /** 迅捷：+20% 移动速度 */
  speed: number;
  /** 力量：+2 攻击伤害 */
  strength: number;
  /** 抗火：免疫岩浆灼烧 */
  fireRes: number;
}

export const effects: Effects = { speed: 0, strength: 0, fireRes: 0 };

/** 每帧递减（秒） */
export function tickEffects(dt: number): void {
  effects.speed = Math.max(0, effects.speed - dt);
  effects.strength = Math.max(0, effects.strength - dt);
  effects.fireRes = Math.max(0, effects.fireRes - dt);
}

export function clearEffects(): void {
  effects.speed = 0;
  effects.strength = 0;
  effects.fireRes = 0;
}
