// 猪灵堡垒与以物易物：结构生成、金甲豁免、群体仇恨、易物端详与掉落、易物表、刷怪联动

import { beforeEach, describe, expect, it } from 'vitest';
import { BLOCK_BY_KEY } from '../blocks';
import { clearDrops, itemDrops } from '../items';
import { barterWith, BARTER_TABLE, clearMobs, damageMob, mobs, tickMobs, wearsGoldArmor, type Mob, type MobType } from '../mobs';
import { createNetherTerrain } from '../nether';
import { bastionAt, applyNetherStructures } from '../netherstructures';
import { armorDef, emptyArmorSlots } from '../armor';
import { useGameStore } from '../store';
import { CHUNK_SIZE, CHUNK_VOLUME, localIndex, World } from '../world';

const K = (k: string) => BLOCK_BY_KEY[k].id;

function netherWorld(seed = 'bastion-test'): World {
  return new World(seed, undefined, createNetherTerrain(seed));
}

/** 本地 mob 工厂（mobs.ts 的 makeMob 未导出；按 Mob 接口补齐缺省字段） */
const mkMob = (type: MobType, x: number, y: number, z: number, extra?: Partial<Mob>): Mob => ({
  id: Math.random(), type, x, y, z,
  velY: 0, hp: 16, attackCd: 0, onGround: true,
  wanderDir: 0, wanderTimer: 0, wanderMoving: false,
  fleeTimer: 0, fleeFromX: 0, fleeFromZ: 0, arrowCd: 1, ignite: -1,
  ...extra,
});

beforeEach(() => {
  clearMobs();
  clearDrops();
  useGameStore.setState({ armorSlots: emptyArmorSlots(), worldMode: 'survival' });
});

describe('猪灵堡垒生成', () => {
  it('bastionAt 确定性（约 6% 区域）；同区域同结果', () => {
    const t = createNetherTerrain('bastion-test');
    const sh = 4242;
    let count = 0;
    for (let rx = 0; rx < 20; rx++) {
      for (let rz = 0; rz < 20; rz++) {
        const b = bastionAt(sh, t, rx, rz);
        if (b) count++;
      }
    }
    expect(count).toBeGreaterThan(8); // 400 区域 × 6% ≈ 24（容差宽松）
    expect(count).toBeLessThan(60);
    expect(bastionAt(sh, t, 3, 5)).toEqual(bastionAt(sh, t, 3, 5));
  });

  it('结构：黑石基座 + 金块堆 + 宝箱 + 主塔（跨 chunk 写入）', () => {
    const t = createNetherTerrain('bastion-test');
    const sh = 4242;
    // 找一座堡垒
    let spot: { x: number; y: number; z: number } | null = null;
    for (let rx = 0; rx < 20 && !spot; rx++) {
      for (let rz = 0; rz < 20 && !spot; rz++) spot = bastionAt(sh, t, rx, rz);
    }
    expect(spot).not.toBeNull();
    const ccx = Math.floor(spot!.x / CHUNK_SIZE);
    const ccz = Math.floor(spot!.z / CHUNK_SIZE);
    // 3×3 chunk 各自独立写入（堡垒 21×21 跨 chunk），统一查询
    const datas = new Map<string, Uint16Array>();
    for (let cx = ccx - 1; cx <= ccx + 1; cx++) {
      for (let cz = ccz - 1; cz <= ccz + 1; cz++) {
        const d = new Uint16Array(CHUNK_VOLUME).fill(K('netherrack'));
        applyNetherStructures(sh, t, cx, cz, d);
        datas.set(`${cx},${cz}`, d);
      }
    }
    const at = (x: number, y: number, z: number) => {
      const cx = Math.floor(x / CHUNK_SIZE);
      const cz = Math.floor(z / CHUNK_SIZE);
      const d = datas.get(`${cx},${cz}`);
      return d ? d[localIndex(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE)] : 0;
    };
    const y = spot!.y;
    expect(at(spot!.x, y, spot!.z)).toBe(K('blackstone')); // 基座
    expect(at(spot!.x, y + 2, spot!.z)).toBe(K('gold_block')); // 金块堆
    expect(at(spot!.x - 7, y + 2, spot!.z - 7)).toBe(K('chest')); // 主塔宝箱
    expect(at(spot!.x + 8, y + 1, spot!.z - 8)).toBe(K('chest'));
  });
});

