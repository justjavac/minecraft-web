// 末地城与鞘翅：外岛地形、紫颂树、末地城塔楼与战利品、潜影贝（追踪弹 + 漂浮）、鞘翅装备

import { beforeEach, describe, expect, it } from 'vitest';
import { armorDef, emptyArmorSlots } from '../armor';
import { BLOCK_BY_KEY } from '../blocks';
import { clearEffects, effects } from '../effects';
import { createEndTerrain, END_CITY_MAIN_LOOT, outerIslandAt, outerHeightAt } from '../end';
import { FOODS } from '../furnace';
import { clearMobs, mobs, tickMobs, arrows, type Mob, type MobType } from '../mobs';
import { clearDrops } from '../items';
import { hashString } from '../noise';
import { emptySlots } from '../slots';
import { useGameStore } from '../store';
import { World } from '../world';

const K = (k: string) => BLOCK_BY_KEY[k].id;

const mkMob = (type: MobType, x: number, y: number, z: number, extra?: Partial<Mob>): Mob => ({
  id: Math.random(), type, x, y, z,
  velY: 0, hp: 30, attackCd: 0, onGround: true,
  wanderDir: 0, wanderTimer: 0, wanderMoving: false,
  fleeTimer: 0, fleeFromX: 0, fleeFromZ: 0, arrowCd: 0, ignite: -1,
  ...extra,
});

function endWorld(seed = 'city-test'): World {
  return new World(seed, undefined, createEndTerrain(seed));
}

beforeEach(() => {
  clearMobs();
  clearDrops();
  clearEffects();
  useGameStore.setState({ worldMode: 'survival', armorSlots: emptyArmorSlots(), hotbarSlots: emptySlots(), selectedSlot: 0 });
});

describe('外岛地形', () => {
  it('主岛 150 内为空带（无外岛，MC 虚空海）；环带散布外岛；主岛地形不受影响', () => {
    const sh = hashString('city-test');
    // 150 内任何区域都不出外岛
    for (let rx = -1; rx <= 1; rx++) {
      for (let rz = -1; rz <= 1; rz++) {
        const isle = outerIslandAt(sh, rx, rz);
        if (isle) expect(Math.hypot(isle.x, isle.z)).toBeGreaterThanOrEqual(150);
      }
    }
    // 环带扫描：存在外岛，且约 1/4 带城
    let islands = 0;
    let cities = 0;
    let firstIsle: { x: number; z: number; y: number } | null = null;
    for (let rx = 2; rx < 20; rx++) {
      for (let rz = -10; rz < 10; rz++) {
        const isle = outerIslandAt(sh, rx, rz);
        if (isle) {
          islands++;
          firstIsle ??= isle;
          if (isle.city) cities++;
        }
      }
    }
    expect(islands).toBeGreaterThan(10);
    expect(cities).toBeGreaterThan(2);
    // 岛面高度在岛 y 附近（取扫描到的首个外岛，不硬编码格子——种子规则变化会移动岛位）
    expect(firstIsle).not.toBeNull();
    const h = outerHeightAt(sh, firstIsle!.x, firstIsle!.z);
    expect(h).toBeGreaterThanOrEqual(firstIsle!.y - 4);
    expect(h).toBeLessThanOrEqual(firstIsle!.y + 10);
  });
  // 生成约 60 个末地 chunk（地形+紫颂树+塔楼），CI 慢机上会超默认 30s——放宽到 90s
  it('外岛 chunk：末地石岛体 + 紫颂树（植株 + 花）；城岛有塔楼与宝箱', () => {
    const sh = hashString('city-test');
    // 找前几个外岛（含至少一城岛）
    const isles: { x: number; z: number; r: number; y: number; city: boolean }[] = [];
    let cityIsle: (typeof isles)[number] | null = null;
    for (let rx = 2; rx < 30 && (isles.length < 4 || !cityIsle); rx++) {
      for (let rz = -15; rz < 15 && (isles.length < 4 || !cityIsle); rz++) {
        const isle = outerIslandAt(sh, rx, rz);
        if (isle) {
          isles.push(isle);
          if (isle.city && !cityIsle) cityIsle = isle;
        }
      }
    }
    expect(cityIsle).not.toBeNull();
    const w = endWorld();
    // 全部外岛累计：紫颂树存在
    let chorus = 0;
    for (const isle of isles) {
      const ccx = Math.floor(isle.x / 16);
      const ccz = Math.floor(isle.z / 16);
      for (let cx = ccx - 1; cx <= ccx + 1; cx++) {
        for (let cz = ccz - 1; cz <= ccz + 1; cz++) {
          const chunk = w.getChunk(cx, cz);
          for (let i = 0; i < chunk.data.length; i++) {
            if (chunk.data[i] === K('chorus_plant') || chunk.data[i] === K('chorus_flower')) chorus++;
          }
        }
      }
    }
    expect(chorus).toBeGreaterThan(0);
    // 城岛：塔楼砖石与宝箱
    let bricks = 0;
    let chests = 0;
    const ccx = Math.floor(cityIsle!.x / 16);
    const ccz = Math.floor(cityIsle!.z / 16);
    for (let cx = ccx - 2; cx <= ccx + 2; cx++) {
      for (let cz = ccz - 2; cz <= ccz + 2; cz++) {
        const chunk = w.getChunk(cx, cz);
        for (let i = 0; i < chunk.data.length; i++) {
          if (chunk.data[i] === K('end_stone_bricks')) bricks++;
          if (chunk.data[i] === K('chest')) chests++;
        }
      }
    }
    expect(bricks).toBeGreaterThan(50);
    expect(chests).toBeGreaterThanOrEqual(2);
    // 主塔顶箱存在（基面 +16）
    const baseY = w.terrain.heightAt(cityIsle!.x, cityIsle!.z);
    expect(w.getBlock(cityIsle!.x, baseY + 16, cityIsle!.z)).toBe(K('chest'));
  }, 90_000);

  it('主塔顶箱战利品必含鞘翅（MC 末地船鞘翅）', () => {
    const elytra = END_CITY_MAIN_LOOT.find(([m]) => m === 'elytra');
    expect(elytra).toBeDefined();
    expect(elytra![2]).toBe(1); // 概率 1 = 必掉
  });
});

