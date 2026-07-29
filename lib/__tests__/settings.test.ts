// 设置项：MC 辅助功能开关（自动跳跃/云/粒子）的默认值与部分更新
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, useGameStore } from '../store';

describe('设置项', () => {
  it('默认开启自动跳跃/云/粒子（MC 默认体验）', () => {
    expect(DEFAULT_SETTINGS.autoJump).toBe(true);
    expect(DEFAULT_SETTINGS.clouds).toBe(true);
    expect(DEFAULT_SETTINGS.particles).toBe(true);
  });

  it('updateSettings 部分更新，其他项保留', () => {
    useGameStore.getState().updateSettings({ autoJump: false });
    const cur = useGameStore.getState().settings;
    expect(cur.autoJump).toBe(false);
    expect(cur.fov).toBe(DEFAULT_SETTINGS.fov);
    expect(cur.clouds).toBe(true);
    useGameStore.getState().updateSettings({ autoJump: true });
    expect(useGameStore.getState().settings.autoJump).toBe(true);
  });
});
