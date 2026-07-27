// 信标：金字塔扫描（1-4 层）、矿物锭激活与效果切换、范围生效、金字塔损坏失效、合成配方

import { beforeEach, describe, expect, it } from 'vitest';
import { BLOCK_BY_KEY } from '../blocks';
import { activeBeacons, BEACON_RANGE, clearBeacons, scanPyramid, tickBeacons, interactBeacon } from '../beacon';
import { clearEffects, effects, tickEffects } from '../effects';
import { VOID_TERRAIN } from '../noise';
import { RECIPES } from '../recipes';
import { World } from '../world';

const K = (k: string) => BLOCK_BY_KEY[k].id;

function setup(): World {
  clearBeacons();
  clearEffects();
  const w = new World('beacon-test', undefined, VOID_TERRAIN);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) w.getChunk(cx, cz);
  return w;
}

/** 搭 layers 层金字塔（默认铁块）并把信标放在 (x, y, z)；第 n 层在 y-n 为 (2n+1)² */
function buildPyramid(w: World, x: number, y: number, z: number, layers: number, blockKey = 'iron_block'): void {
  for (let n = 1; n <= layers; n++) {
    for (let dx = -n; dx <= n; dx++) {
      for (let dz = -n; dz <= n; dz++) w.setBlock(x + dx, y - n, z + dz, K(blockKey));
    }
  }
  w.setBlock(x, y, z, K('beacon'));
}

beforeEach(() => {
  clearBeacons();
  clearEffects();
});

describe('金字塔扫描', () => {
  it('1-4 层金字塔分别识别（铁/金/钻/绿宝石块均可）', () => {
    const w = setup();
    for (let n = 1; n <= 4; n++) {
      const x = n * 12 - 12;
      buildPyramid(w, x, 60, 0, n);
      expect(scanPyramid(w, x, 60, 0)).toBe(n);
    }
    buildPyramid(w, 60, 60, 0, 1, 'gold_block');
    expect(scanPyramid(w, 60, 60, 0)).toBe(1);
    buildPyramid(w, 72, 60, 0, 1, 'diamond_block');
    expect(scanPyramid(w, 72, 60, 0)).toBe(1);
    buildPyramid(w, 84, 60, 0, 1, 'emerald_block');
    expect(scanPyramid(w, 84, 60, 0)).toBe(1);
  });

  it('缺一块降级到完整层数；非矿物块（石头）无效', () => {
    const w = setup();
    buildPyramid(w, 0, 60, 0, 2);
    w.setBlock(2, 58, 2, BLOCK_BY_KEY.stone.id); // 第二层角缺
    expect(scanPyramid(w, 0, 60, 0)).toBe(1);
    buildPyramid(w, 20, 60, 0, 1, 'stone');
    expect(scanPyramid(w, 20, 60, 0)).toBe(0);
  });
});