describe('潜影贝', () => {
  it('12 格内开壳射追踪弹；弹朝玩家修正方向，命中 4 伤 + 漂浮 5s（MC）', () => {
    const w = endWorld();
    // 虚空区（x/z 112-128，主岛外）铺 end_stone 平台，避免撞进主岛岛体
    for (let cx = 6; cx <= 9; cx++) for (let cz = 6; cz <= 9; cz++) w.getChunk(cx, cz);
    for (let x = 112; x <= 128; x++) for (let z = 112; z <= 128; z++) w.setBlock(x, 60, z, K('end_stone'));
    mobs.push(mkMob('shulker', 120.5, 61, 120.5));
    const player = { x: 120.5, y: 61, z: 126.5 }; // 6 格外
    tickMobs(w, 0.1, player, () => undefined);
    expect(arrows.some((a) => a.kind === 'shulker')).toBe(true);
    // 追踪：初速错向的弹，几帧后朝玩家修正
    arrows.length = 0;
    arrows.push({ id: 1, x: 120.5, y: 62, z: 120.5, vx: 5, vy: 0, vz: 0, age: 0, kind: 'shulker' }); // 朝 +x（错向）
    tickMobs(w, 0.3, player, () => undefined);
    const a = arrows[0];
    expect(a.vz).toBeGreaterThan(0); // 已朝 +z（玩家方向）修正
    // 命中：贴脸弹
    arrows.length = 0;
    arrows.push({ id: 2, x: 120.5, y: 61.5, z: 126.2, vx: 0, vy: 0, vz: 1, age: 0, kind: 'shulker' });
    let dmg = 0;
    tickMobs(w, 0.1, player, (d) => (dmg += d));
    expect(dmg).toBe(4);
    expect(effects.levitation).toBe(5);
  });
});

describe('鞘翅', () => {
  it('装备定义：无护甲（0 点）、耐久 432（MC）；手持鞘翅右击装备到胸甲槽（原胸甲回手）', () => {
    expect(armorDef('elytra', 'chestplate').points).toBe(0);
    expect(armorDef('elytra', 'chestplate').durability).toBe(432);
    expect(armorDef('elytra', 'chestplate').name).toBe('鞘翅胸甲');
    // 先穿铁胸甲
    useGameStore.setState({
      armorSlots: { ...emptyArmorSlots(), chestplate: { durability: 200, material: 'iron' } },
      hotbarSlots: [{ kind: 'material', material: 'elytra', count: 1 }, ...emptySlots().slice(1)],
      selectedSlot: 0,
    });
    expect(useGameStore.getState().equipElytra()).toBe(true);
    const st = useGameStore.getState();
    expect(st.armorSlots.chestplate).toEqual({ durability: 432, material: 'elytra' });
    expect(st.hotbarSlots[0]).toEqual({ kind: 'armor', piece: 'chestplate', material: 'iron', durability: 200, ench: undefined });
  });

  it('紫颂果：可食用（MC 4 饥饿）', () => {
    expect(FOODS.chorus_fruit.hunger).toBe(4);
  });
});