describe('金甲豁免与群体仇恨', () => {
  function worldWithPack(): World {
    const w = netherWorld();
    for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) w.getChunk(cx, cz);
    for (let x = 0; x <= 16; x++) for (let z = 0; z <= 16; z++) w.setBlock(x, 40, z, K('netherrack'));
    mobs.push(mkMob('piglin', 6.5, 41, 6.5));
    mobs.push(mkMob('piglin', 7.5, 41, 6.5));
    return w;
  }

  it('穿任一金装备：猪灵不主动追击（MC 金甲豁免）；无金甲则追击', () => {
    const w = worldWithPack();
    const player = { x: 6.5, y: 41, z: 14.5 };
    // 无金甲：追击靠近
    for (let i = 0; i < 10; i++) tickMobs(w, 0.2, player, () => undefined);
    const distNoGold = Math.hypot(mobs[0].x - player.x, mobs[0].z - player.z);
    expect(distNoGold).toBeLessThan(8);
    // 穿金靴：豁免——退回游荡（不再持续逼近）
    useGameStore.setState({ armorSlots: { ...emptyArmorSlots(), boots: { durability: armorDef('gold', 'boots').durability, material: 'gold' } } });
    expect(wearsGoldArmor()).toBe(true);
    const w2 = worldWithPack();
    const d0 = Math.hypot(mobs[0].x - player.x, mobs[0].z - player.z);
    for (let i = 0; i < 10; i++) tickMobs(w2, 0.2, player, () => undefined);
    const d1 = Math.hypot(mobs[0].x - player.x, mobs[0].z - player.z);
    expect(d1).toBeGreaterThanOrEqual(d0 - 2); // 不明显逼近（游荡容差）
  });

  it('打一只猪灵，32 格内同伴群体仇恨（MC）；金甲玩家被打也会反击', () => {
    const w = worldWithPack();
    useGameStore.setState({ armorSlots: { ...emptyArmorSlots(), boots: { durability: 91, material: 'gold' } } });
    damageMob(mobs[0], 5, { x: 6.5, z: 14.5 }, 0, w);
    expect(mobs[1].aggroTimer).toBeGreaterThan(0);
    const player = { x: 6.5, y: 41, z: 14.5 };
    for (let i = 0; i < 10; i++) tickMobs(w, 0.2, player, () => undefined);
    // 被激怒后即使穿金甲也会逼近
    expect(Math.hypot(mobs[1].x - player.x, mobs[1].z - player.z)).toBeLessThan(8);
  });
});

describe('以物易物', () => {
  it('金锭换易物：猪灵端详 3s（静止不攻击），到点丢出随机物品；蛮兵不谈判', () => {
    const w = netherWorld();
    for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) w.getChunk(cx, cz);
    for (let x = 0; x <= 16; x++) for (let z = 0; z <= 16; z++) w.setBlock(x, 40, z, K('netherrack'));
    const piglin = mkMob('piglin', 8.5, 41, 8.5);
    mobs.push(piglin);
    expect(barterWith(piglin)).toBe(true);
    expect(piglin.barterTimer).toBeGreaterThan(0);
    expect(barterWith(piglin)).toBe(false); // 端详中不可重复
    const x0 = piglin.x;
    const player = { x: 8.5, y: 41, z: 12.5 };
    for (let i = 0; i < 20; i++) tickMobs(w, 0.2, player, () => undefined);
    expect(piglin.x).toBeCloseTo(x0, 0); // 端详静止
    expect(itemDrops.length).toBeGreaterThan(0); // 已丢出易物
    const brute = mkMob('piglin_brute', 8.5, 41, 8.5);
    expect(barterWith(brute)).toBe(false);
  });

  it('易物表权重和 100，物品 key 均合法（材料在材料表/方块在方块表）', async () => {
    expect(BARTER_TABLE.reduce((n, c) => n + c.weight, 0)).toBe(100);
    const { MATERIAL_INFO } = await import('../materials');
    for (const c of BARTER_TABLE) {
      if (c.kind === 'material') expect(MATERIAL_INFO[c.key], c.key).toBeDefined();
      else expect(BLOCK_BY_KEY[c.key], c.key).toBeDefined();
    }
  });
});
