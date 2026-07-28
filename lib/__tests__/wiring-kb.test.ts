// 击退附魔与金工具铁砧修复的接线测试
import { describe, expect, it } from 'vitest';
import { damageMob, clearMobs, mobs, spawnMobAt } from '../mobs';
import { toolRepairMaterial } from '../anvil';

describe('击退附魔', () => {
  it('命中后获得远离攻击者的水平冲量并小浮空；Boss 免疫', () => {
    clearMobs();
    const z = spawnMobAt('zombie', 10, 5, 10);
    z.onGround = true; // 浮空仅在地面上施加（MC 击退小跳）
    damageMob(z, 1, { x: 8, z: 10 }, 0, undefined, 2); // 击退 II
    expect(z.kbx).toBeGreaterThan(0); // 远离 x=8 → +x 方向
    expect(Math.abs(z.kbz ?? 0)).toBeLessThan(1e-6);
    expect(z.velY).toBeGreaterThan(0);

    const w = spawnMobAt('wither', 10, 5, 10);
    damageMob(w, 1, { x: 8, z: 10 }, 0, undefined, 2);
    expect(w.kbx ?? 0).toBe(0); // Boss 免疫击退（MC）
    expect(mobs.length).toBe(2);
  });
});

describe('金工具铁砧修复材料（MC：金→金锭）', () => {
  it('金质工具用金锭，木质工具仍用木板', () => {
    expect(toolRepairMaterial('golden_pickaxe')).toBe('material:gold_ingot');
    expect(toolRepairMaterial('golden_sword')).toBe('material:gold_ingot');
    expect(toolRepairMaterial('wooden_pickaxe')).toBe('block:oak_planks');
  });
});
