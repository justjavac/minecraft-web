// 钓鱼：抛竿落水漂浮、挂墙静置、等待→咬钩窗口、收竿渔获（MC 概率表）、雨天加速、钓竿配方

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BLOCK_BY_KEY } from '../blocks';
import { bobber, castBobber, CATCH_TABLE, clearFishing, reelIn, tickFishing } from '../fishing';
import { FOODS, SMELTING } from '../furnace';
import { VOID_TERRAIN } from '../noise';
import { RECIPES } from '../recipes';
import { weather } from '../weather';
import { World } from '../world';

const K = (k: string) => BLOCK_BY_KEY[k].id;

function setup(): World {
  clearFishing();
  const w = new World('fishing-test', undefined, VOID_TERRAIN);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) w.getChunk(cx, cz);
  return w;
}

/** 一池水：y=40 石底，y=41 水 */
function pond(w: World): void {
  for (let x = 4; x <= 12; x++) {
    for (let z = 4; z <= 12; z++) {
      w.setBlock(x, 40, z, K('stone'));
      w.setBlock(x, 41, z, K('water'));
    }
  }
}

beforeEach(() => {
  clearFishing();
  weather.kind = 'clear';
});

afterEach(() => {
  vi.restoreAllMocks();
  weather.kind = 'clear';
});

describe('抛竿与漂浮', () => {
  it('浮标抛物线飞行，落水后半浸漂浮并开始等待（MC）', () => {
    const w = setup();
    pond(w);
    castBobber({ x: 8.5, y: 45, z: 2.5 }, { x: 0, y: 0.2, z: 1 });
    expect(bobber.current?.state).toBe('flying');
    for (let i = 0; i < 60 && bobber.current?.state === 'flying'; i++) tickFishing(w, 0.05);
    const b = bobber.current!;
    expect(b.state).toBe('waiting');
    expect(b.y).toBeCloseTo(41.8, 1); // 水面顶 42 半浸
    expect(b.timer).toBeGreaterThan(0);
    expect(b.timer).toBeLessThanOrEqual(30);
  });

  it('挂在实心方块上：静置不咬钩（可收竿）', () => {
    const w = setup();
    for (let y = 41; y <= 45; y++) w.setBlock(8, y, 10, K('stone')); // 一堵墙
    castBobber({ x: 8.5, y: 43, z: 5.5 }, { x: 0, y: 0, z: 1 });
    for (let i = 0; i < 40 && bobber.current?.state === 'flying'; i++) tickFishing(w, 0.05);
    const b = bobber.current!;
    expect(b.state).toBe('waiting');
    expect(b.timer).toBe(Infinity); // 不咬钩
    expect(reelIn()).toBeNull(); // 收竿无渔获
    expect(bobber.current).toBeNull();
  });
});

describe('咬钩与收竿', () => {
  it('等待计时结束咬钩（浮标下沉），窗口内收竿得渔获；错过窗口回等待', () => {
    const w = setup();
    pond(w);
    vi.spyOn(Math, 'random').mockReturnValue(0.4); // 等待 5+0.4*25=15s；渔获 roll 40 → raw_cod
    castBobber({ x: 8.5, y: 45, z: 2.5 }, { x: 0, y: 0.2, z: 1 });
    for (let i = 0; i < 60 && bobber.current?.state === 'flying'; i++) tickFishing(w, 0.05);
    const b = bobber.current!;
    expect(b.state).toBe('waiting');
    expect(b.timer).toBeCloseTo(15, 0);
    // 推进到咬钩
    for (let i = 0; i < 40 && b.state === 'waiting'; i++) tickFishing(w, 0.5);
    expect(b.state).toBe('bite');
    expect(b.y).toBeLessThan(b.floatY); // 下沉
    // 窗口内收竿 → raw_cod（roll 40 落在鳕鱼 51 权重内）
    const got = reelIn();
    expect(got).toEqual({ material: 'raw_cod', count: 1 });

    // 错过窗口：再抛一次，bite 后不收竿，1.5s 后回 waiting
    castBobber({ x: 8.5, y: 45, z: 2.5 }, { x: 0, y: 0.2, z: 1 });
    for (let i = 0; i < 60 && bobber.current?.state === 'flying'; i++) tickFishing(w, 0.05);
    for (let i = 0; i < 40 && bobber.current!.state === 'waiting'; i++) tickFishing(w, 0.5);
    expect(bobber.current!.state).toBe('bite');
    for (let i = 0; i < 4; i++) tickFishing(w, 0.5); // 2s > 1.5s 窗口
    expect(bobber.current!.state).toBe('waiting');
  });

  it('渔获概率表：85% 鱼 / 10% 垃圾 / 5% 宝藏（按 roll 区间验证）', () => {
    const w = setup();
    pond(w);
    const catchAt = (roll: number): string | null => {
      clearFishing();
      castBobber({ x: 8.5, y: 45, z: 2.5 }, { x: 0, y: 0.2, z: 1 });
      for (let i = 0; i < 60 && bobber.current?.state === 'flying'; i++) tickFishing(w, 0.05);
      bobber.current!.state = 'bite';
      bobber.current!.timer = 1;
      vi.spyOn(Math, 'random').mockReturnValue(roll / 100);
      const got = reelIn();
      return got?.material ?? null;
    };
    expect(catchAt(10)).toBe('raw_cod'); // 0-51
    expect(catchAt(60)).toBe('raw_salmon'); // 51-72
    expect(catchAt(80)).toBe('tropical_fish'); // 72-85
    expect(['bone', 'string', 'leather', 'stick']).toContain(catchAt(90)); // 85-95 垃圾
    expect(['gold_ingot', 'lapis']).toContain(catchAt(97)); // 95-100 宝藏
    // 权重和 = 100
    expect(CATCH_TABLE.reduce((n, c) => n + c.weight, 0)).toBe(100);
  });

  it('雨天等待 ×0.8（MC 雨天更好钓）', () => {
    const w = setup();
    pond(w);
    weather.kind = 'rain';
    vi.spyOn(Math, 'random').mockReturnValue(0.4); // 基础 15s × 0.8 = 12s
    castBobber({ x: 8.5, y: 45, z: 2.5 }, { x: 0, y: 0.2, z: 1 });
    for (let i = 0; i < 60 && bobber.current?.state === 'flying'; i++) tickFishing(w, 0.05);
    expect(bobber.current!.timer).toBeCloseTo(12, 0);
  });
});

describe('渔获与配方', () => {
  it('鱼类可食用、可烧熟（MC）；钓竿 3 木棍 + 2 线', () => {
    expect(FOODS.raw_cod.hunger).toBe(2);
    expect(FOODS.cooked_salmon.hunger).toBe(6);
    expect(SMELTING['material:raw_cod'].out).toBe('material:cooked_cod');
    expect(SMELTING['material:raw_salmon'].out).toBe('material:cooked_salmon');
    const r = RECIPES.find((r) => r.id === 'fishing_rod');
    expect(r).toBeDefined();
    const cost = new Map(r!.cost.map((c) => [c.item, c.count]));
    expect(cost.get('material:stick')).toBe(3);
    expect(cost.get('material:string')).toBe(2);
  });
});
