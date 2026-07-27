// 下界传送门：框检测、打火石点燃、破坏联动熄灭；砂砾掉燧石

import { beforeEach, describe, expect, it } from 'vitest';
import { breakBlock } from '../actions';
import { AIR, BLOCK_BY_KEY } from '../blocks';
import { clearDrops, itemDrops } from '../items';
import { VOID_TERRAIN } from '../noise';
import { clearRedstone } from '../redstone';
import { isPortalId, tryIgnitePortal } from '../portal';
import { useGameStore } from '../store';
import { emptySlots } from '../slots';
import { World } from '../world';

const OBS = () => BLOCK_BY_KEY.obsidian.id;

function setup(): World {
  clearDrops();
  clearRedstone();
  const w = new World('portal-test', undefined, VOID_TERRAIN);
  useGameStore.getState().loadSurvival({ health: 20, hunger: 20, slots: emptySlots() });
  useGameStore.setState({ worldMode: 'survival' });
  return w;
}

beforeEach(setup);

/** 建一个 4×5 门框（内部 2×3），底边在 y=30，沿 x 展开 */
function buildFrame(w: World, ox: number, oz: number): void {
  for (let dy = 30; dy <= 34; dy++) {
    w.setBlock(ox, dy, oz, OBS());
    w.setBlock(ox + 3, dy, oz, OBS());
  }
  for (let dx = 0; dx <= 3; dx++) {
    w.setBlock(ox + dx, 30, oz, OBS());
    w.setBlock(ox + dx, 34, oz, OBS());
  }
}

describe('传送门点燃', () => {
  it('完整 4×5 框内部点燃：内部 2×3 填满门块（朝 ±z 面板）', () => {
    const w = setup();
    buildFrame(w, 4, 4);
    expect(tryIgnitePortal(w, 5, 31, 4)).toBe(true);
    for (let dx = 1; dx <= 2; dx++) {
      for (let dy = 31; dy <= 33; dy++) {
        expect(w.getBlock(4 + dx, dy, 4)).toBe(BLOCK_BY_KEY.nether_portal_ns.id);
      }
    }
  });

  it('沿 z 展开的门框点燃后为朝 ±x 面板', () => {
    const w = setup();
    // 门框沿 z 展开：在 z 向建同样的框
    for (let dy = 30; dy <= 34; dy++) {
      w.setBlock(8, dy, 4, OBS());
      w.setBlock(8, dy, 7, OBS());
    }
    for (let dz = 4; dz <= 7; dz++) {
      w.setBlock(8, 30, dz, OBS());
      w.setBlock(8, 34, dz, OBS());
    }
    expect(tryIgnitePortal(w, 8, 31, 5)).toBe(true);
    expect(w.getBlock(8, 31, 5)).toBe(BLOCK_BY_KEY.nether_portal_we.id);
  });

  it('缺角的框也能点燃（MC：门框角可选）；断柱的框点不燃', () => {
    const w = setup();
    buildFrame(w, 4, 4);
    // MC 规则：四角是装饰，缺失不影响点燃
    w.setBlock(4, 30, 4, AIR);
    w.setBlock(7, 34, 4, AIR);
    expect(tryIgnitePortal(w, 5, 31, 4)).toBe(true);
    // 断柱（非角黑曜石）则点不燃
    const w2 = setup();
    buildFrame(w2, 4, 4);
    w2.setBlock(4, 31, 4, AIR);
    expect(tryIgnitePortal(w2, 5, 31, 4)).toBe(false);
  });

  it('内部不足 3 高的框点不燃', () => {
    const w = setup();
    // 4×4 框（内部 2×2，不足 3 高）
    for (let dy = 30; dy <= 33; dy++) {
      w.setBlock(4, dy, 8, OBS());
      w.setBlock(7, dy, 8, OBS());
    }
    for (let dx = 4; dx <= 7; dx++) {
      w.setBlock(dx, 30, 8, OBS());
      w.setBlock(dx, 33, 8, OBS());
    }
    expect(tryIgnitePortal(w, 5, 31, 8)).toBe(false);
  });
});

describe('破坏联动', () => {
  it('挖断门框非角黑曜石，整片门熄灭', () => {
    const w = setup();
    buildFrame(w, 4, 4);
    expect(tryIgnitePortal(w, 5, 31, 4)).toBe(true);
    breakBlock(w, 5, 30, 4); // 挖底边（门正下方的黑曜石）
    for (let dx = 1; dx <= 2; dx++) {
      for (let dy = 31; dy <= 33; dy++) {
        expect(isPortalId(w.getBlock(4 + dx, dy, 4))).toBe(false);
      }
    }
  });

  it('砂砾 10% 掉燧石（大数定律覆盖两种结果）', () => {
    const w = setup();
    const gravelId = BLOCK_BY_KEY.gravel.id;
    let flint = 0;
    let gravel = 0;
    for (let i = 0; i < 200; i++) {
      clearDrops();
      breakBlock(w, 4, 40, 4);
      w.setBlock(4, 40, 4, gravelId);
      for (const d of itemDrops) {
        if (d.drop.kind === 'material' && d.drop.material === 'flint') flint++;
        if (d.drop.kind === 'block' && d.drop.blockId === gravelId) gravel++;
      }
    }
    expect(flint).toBeGreaterThan(5); // 期望 ~20
    expect(gravel).toBeGreaterThan(150);
  });
});
