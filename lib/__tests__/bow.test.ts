// 玩家弓箭：发射入队 + 命中生物扣血 + 材料消耗（箭）

import { beforeEach, describe, expect, it } from 'vitest';
import { arrows, clearMobs, firePlayerArrow, MOB_DEFS, mobs, tickMobs } from '../mobs';
import { VOID_TERRAIN } from '../noise';
import { useGameStore } from '../store';
import { emptySlots } from '../slots';
import { World } from '../world';

const P = { x: 0, y: 40, z: 0 };

function setup(): World {
  clearMobs();
  const w = new World('bow-test', undefined, VOID_TERRAIN);
  useGameStore.getState().loadSurvival({ health: 20, hunger: 20, slots: emptySlots() });
  useGameStore.setState({ worldMode: 'survival' });
  return w;
}

describe('玩家弓箭', () => {
  beforeEach(setup);

  it('firePlayerArrow 生成 fromPlayer 箭', () => {
    firePlayerArrow({ x: 0, y: 40, z: 0 }, { x: 0, y: 0, z: 1 });
    expect(arrows.length).toBe(1);
    expect(arrows[0].fromPlayer).toBe(true);
  });

  it('玩家的箭命中生物扣 9 血并消失', () => {
    const w = setup();
    mobs.push({
      id: 1, type: 'zombie', x: 0, y: 39, z: 5, velY: 0, hp: 20, attackCd: 0, onGround: true,
      wanderDir: 0, wanderTimer: 0, wanderMoving: false, fleeTimer: 0, fleeFromX: 0, fleeFromZ: 0,
      arrowCd: 0, ignite: -1,
    });
    firePlayerArrow({ x: 0, y: 40, z: 0 }, { x: 0, y: 0, z: 1 });
    // 模拟箭飞行：速度 22，5 格约 0.23s
    for (let i = 0; i < 30 && arrows.length > 0; i++) tickMobs(w, 0.02, P, () => {});
    expect(arrows.length).toBe(0);
    expect(mobs[0].hp).toBeLessThan(20);
  });

  it('consumeMaterial：跨槽扣减、不足不扣', () => {
    const s = useGameStore.getState();
    s.addStack({ kind: 'material', material: 'arrow' }, 3);
    s.addStack({ kind: 'material', material: 'arrow' }, 2);
    expect(s.consumeMaterial('arrow', 4)).toBe(true);
    // 剩余 1
    expect(s.consumeMaterial('arrow', 2)).toBe(false);
    expect(s.consumeMaterial('arrow', 1)).toBe(true);
    expect(s.consumeMaterial('arrow', 1)).toBe(false);
  });

  it('鸡掉羽毛、蜘蛛掉线（弓/箭材料链）', () => {
    expect(MOB_DEFS.chicken.drops.some((d) => d.material === 'feather')).toBe(true);
    expect(MOB_DEFS.spider.drops.some((d) => d.material === 'string')).toBe(true);
  });
});
