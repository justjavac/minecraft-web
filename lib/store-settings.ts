// 设置 slice：settings 字段 + updateSettings（改动即时生效并 localStorage 持久化）

import type { StateCreator } from 'zustand';
import { DEFAULT_SETTINGS, type GameStore, type Settings } from './store-types';

const SETTINGS_KEY = 'kimi-mc-settings';

/** 移动端/低端设备判定：触屏（coarse pointer）或 CPU 核心数 ≤4。仅影响无已保存设置时的默认值 */
function isMobileOrLowEnd(): boolean {
  try {
    if (window.matchMedia('(pointer: coarse)').matches) return true;
    if ((window.navigator.hardwareConcurrency ?? 8) <= 4) return true;
  } catch {
    // 检测异常时按非低端处理
  }
  return false;
}

function loadSettings(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    // 无已保存设置：移动端/低端设备默认降低渲染距离保帧率；已有用户设置不受影响
    if (!raw) {
      return isMobileOrLowEnd() ? { ...DEFAULT_SETTINGS, renderDistance: 4 } : DEFAULT_SETTINGS;
    }
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(s: Settings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // 隐私模式等场景下写入失败，忽略
  }
}

export interface SettingsSlice {
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
}

export const createSettingsSlice: StateCreator<GameStore, [], [], SettingsSlice> = (set) => ({
  settings: loadSettings(),
  updateSettings: (patch) =>
    set((s) => {
      const settings = { ...s.settings, ...patch };
      saveSettings(settings);
      return { settings };
    }),
});
