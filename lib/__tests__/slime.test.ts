// 史莱姆：三档体型、击杀分裂（MC 标志特性）、蹦跳移动、体型缩放伤害、黏液球/黏液块配方、沼泽刷怪

import { beforeEach, describe, expect, it } from 'vitest';
import { BLOCK_BY_KEY } from '../blocks';
import { clearDrops, itemDrops } from '../items';
import { clearMobs, damageMob, makeSlime, mobs, tickMobs, trySpawn } from '../mobs';
import { worldClock } from '../game';
import { VOID_TERRAIN } from '../noise';
import { RECIPES } from '../recipes';
import { emptySlots } from '../slots';
import { useGameStore } from '../store';
import { localIndex, World } from '../world';

const K = (k: string) => BLOCK_BY_KEY[k].id;

function setup(): World {
  clearMobs();
  clearDrops();
  useGameStore.setState({ worldMode: 'survival', xpTotal: 0, hotbarSlots: emptySlots(), selectedSlot: 0 });
  const w = new World('slime-test', undefined, VOID_TERRAIN);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) w.getChunk(cx, cz);
  for (let x = 0; x <= 16; x++) for (let z = 0; z <= 16; z++) w.setBlock(x, 40, z, K('grass'));
  return w;
}

beforeEach(() => {
  clearMobs();
  clearDrops();
});

describe('三档体型与分裂', () => {
  it('hp 按档：大 16 / 中 4 / 小 1（MC）', () => {
    expect(makeSlime(0, 0, 0, 4).hp).toBe(16);
    expect(makeSlime(0, 0, 0, 2).hp).toBe(4);
    expect(makeSlime(0, 0, 0, 1).hp).toBe(1);
  });

  it('杀大分裂 2-4 只中档（不掉黏液球）；杀中分裂 2-4 只小档（MC）', () => {
    const w = setup();
    const big = makeSlime(8.5, 41, 8.5, 4);
    mobs.push(big);
    damageMob(big, 999, undefined, 0, w);
    const mediums = mobs.filter((m) => m.type === 'slime' && m.slimeSize === 2);
    expect(mediums.length).toBeGreaterThanOrEqual(2);
    expect(mediums.length).toBeLessThanOrEqual(4);
    expect(mobs.includes(big)).toBe(false);
    expect(itemDrops.some((d) => d.drop.kind === 'material' && d.drop.material === 'slime_ball')).toBe(false); // 大档不掉球
    // 杀中 → 小档
    clearDrops();
    damageMob(mediums[0], 999, undefined, 0, w);
    const smalls = mobs.filter((m) => m.type === 'slime' && m.slimeSize === 1);
    expect(smalls.length).toBeGreaterThanOrEqual(2);
    expect(smalls.length).toBeLessThanOrEqual(4);
  });

  it('杀小：掉黏液球 0-2，不分裂（MC）', () => {
    const w = setup();
    let dropped = 0;
    for (let t = 0; t < 12; t++) {
      const small = makeSlime(8.5, 41, 8.5, 1);
      mobs.push(small);
      damageMob(small, 999, undefined, 0, w);
      expect(mobs.filter((m) => m.type === 'slime' && m.slimeSize === 1).length).toBe(0); // 无分裂
      if (itemDrops.some((d) => d.drop.kind === 'material' && d.drop.material === 'slime_ball')) dropped++;
      clearDrops();
    }
    expect(dropped).toBeGreaterThan(0); // 0-2 随机，12 次至少掉一次
    expect(mobs.length).toBe(0);
  });

  it('经验按档：大 4 / 中 2 / 小 1（MC）；环境击杀不发经验（仅玩家击杀发）', () => {
    const w = setup();
    const player = { x: 8.5, z: 8.5 };
    const big = makeSlime(8.5, 41, 8.5, 4);
    mobs.push(big);
    damageMob(big, 999, player, 0, w);
    expect(useGameStore.getState().xpTotal).toBe(4);
    const small = makeSlime(8.5, 41, 8.5, 1);
    mobs.push(small);
    damageMob(small, 999, player, 0, w);
    expect(useGameStore.getState().xpTotal).toBe(5); // +1
    // 环境击杀（无 attackerPos，如摔死/烧死）：MC 不发经验
    const mid = makeSlime(8.5, 41, 8.5, 2);
    mobs.push(mid);
    damageMob(mid, 999, undefined, 0, w);
    expect(useGameStore.getState().xpTotal).toBe(5); // 不变
  });
});

describe('蹦跳与伤害', () => {
  it('蹦跳前进：着地蓄力后跃起（velY>0 + 水平冲量），滞空保持冲量（MC 标志移动）', () => {
    const w = setup();
    const s = makeSlime(6.5, 41, 8.5, 4);
    mobs.push(s);
    const player = { x: 6.5, y: 41, z: 14.5 }; // 北侧 6 格
    const z0 = s.z;
    let jumped = false;
    for (let i = 0; i < 30; i++) {
      tickMobs(w, 0.1, player, () => undefined);
      if (s.velY > 0 || !s.onGround) jumped = true;
    }
    expect(jumped).toBe(true); // 至少跃起一次
    expect(s.z).toBeGreaterThan(z0); // 朝玩家方向推进
  });

  it('伤害按体型：大 4 / 中 2 / 小 0（小史莱姆不伤人，MC）', () => {
    const w = setup();
    const player = { x: 8.5, y: 41, z: 9.2 }; // 近身
    for (const [size, want] of [[4, 4], [2, 2], [1, 0]] as const) {
      clearMobs();
      const s = makeSlime(8.5, 41, 8.5, size);
      s.attackCd = 0;
      s.hopTimer = 999; // 冻结蹦跳，只测近战判定
      mobs.push(s);
      let dmg = 0;
      tickMobs(w, 0.1, player, (d) => (dmg += d));
      expect(dmg).toBe(want);
    }
  });
});

describe('刷怪与配方', () => {
  it('沼泽夜晚刷史莱姆（MC 沼泽规则）；生成大/中档', () => {
    const w = setup();
    // 铺大范围地表（spawn 环带可达 48 格，小地板全是虚空落点）
    for (let cx = -3; cx <= 3; cx++) {
      for (let cz = -3; cz <= 3; cz++) {
        const c = w.getChunk(cx, cz);
        for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) c.data[localIndex(x, 40, z)] = K('grass');
      }
    }
    // 强制沼泽群系（monkey-patch 地形查询）
    w.terrain.biomeAt = () => 'swamp';
    // 强制夜晚：worldClock.t = 0.75 附近（isNight 内部读 worldClock）
    worldClock.t = 0.75;
    let slimeSeen = false;
    for (let i = 0; i < 60 && !slimeSeen; i++) {
      trySpawn(w, 8.5, 8.5);
      slimeSeen = mobs.some((m) => m.type === 'slime');
    }
    expect(slimeSeen).toBe(true);
    for (const m of mobs.filter((m) => m.type === 'slime')) {
      expect([4, 2]).toContain(m.slimeSize);
    }
    worldClock.t = 0.3;
  });

  it('黏液块 9 球合成 / 1 块拆 9 球（MC）', () => {
    const r1 = RECIPES.find((r) => r.id === 'slime_block');
    expect(r1?.cost).toEqual([{ item: 'material:slime_ball', count: 9 }]);
    const r2 = RECIPES.find((r) => r.id === 'slime_ball_from_block');
    expect(r2?.out).toEqual({ kind: 'material', material: 'slime_ball', count: 9 });
  });
});
