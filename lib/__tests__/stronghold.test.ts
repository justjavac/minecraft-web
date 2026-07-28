// 要塞与末影之眼：环带定位、地下结构生成（12 框架门房间）、嵌眼激活传送门、投掷飞行与碎裂/掉落、合成配方

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BLOCK_BY_KEY } from '../blocks';
import { clearDrops, itemDrops } from '../items';
import { arrows, clearMobs, fireEyeOfEnder, tickMobs } from '../mobs';
import { VOID_TERRAIN } from '../noise';
import { RECIPES } from '../recipes';
import { applyStronghold, fillPortalFrame, nearestStronghold, STRONGHOLD_Y, strongholds } from '../stronghold';
import { CHUNK_SIZE, CHUNK_VOLUME, localIndex, World } from '../world';

const K = (k: string) => BLOCK_BY_KEY[k].id;

function setup(): World {
  clearMobs();
  clearDrops();
  const w = new World('stronghold-test', undefined, VOID_TERRAIN);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) w.getChunk(cx, cz);
  return w;
}

beforeEach(() => {
  clearMobs();
  clearDrops();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('要塞定位', () => {
  it('8 座要塞环带分布（半径 1000-1800），同种子确定一致', () => {
    const a = strongholds(12345);
    expect(a).toHaveLength(8);
    for (const s of a) {
      const r = Math.hypot(s.x, s.z);
      expect(r).toBeGreaterThanOrEqual(990); // 取整误差容差
      expect(r).toBeLessThanOrEqual(1810);
    }
    expect(strongholds(12345)).toEqual(a); // 确定性
    expect(strongholds(54321)).not.toEqual(a); // 不同种子不同布局
  });

  it('nearestStronghold 返回距离最近的一座', () => {
    const list = strongholds(777);
    const target = list[3];
    const near = nearestStronghold(777, target.x + 5, target.z - 3);
    expect(near).toEqual(target);
  });
});

describe('要塞结构生成', () => {
  it('末地门房间：12 框架围 3×3 岩浆池，石砖外壳 + 宝箱 + 火把', () => {
    const sh = 999;
    const spot = strongholds(sh)[0];
    const ccx = Math.floor(spot.x / CHUNK_SIZE);
    const ccz = Math.floor(spot.z / CHUNK_SIZE);
    const data = new Uint16Array(CHUNK_VOLUME).fill(K('stone'));
    // 要塞跨多 chunk：写入中心及相邻 chunk
    for (let cx = ccx - 1; cx <= ccx + 1; cx++) {
      for (let cz = ccz - 1; cz <= ccz + 1; cz++) applyStronghold(sh, cx, cz, new Uint16Array(CHUNK_VOLUME).fill(K('stone')));
    }
    applyStronghold(sh, ccx, ccz, data);
    const y = STRONGHOLD_Y;
    const at = (x: number, yy: number, z: number) => data[localIndex(x - ccx * CHUNK_SIZE, yy, z - ccz * CHUNK_SIZE)];
    // 12 框架（5×5 边圈去角）——中心 chunk 必含全部 12 框（HALF=12 > 框架距中心 2）
    let frames = 0;
    let eyes = 0;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
        const corner = Math.abs(dx) === 2 && Math.abs(dz) === 2;
        if (!edge || corner) continue;
        const id = at(spot.x + dx, y + 1, spot.z + dz);
        if (id === K('end_portal_frame')) frames++;
        else if (id === K('end_portal_frame_eye')) {
          frames++;
          eyes++;
        }
      }
    }
    expect(frames).toBe(12);
    expect(eyes).toBeLessThanOrEqual(12); // 10% 预嵌眼（可能为 0）
    // 中央 3×3 岩浆池
    expect(at(spot.x, y, spot.z)).toBe(K('lava'));
    // 石砖地板与天花板
    expect(at(spot.x - 6, y, spot.z - 6)).toBe(K('stone_bricks'));
    expect(at(spot.x - 6, y + 4, spot.z - 6)).toBe(K('stone_bricks'));
    // 宝箱与火把
    expect(at(spot.x + 3, y + 1, spot.z - 3)).toBe(K('chest'));
    expect(at(spot.x - 3, y + 1, spot.z - 3)).toBe(K('torch'));
  });
});

describe('嵌眼激活', () => {
  it('12 框架逐个嵌眼，最后一眼激活 3×3 末地传送门', () => {
    const w = setup();
    const y = 60;
    // 手搭 5×5 门框（空框架）
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
        const corner = Math.abs(dx) === 2 && Math.abs(dz) === 2;
        if (edge && !corner) w.setBlock(8 + dx, y, 8 + dz, K('end_portal_frame'));
      }
    }
    let activated = false;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
        const corner = Math.abs(dx) === 2 && Math.abs(dz) === 2;
        if (!edge || corner) continue;
        const r = fillPortalFrame(w, 8 + dx, y, 8 + dz);
        expect(r).not.toBe('invalid');
        if (r === 'activated') activated = true;
      }
    }
    expect(activated).toBe(true);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) expect(w.getBlock(8 + dx, y, 8 + dz)).toBe(K('end_portal'));
    }
    // 已嵌眼的框架不能再嵌
    expect(fillPortalFrame(w, 6, y, 8)).toBe('invalid');
  });
});

describe('末影之眼投掷', () => {
  it('朝要塞方向直飞，悬停后 80% 掉回物品（MC）', () => {
    const w = setup();
    fireEyeOfEnder({ x: 8.5, y: 62, z: 8.5 }, 100, 8.5);
    expect(arrows).toHaveLength(1);
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // ≥0.2 → 掉落
    let x0 = 0;
    let x1 = 0;
    for (let i = 0; i < 40; i++) {
      tickMobs(w, 0.1, { x: 8.5, y: 62, z: 8.5 }, () => undefined);
      if (i === 0 && arrows[0]) x0 = arrows[0].x;
      if (arrows[0]) x1 = arrows[0].x;
    }
    expect(x1).toBeGreaterThan(x0); // 朝 +x（要塞方向）飞
    expect(arrows).toHaveLength(0); // 约 3s 后结算消失
    expect(itemDrops.some((d) => d.drop.kind === 'material' && d.drop.material === 'eye_of_ender')).toBe(true);
  });

  it('20% 概率碎裂（不掉落）', () => {
    const w = setup();
    fireEyeOfEnder({ x: 8.5, y: 62, z: 8.5 }, 100, 8.5);
    vi.spyOn(Math, 'random').mockReturnValue(0.1); // <0.2 → 碎裂
    for (let i = 0; i < 40; i++) tickMobs(w, 0.1, { x: 8.5, y: 62, z: 8.5 }, () => undefined);
    expect(arrows).toHaveLength(0);
    expect(itemDrops.some((d) => d.drop.kind === 'material' && d.drop.material === 'eye_of_ender')).toBe(false);
  });
});

describe('合成配方', () => {
  it('末影之眼：末影珍珠 + 烈焰粉（MC 无序）', () => {
    const r = RECIPES.find((r) => r.id === 'eye_of_ender');
    expect(r).toBeDefined();
    const cost = new Map(r!.cost.map((c) => [c.item, c.count]));
    expect(cost.get('material:ender_pearl')).toBe(1);
    expect(cost.get('material:blaze_powder')).toBe(1);
  });
});
