// 天气状态机：切换序列合法 + 雷暴闪电脉冲 + 压暗系数 + Java 时长区间 + 跨模块契约函数

import { afterEach, describe, expect, it } from 'vitest';
import { clearWeather, isThundering, precipForBiome, tickWeather, weather, weatherDim, type WeatherState } from '../weather';

const mk = (): WeatherState => ({ kind: 'clear', timer: 10, flash: 0, nextFlash: 2 });

describe('天气状态机', () => {
  it('计时到期切换天气，且不会停留在非法状态', { timeout: 20000 }, () => {
    const s = mk();
    const kinds = new Set<string>();
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let i = 0; i < 200000; i++) {
      tickWeather(s, 1, rand);
      kinds.add(s.kind);
      expect(['clear', 'rain', 'thunder']).toContain(s.kind);
      expect(s.timer).toBeGreaterThan(0);
    }
    // 二十万秒模拟中三种天气都出现过
    expect(kinds.size).toBe(3);
  });

  it('持续时长对齐 MC Java：晴 10-150min、雨 10-20min、雷暴 3-13min', () => {
    const RANGES: Record<string, [number, number]> = {
      clear: [600, 9000],
      rain: [600, 1200],
      thunder: [180, 780],
    };
    const s: WeatherState = { kind: 'clear', timer: 0.5, flash: 0, nextFlash: 2 };
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const seen = new Set<string>();
    for (let i = 0; i < 200000 && seen.size < 3; i++) {
      const before = s.kind;
      tickWeather(s, 1, rand);
      if (s.kind !== before) {
        const [min, max] = RANGES[s.kind];
        expect(s.timer).toBeGreaterThanOrEqual(min);
        expect(s.timer).toBeLessThanOrEqual(max);
        seen.add(s.kind);
      }
    }
    expect(seen.size).toBe(3); // 三种天气的时长都被抽样验证过
  });

  it('雷暴时产生闪电脉冲并衰减', () => {
    const s: WeatherState = { kind: 'thunder', timer: 60, flash: 0, nextFlash: 0.5 };
    tickWeather(s, 0.6, () => 0.5);
    expect(s.flash).toBeGreaterThan(0.8); // 刚闪过
    tickWeather(s, 0.3, () => 0.5);
    expect(s.flash).toBeLessThan(0.5); // 快速衰减
  });

  it('晴天不闪电', () => {
    const s: WeatherState = { kind: 'clear', timer: 60, flash: 0, nextFlash: 0.5 };
    tickWeather(s, 1, () => 0.5);
    expect(s.flash).toBe(0);
  });

  it('压暗系数：晴 1，雨 0.6，雷暴 0.35', () => {
    expect(weatherDim('clear')).toBe(1);
    expect(weatherDim('rain')).toBe(0.6);
    expect(weatherDim('thunder')).toBe(0.35);
  });
});

describe('天气契约函数（跨模块：睡觉放晴/雷暴判定）', () => {
  const saved = { ...weather };
  afterEach(() => Object.assign(weather, saved));

  it('isThundering 跟随全局天气状态', () => {
    weather.kind = 'thunder';
    expect(isThundering()).toBe(true);
    weather.kind = 'rain';
    expect(isThundering()).toBe(false);
    weather.kind = 'clear';
    expect(isThundering()).toBe(false);
  });

  it('clearWeather 立即转晴并把计时重置到晴天区间', () => {
    weather.kind = 'thunder';
    weather.timer = 5;
    weather.flash = 0.8;
    clearWeather();
    expect(weather.kind).toBe('clear');
    expect(weather.flash).toBe(0);
    expect(weather.timer).toBeGreaterThanOrEqual(600);
    expect(weather.timer).toBeLessThanOrEqual(9000);
  });
});

describe('群系降水（MC：干旱无降水、寒冷降雪、雪线以上降雪）', () => {
  it('干旱群系无降水', () => {
    expect(precipForBiome('desert')).toBe('none');
    expect(precipForBiome('badlands')).toBe('none');
    expect(precipForBiome('savanna')).toBe('none');
  });
  it('寒冷群系降雪', () => {
    expect(precipForBiome('snowy')).toBe('snow');
    expect(precipForBiome('ice_spikes')).toBe('snow');
    expect(precipForBiome('taiga')).toBe('snow');
  });
  it('下界群系无天气', () => {
    expect(precipForBiome('nether')).toBe('none');
    expect(precipForBiome('soul_sand_valley')).toBe('none');
  });
  it('温带群系下雨，雪线以上降雪', () => {
    expect(precipForBiome('plains')).toBe('rain');
    expect(precipForBiome('jungle')).toBe('rain');
    expect(precipForBiome('mountains', 100, 90)).toBe('snow'); // y≥雪线
    expect(precipForBiome('mountains', 70, 90)).toBe('rain'); // 山麓下雨
  });
});
