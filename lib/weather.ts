// 天气状态机：晴/雨/雷暴循环切换，雷暴带随机闪电亮度脉冲

export type WeatherKind = 'clear' | 'rain' | 'thunder';

export interface WeatherState {
  kind: WeatherKind;
  /** 距下次切换剩余秒数 */
  timer: number;
  /** 闪电亮度脉冲 0..1（雷暴时随机触发，快速衰减） */
  flash: number;
  /** 距下次闪电剩余秒数 */
  nextFlash: number;
}

/** 全局天气（DayNight 推进；首场雨在开局 3-8 分钟内到来） */
export const weather: WeatherState = { kind: 'clear', timer: 180 + Math.random() * 300, flash: 0, nextFlash: 4 };

/** 天气对天空/光照的压暗系数 */
export function weatherDim(kind: WeatherKind): number {
  return kind === 'clear' ? 1 : kind === 'rain' ? 0.6 : 0.35;
}

/** 各状态持续时长（秒）：晴长、雨中、雷暴短 */
const DURATIONS: Record<WeatherKind, [number, number]> = {
  clear: [300, 600],
  rain: [120, 240],
  thunder: [50, 90],
};

function nextKind(kind: WeatherKind, rand: () => number): WeatherKind {
  if (kind === 'clear') return rand() < 0.3 ? 'thunder' : 'rain';
  if (kind === 'rain') return rand() < 0.15 ? 'thunder' : 'clear';
  return rand() < 0.5 ? 'rain' : 'clear';
}

/** 每帧推进（暂停时不调用）；rand 可注入以便测试 */
export function tickWeather(state: WeatherState, dt: number, rand: () => number = Math.random): void {
  state.timer -= dt;
  if (state.timer <= 0) {
    state.kind = nextKind(state.kind, rand);
    const [min, max] = DURATIONS[state.kind];
    state.timer = min + rand() * (max - min);
    state.nextFlash = 2 + rand() * 5;
  }
  state.flash = Math.max(0, state.flash - dt * 3);
  if (state.kind === 'thunder') {
    state.nextFlash -= dt;
    if (state.nextFlash <= 0) {
      state.flash = 1;
      state.nextFlash = 2 + rand() * 5;
    }
  }
}
