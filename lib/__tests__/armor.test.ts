import { beforeEach, describe, expect, it } from 'vitest';
import { armorDef, armorPoints, emptyArmorSlots } from '../armor';
import { hurtState } from '../game';
import { clearDrops, itemDrops } from '../items';
import { emptySlots } from '../slots';
import { MAX_HEALTH, MAX_HUNGER, MAX_SATURATION, useGameStore } from '../store';

function resetStore(): void {
  useGameStore.setState({
    worldMode: 'survival',
    health: MAX_HEALTH,
    hunger: MAX_HUNGER,
    saturation: MAX_SATURATION,
    dead: false,
    hotbarSlots: emptySlots(),
    armorSlots: emptyArmorSlots(),
    lastDamageAt: 0,
  });
  hurtState.lastAt = Number.NEGATIVE_INFINITY;
}

describe('皮甲装备', () => {
  beforeEach(resetStore);

  it('护甲点数按部件累计（全套 7 点）', () => {
    const slots = emptyArmorSlots();
    expect(armorPoints(slots)).toBe(0);
    slots.helmet = { durability: 55 };
    slots.chestplate = { durability: 80 };
    slots.leggings = { durability: 75 };
    slots.boots = { durability: 65 };
    expect(armorPoints(slots)).toBe(7);
  });

  it('右键穿上装备，已有同部位换回手中', () => {
    useGameStore.getState().addArmor('helmet');
    expect(useGameStore.getState().equipSelectedArmor()).toBe(true);
    let s = useGameStore.getState();
    expect(s.armorSlots.helmet).toEqual({ durability: armorDef('leather', 'helmet').durability });
    expect(s.hotbarSlots[0]).toBeNull();

    useGameStore.getState().addArmor('helmet', 30);
    useGameStore.getState().equipSelectedArmor();
    s = useGameStore.getState();
    expect(s.armorSlots.helmet).toEqual({ durability: 30 }); // 新的穿上
    expect(s.hotbarSlots[0]).toEqual({ kind: 'armor', piece: 'helmet', durability: 55 }); // 旧的回手
  });

  it('全套皮甲减伤 28%，每次受伤每件装备 -1 耐久', () => {
    for (const p of ['helmet', 'chestplate', 'leggings', 'boots'] as const) {
      useGameStore.getState().addArmor(p);
      useGameStore.getState().equipSelectedArmor();
    }
    useGameStore.getState().damagePlayer(10);
    const s = useGameStore.getState();
    expect(s.health).toBe(20 - Math.ceil(10 * 0.72)); // 10 点伤害减免 28% → 8
    expect(s.armorSlots.helmet!.durability).toBe(54);
    expect(s.armorSlots.chestplate!.durability).toBe(79);
    expect(s.armorSlots.boots!.durability).toBe(64);
  });

  it('无护甲时伤害不减', () => {
    useGameStore.getState().damagePlayer(10);
    expect(useGameStore.getState().health).toBe(10);
  });

  it('死亡时装备槽物品也散落', () => {
    useGameStore.getState().addArmor('boots');
    useGameStore.getState().equipSelectedArmor();
    clearDrops();
    useGameStore.getState().damagePlayer(20);
    expect(itemDrops.some((d) => d.drop.kind === 'armor' && d.drop.piece === 'boots')).toBe(true);
    expect(useGameStore.getState().armorSlots.boots).toBeNull();
    clearDrops();
  });
});

describe('装备材质（铁/金/钻/下界合金）', () => {
  beforeEach(resetStore);

  it('护甲点数按材质：皮革 7、金 11、铁 15、钻/合金 20（MC 全套）', () => {
    for (const [mat, total] of [['leather', 7], ['gold', 11], ['iron', 15], ['diamond', 20], ['netherite', 20]] as const) {
      const slots = emptyArmorSlots();
      for (const p of ['helmet', 'chestplate', 'leggings', 'boots'] as const) slots[p] = { durability: 1, material: mat };
      expect(armorPoints(slots)).toBe(total);
    }
    // 混搭：钻胸 8 + 铁头 2 = 10
    const mix = emptyArmorSlots();
    mix.helmet = { durability: 1, material: 'iron' };
    mix.chestplate = { durability: 1, material: 'diamond' };
    expect(armorPoints(mix)).toBe(10);
  });

  it('耐久按 MC 数值（铁 165/240/225/195，合金 407/592/555/481）；定义名随材质', () => {
    expect(armorDef('iron', 'helmet').durability).toBe(165);
    expect(armorDef('iron', 'chestplate').durability).toBe(240);
    expect(armorDef('netherite', 'boots').durability).toBe(481);
    expect(armorDef('netherite', 'chestplate').durability).toBe(592);
    expect(armorDef('diamond', 'leggings').points).toBe(6);
    expect(armorDef('gold', 'chestplate').points).toBe(5);
    expect(armorDef('netherite', 'helmet').name).toBe('下界合金头盔');
  });

  it('穿戴保留材质；死亡掉落带材质', () => {
    useGameStore.getState().addArmor('chestplate', undefined, 'iron');
    useGameStore.getState().equipSelectedArmor();
    expect(useGameStore.getState().armorSlots.chestplate).toEqual({ durability: 240, material: 'iron' });
    clearDrops();
    useGameStore.getState().damagePlayer(40); // 铁甲减伤后仍致死
    expect(itemDrops.some((d) => d.drop.kind === 'armor' && d.drop.piece === 'chestplate' && d.drop.material === 'iron')).toBe(true);
    clearDrops();
  });

  it('铁/金/钻 12 件装备配方（用量 5/8/7/4 同皮革，MC）；下界合金不可合成', async () => {
    const { RECIPES } = await import('../recipes');
    const mat: Record<string, string> = { iron: 'material:iron_ingot', gold: 'material:gold_ingot', diamond: 'material:diamond' };
    const cost: Record<string, number> = { helmet: 5, chestplate: 8, leggings: 7, boots: 4 };
    for (const [m, item] of Object.entries(mat)) {
      for (const [piece, n] of Object.entries(cost)) {
        const r = RECIPES.find((r) => r.id === `${m}_${piece}`);
        expect(r, `${m}_${piece}`).toBeDefined();
        expect(r!.out).toEqual({ kind: 'armor', piece, material: m });
        expect(r!.cost).toEqual([{ item, count: n }]);
      }
    }
    expect(RECIPES.some((r) => r.id.startsWith('netherite_') && r.out.kind === 'armor')).toBe(false);
  });
});
