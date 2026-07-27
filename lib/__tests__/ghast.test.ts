// 恶魂：悬浮漂移、爆裂火球（撞墙/命中爆炸）、恶魂之泪与火药用途

import { beforeEach, describe, expect, it } from 'vitest';
import { BREWING, POTIONS } from '../brewing';
import { effects, clearEffects } from '../effects';
import { survivalStats } from '../game';
import { clearDrops } from '../items';
import { arrows, clearMobs, MOB_DEFS, mobs, tickMobs } from '../mobs';
import { VOID_TERRAIN } from '../noise';
import { RECIPES } from '../recipes';
import { tickSurvival, type SurvivalMem } from '../survival';
import { World } from '../world';

const mkGhast = (x: number, y: number, z: number) => ({
  id: Math.random(), type: 'ghast' as const, x, y, z,
  velY: 0, hp: 10, attackCd: 0, onGround: false,
  wanderDir: 0, wanderTimer: 0, wanderMoving: false,
  fleeTimer: 0, fleeFromX: 0, fleeFromZ: 0, arrowCd: 0, ignite: -1,
});

function voidWorld(): World {
  const w = new World('ghast-test', undefined, VOID_TERRAIN);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) w.getChunk(cx, cz);
  return w;
}

beforeEach(() => {
  clearMobs();
  clearDrops();
  clearEffects();
  survivalStats.wither = 0;
});

describe('恶魂', () => {
  it('悬浮漂移不坠落，40 格内射出爆裂火球', () => {
    const w = voidWorld();
    const player = { x: 8.5, y: 60, z: 8.5 };
    mobs.push(mkGhast(28.5, 62, 8.5)); // 20 格
    const y0 = mobs[0].y;
    let spawned = 0;
    const before = arrows.length;
    for (let i = 0; i < 40; i++) {
      tickMobs(w, 0.1, player, () => undefined);
      spawned = arrows.length;
      if (spawned > before) break;
    }
    expect(Math.abs(mobs[0].y - y0)).toBeLessThan(2); // 悬浮不坠
    expect(arrows.length).toBeGreaterThan(before); // 射出火球
    expect(arrows[arrows.length - 1].kind).toBe('ghast');
  });

  it('爆裂火球命中玩家即爆炸（伤及玩家）', () => {
    const w = voidWorld();
    const player = { x: 8.5, y: 60, z: 8.5 };
    // 直接放一颗飞向玩家的爆裂球
    arrows.push({ id: 1, x: 10.5, y: 61, z: 8.5, vx: -12, vy: 0, vz: 0, age: 0, kind: 'ghast' });
    let dmg = 0;
    for (let i = 0; i < 30; i++) tickMobs(w, 0.1, player, (d) => (dmg += d));
    expect(dmg).toBeGreaterThan(0);
    expect(arrows.length).toBe(0); // 已爆
  });

  it('恶魂掉恶魂之泪与火药（defs）', () => {
    expect(MOB_DEFS.ghast.drops.some((d) => d.material === 'ghast_tear')).toBe(true);
    expect(MOB_DEFS.ghast.drops.some((d) => d.material === 'gunpowder')).toBe(true);
    expect(MOB_DEFS.creeper.drops.some((d) => d.material === 'gunpowder')).toBe(true);
  });
});

describe('再生药水与 TNT', () => {
  it('粗制 + 恶魂之泪 → 再生药水（MC）', () => {
    expect(BREWING['awkward+ghast_tear']).toBe('regeneration');
    expect(POTIONS.regeneration.effect).toBe('regen');
    expect(POTIONS.regeneration.duration).toBe(30);
  });

  it('再生效果：每 2 秒回 1 点生命（满血不回）', () => {
    effects.regen = 10;
    const mem: SurvivalMem = { fallDist: 0, air: 15, regenTick: 0, witherTick: 0, regenPotionTick: 0 };
    const s = { worldMode: 'survival', health: 10, hunger: 20, saturation: 20 };
    let healed = 0;
    for (let i = 0; i < 20; i++) {
      tickSurvival({ dt: 0.5, onGround: true, inWater: false, headInWater: false, flying: false, velY: 0 }, mem, s, {
        damagePlayer: () => undefined,
        setHealth: (v) => {
          healed = v - 10;
          s.health = v;
        },
        setHunger: () => undefined,
        setSaturation: () => undefined,
      });
    }
    expect(healed).toBeGreaterThanOrEqual(4); // 10 秒约 5 点
    effects.regen = 0;
  });

  it('TNT 配方：火药 ×5 + 沙子 ×4（MC）', () => {
    const r = RECIPES.find((x) => x.id === 'tnt')!;
    expect(r.cost).toContainEqual({ item: 'material:gunpowder', count: 5 });
    expect(r.cost.length).toBe(2);
  });
});
