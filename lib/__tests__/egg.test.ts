// 鸡蛋投掷：抛物线命中实心块碎裂（粒子），1/8 概率孵出小鸡（MC）

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { throwEgg } from '../actions';
import { BLOCK_BY_KEY } from '../blocks';
import { breakParticles } from '../game';
import { clearMobs, mobs } from '../mobs';
import { VOID_TERRAIN } from '../noise';
import { World } from '../world';

const K = (k: string) => BLOCK_BY_KEY[k].id;

function setup(): World {
  clearMobs();
  breakParticles.length = 0;
  const w = new World('egg-test', undefined, VOID_TERRAIN);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) w.getChunk(cx, cz);
  return w;
}

/** y=40 一层石头地面 */
function floor40(w: World): void {
  for (let x = 0; x <= 16; x++) for (let z = 0; z <= 16; z++) w.setBlock(x, 40, z, K('stone'));
}

beforeEach(() => {
  clearMobs();
  breakParticles.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('鸡蛋投掷', () => {
  it('抛物线命中地面碎裂：返回碎裂点并出粒子，不孵鸡时无生物', () => {
    const w = setup();
    floor40(w);
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // >= 1/8 不孵
    const hit = throwEgg(w, { x: 8.5, y: 44, z: 8.5 }, { x: 0, y: -1, z: 0.2 });
    expect(hit).not.toBeNull();
    // 碎裂点在自由空中，正下方是实心地面
    expect(w.getBlock(Math.floor(hit!.x), Math.floor(hit!.y - 0.5), Math.floor(hit!.z))).toBe(K('stone'));
    expect(breakParticles.length).toBe(1);
    expect(mobs.length).toBe(0);
  });

  it('命中墙面同样碎裂（水平投掷撞墙）', () => {
    const w = setup();
    for (let y = 41; y <= 46; y++) w.setBlock(12, y, 8, K('stone')); // x=12 一堵墙
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const hit = throwEgg(w, { x: 8.5, y: 44, z: 8.5 }, { x: 1, y: 0, z: 0 });
    expect(hit).not.toBeNull();
    expect(hit!.x).toBeLessThan(12); // 碎在墙前
    expect(breakParticles.length).toBe(1);
  });

  it('未命中（坠入虚空）返回 null 且无粒子', () => {
    const w = setup();
    const hit = throwEgg(w, { x: 8.5, y: 10, z: 8.5 }, { x: 0, y: -1, z: 0 });
    expect(hit).toBeNull();
    expect(breakParticles.length).toBe(0);
    expect(mobs.length).toBe(0);
  });

  it('1/8 概率孵出小鸡（幼体，MC）：random<1/8 孵、否则不孵', () => {
    const w = setup();
    floor40(w);
    // random = 0.05 < 1/8 → 孵出
    vi.spyOn(Math, 'random').mockReturnValue(0.05);
    const hit = throwEgg(w, { x: 8.5, y: 44, z: 8.5 }, { x: 0, y: -1, z: 0.2 });
    expect(mobs.length).toBe(1);
    expect(mobs[0].type).toBe('chicken');
    expect(mobs[0].baby).toBe(true);
    expect(mobs[0].growUp).toBe(90);
    // 小鸡在碎裂点旁
    expect(Math.hypot(mobs[0].x - hit!.x, mobs[0].y - hit!.y, mobs[0].z - hit!.z)).toBeLessThan(1);
    // random = 0.5 → 不孵
    clearMobs();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    throwEgg(w, { x: 8.5, y: 44, z: 8.5 }, { x: 0, y: -1, z: 0.2 });
    expect(mobs.length).toBe(0);
  });

  it('碎裂生成率约 1/8（800 次统计，容差 ±4σ）', () => {
    const w = setup();
    floor40(w);
    let hatched = 0;
    for (let i = 0; i < 800; i++) {
      clearMobs();
      throwEgg(w, { x: 8.5, y: 44, z: 8.5 }, { x: 0, y: -1, z: 0.2 });
      if (mobs.length > 0) hatched++;
    }
    const rate = hatched / 800;
    expect(rate).toBeGreaterThan(0.125 - 4 * 0.0117);
    expect(rate).toBeLessThan(0.125 + 4 * 0.0117);
  });
});