describe('激活与效果', () => {
  it('手持铁锭激活（消耗 1 个），再右击循环切换效果（不再耗锭）', () => {
    const w = setup();
    buildPyramid(w, 0, 60, 0, 2);
    const r1 = interactBeacon(w, 0, 60, 0, 'iron_ingot');
    expect(r1.ok).toBe(true);
    expect(r1.consume).toBe('iron_ingot');
    expect(activeBeacons.size).toBe(1);
    expect(activeBeacons.get('0,60,0')!.effect).toBe('speed'); // 默认第一个
    const r2 = interactBeacon(w, 0, 60, 0, null); // 切换不耗锭
    expect(r2.consume).toBeNull();
    expect(activeBeacons.get('0,60,0')!.effect).toBe('haste');
    interactBeacon(w, 0, 60, 0, null);
    expect(activeBeacons.get('0,60,0')!.effect).toBe('resistance'); // 2 层解锁抗性
  });

  it('层级门控：1 层只有速度/急迫，3 层解锁力量（MC）', () => {
    const w = setup();
    buildPyramid(w, 0, 60, 0, 1);
    interactBeacon(w, 0, 60, 0, 'gold_ingot');
    const seen: string[] = [];
    for (let i = 0; i < 2; i++) {
      seen.push(activeBeacons.get('0,60,0')!.effect);
      interactBeacon(w, 0, 60, 0, null);
    }
    expect(seen).toEqual(['speed', 'haste']); // 第 3 次切回 speed
    expect(activeBeacons.get('0,60,0')!.effect).toBe('speed');

    buildPyramid(w, 20, 60, 0, 3);
    interactBeacon(w, 20, 60, 0, 'diamond');
    const seen3: string[] = [];
    for (let i = 0; i < 5; i++) {
      seen3.push(activeBeacons.get('20,60,0')!.effect);
      interactBeacon(w, 20, 60, 0, null);
    }
    expect(seen3).toContain('strength');
    expect(seen3).toHaveLength(5); // 速度/急迫/抗性/跳跃/力量
  });

  it('无金字塔拒绝激活；徒手（无矿物锭）拒绝激活', () => {
    const w = setup();
    w.setBlock(0, 60, 0, K('beacon'));
    expect(interactBeacon(w, 0, 60, 0, 'iron_ingot').ok).toBe(false);
    expect(activeBeacons.size).toBe(0);
    buildPyramid(w, 20, 60, 0, 1);
    expect(interactBeacon(w, 20, 60, 0, null).ok).toBe(false);
    expect(interactBeacon(w, 20, 60, 0, 'coal').ok).toBe(false); // 煤不是支付物
    expect(activeBeacons.size).toBe(0);
  });
});

describe('范围生效', () => {
  it('范围内玩家持续获得效果，范围外没有；1 层范围 20（MC）', () => {
    const w = setup();
    buildPyramid(w, 0, 60, 0, 1);
    interactBeacon(w, 0, 60, 0, 'iron_ingot');
    expect(BEACON_RANGE[1]).toBe(20);
    tickBeacons(w, 10.5, 61, 0.5); // 距信标 10 格
    expect(effects.speed).toBeGreaterThan(0);
    clearEffects();
    tickBeacons(w, 30.5, 61, 0.5); // 距 30 格 > 20
    expect(effects.speed).toBe(0);
    // 效果会随时间递减，但信标每 tick 刷新到 5s
    tickBeacons(w, 10.5, 61, 0.5);
    tickEffects(2);
    expect(effects.speed).toBeCloseTo(3);
  });

  it('破坏金字塔（或信标）后信标失效，不再施加效果', () => {
    const w = setup();
    buildPyramid(w, 0, 60, 0, 1);
    interactBeacon(w, 0, 60, 0, 'iron_ingot');
    w.setBlock(1, 59, 0, BLOCK_BY_KEY.stone.id); // 金字塔缺角
    tickBeacons(w, 5.5, 61, 0.5);
    expect(activeBeacons.size).toBe(0);
    expect(effects.speed).toBe(0);
    // 信标方块被挖同理
    buildPyramid(w, 20, 60, 0, 1);
    interactBeacon(w, 20, 60, 0, 'iron_ingot');
    w.setBlock(20, 60, 0, BLOCK_BY_KEY.air.id);
    tickBeacons(w, 20.5, 61, 0.5);
    expect(activeBeacons.size).toBe(0);
  });
});

describe('合成配方', () => {
  it('信标：玻璃×5 + 黑曜石×3 + 下界之星×1（MC）', () => {
    const r = RECIPES.find((r) => r.id === 'beacon');
    expect(r).toBeDefined();
    const cost = new Map(r!.cost.map((c) => [c.item, c.count]));
    expect(cost.get(`block:${K('glass')}`)).toBe(5);
    expect(cost.get(`block:${K('obsidian')}`)).toBe(3);
    expect(cost.get('material:nether_star')).toBe(1);
  });
});
