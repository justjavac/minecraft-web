// 设置 slice：settings 字段 + updateSettings（改动即时生效并 localStorage 持久化）

import type { StateCreator } from 'zustand';
import { DEFAULT_SETTINGS, type GameStore, type Settings } from './store-types';

const SETTINGS_KEY = 'kimi-mc-settings';

function loadSettings(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
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
