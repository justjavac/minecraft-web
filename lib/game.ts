// 游戏运行时单例（非 React 响应式）：当前世界 + 玩家位置 + 相机 + 触屏输入

import type { Camera } from 'three';
import type { RaycastHit } from './raycast';
import type { World } from './world';

let activeWorld: World | null = null;

export function setActiveWorld(world: World | null): void {
  activeWorld = world;
}

export function getActiveWorld(): World | null {
  return activeWorld;
}

/** 玩家脚底位置，Player 每帧写入，WorldRenderer 读取用于 chunk 调度 */
export const playerPosition = { x: 8.5, y: 40, z: 8.5 };

/** 当前相机，Player 挂载时写入，供触屏按钮执行挖/放 */
export const cameraRef: { current: Camera | null } = { current: null };

/** 触屏输入，TouchControls 写入，Player 每帧读取 */
export const touchInput = {
  /** 摇杆：x 右为正，y 前为正，范围 [-1, 1]（模拟量，保留力度） */
  moveX: 0,
  moveY: 0,
  /** 视角拖动增量（像素），Player 消费后清零 */
  lookDX: 0,
  lookDY: 0,
  jump: false,
  down: false,
  /** 按住「挖」按钮 */
  dig: false,
};

/** 长按挖掘进度，Player 每帧写入，CrackOverlay 读取 */
export const digState = {
  target: null as [number, number, number] | null,
  /** 0..1，达到 1 时破坏方块 */
  progress: 0,
};

export interface BreakParticleEvent {
  x: number;
  y: number;
  z: number;
  /** atlas tile 索引（粒子贴图取该方块侧面） */
  tile: number;
}

/** 当前天空色（DayNight 每帧写入，UnderwaterFX 出水恢复时读取） */
export const atmosphere = { r: 0.53, g: 0.81, b: 0.92 };

/** 昼夜时钟（0=日出 0.25=正午 0.5=日落 0.75=午夜），DayNight 推进，随存档持久化 */
export const worldClock = { t: 0.3 };

/** 与 DayNight 一致的昼夜系数：1 白天，0 黑夜，日出日落平滑过渡 */
export function dayFactorAt(t: number): number {
  const e = Math.sin(t * Math.PI * 2);
  const x = Math.min(Math.max((e + 0.12) / 0.27, 0), 1);
  return x * x * (3 - 2 * x);
}

/** 受击无敌帧（伤害冷却），damagePlayer 判定用；负无穷表示从未受伤 */
export const hurtState = { lastAt: Number.NEGATIVE_INFINITY };

/** 生存模式消耗度（MC exhaustion）：满 4 消耗 1 点饱和度/饥饿 */
export const survivalStats = { exhaustion: 0 };

/** 每帧一次的准星射线结果：Player 计算，BlockHighlight / PlacePreview / 挖掘共用 */
export const targetBlock: { hit: RaycastHit | null } = { hit: null };

/** 方块破坏粒子事件队列，actions 写入，BreakParticles 每帧消费 */
export const breakParticles: BreakParticleEvent[] = [];

/** F3 调试面板的共享数据，Player / WorldRenderer / BlockHighlight 每帧写入 */
export const debugInfo = {
  fps: 0,
  x: 0,
  y: 0,
  z: 0,
  /** 水平朝向角（度，0 = -z） */
  yaw: 0,
  chunks: 0,
  dirty: 0,
  /** 游戏内时刻（0-23 点），DayNight 写入 */
  hour: 12,
  /** 准星目标方块描述，无目标为空串 */
  target: '',
};
