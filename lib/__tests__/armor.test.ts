import { beforeEach, describe, expect, it } from 'vitest';
import { armorDef, armorPoints, armorToughness, damageAfterArmor, emptyArmorSlots, type ArmorMaterial, type ArmorSlots } from '../armor';
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

  it('全套皮甲按 Java 两段式减伤（7 点吃 10：max(1.4, 7-5)/25 = 8% → 9.2），每次受伤每件装备 -1 耐久', () => {
    for (const p of ['helmet', 'chestplate', 'leggings', 'boots'] as const) {
      useGameStore.getState().addArmor(p);
      useGameStore.getState().equipSelectedArmor();
    }
    useGameStore.getState().damagePlayer(10);
    const s = useGameStore.getState();
    expect(s.health).toBeCloseTo(20 - 9.2, 6); // Java 公式：reduction = max(7/5, 7-10/2)/25 = 0.08
    expect(s.armorSlots.helmet!.durability).toBe(54);
    expect(s.armorSlots.chestplate!.durability).toBe(79);
    expect(s.armorSlots.boots!.durability).toBe(64);
  });

  it('无护甲时伤害不减', () => {
    useGameStore.getState().damagePlayer(10);
    expect(useGameStore.getState().health).toBe(10);
  });

  it('bypassArmor：摔落类伤害不吃护甲/保护减伤，也不耗装备耐久（MC）', () => {
    for (const p of ['helmet', 'chestplate', 'leggings', 'boots'] as const) {
      useGameStore.getState().addArmor(p);
      useGameStore.getState().equipSelectedArmor();
    }
    useGameStore.getState().damagePlayer(10, { bypassArmor: true });
    const s = useGameStore.getState();
    expect(s.health).toBe(10); // 全额伤害（穿甲时本会减到 8）
    expect(s.armorSlots.helmet!.durability).toBe(armorDef('leather', 'helmet').durability); // 耐久未耗
    expect(s.armorSlots.chestplate!.durability).toBe(armorDef('leather', 'chestplate').durability);
    // 默认（不传 opts）仍吃护甲减伤（Java 两段式：7 点吃 10 → 9.2）
    hurtState.lastAt = Number.NEGATIVE_INFINITY;
    useGameStore.getState().damagePlayer(10);
    expect(useGameStore.getState().health).toBeCloseTo(10 - 9.2, 6);
  });

  it('死亡时装备槽物品也散落', () => {
    useGameStore.getState().addArmor('boots');
    useGameStore.getState().equipSelectedArmor();
    clearDrops();
    useGameStore.getState().damagePlayer(25); // 皮靴 1 点仅减 0.8%，25 点仍致死
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

/** 全套某材质护甲槽 */
function fullSet(material: ArmorMaterial, protLvl = 0): ArmorSlots {
  const slots = emptyArmorSlots();
  for (const p of ['helmet', 'chestplate', 'leggings', 'boots'] as const) {
    slots[p] = { durability: 1, material, ...(protLvl > 0 ? { ench: { protection: protLvl } } : {}) };
  }
  return slots;
}

describe('damageAfterArmor（MC Java 1.9+ 两段式减伤契约）', () => {
  it('护甲韧性：钻 2/件（全套 8）、下界合金 3/件（全套 12）、其他 0', () => {
    expect(armorDef('diamond', 'helmet').toughness).toBe(2);
    expect(armorDef('netherite', 'boots').toughness).toBe(3);
    expect(armorDef('iron', 'chestplate').toughness).toBe(0);
    expect(armorToughness(fullSet('diamond'))).toBe(8);
    expect(armorToughness(fullSet('netherite'))).toBe(12);
    expect(armorToughness(emptyArmorSlots())).toBe(0);
  });

  it('满钻甲（20 护甲 8 韧性）吃 20 伤害：减到 8（旧公式 80% 恒减会给 4，差异用例）', () => {
    // reduction = min(20, max(20/5, 20 - 20/(2+8/4))) / 25 = min(20, 15)/25 = 0.6 → 20×0.4 = 8
    expect(damageAfterArmor(20, fullSet('diamond'))).toBeCloseTo(8, 6);
    expect(damageAfterArmor(20, fullSet('diamond'))).not.toBeCloseTo(4, 6); // 旧实现恒 80% 减伤
  });

  it('韧性抗大伤害击穿：满合金（12 韧性）吃 20 伤害比钻甲更少', () => {
    // reduction = min(20, 20 - 20/5)/25 = 0.64 → 20×0.36 = 7.2
    expect(damageAfterArmor(20, fullSet('netherite'))).toBeCloseTo(7.2, 6);
  });

  it('小伤害按护甲点线性减：皮甲 7 点吃 10 → max(1.4, 7-5)/25 = 8% → 9.2', () => {
    expect(damageAfterArmor(10, fullSet('leather'))).toBeCloseTo(9.2, 6);
  });

  it('无护甲伤害不减；无「至少 1 点」地板（Java：小伤害可趋近 0）', () => {
    expect(damageAfterArmor(10, emptyArmorSlots())).toBe(10);
    // 满合金吃 0.5：reduction = min(20, 20-0.5/5)/25 = 0.796 → 0.5×0.204 = 0.102（旧地板会抬到 1）
    expect(damageAfterArmor(0.5, fullSet('netherite'))).toBeCloseTo(0.102, 3);
    expect(damageAfterArmor(0.5, fullSet('netherite'))).toBeLessThan(1);
  });

  it('第二段保护附魔：EPF = 各件保护之和，第一段后再乘 (1-0.04×EPF)', () => {
    // 钻甲 + 保护 IV×4（EPF 16）：8 × (1-0.64) = 2.88
    expect(damageAfterArmor(20, fullSet('diamond', 4))).toBeCloseTo(2.88, 6);
    // 纯保护无护甲（鞘翅 0 点 + 保护 IV）：10 × (1-0.16) = 8.4
    const elytra = emptyArmorSlots();
    elytra.chestplate = { durability: 1, material: 'elytra', ench: { protection: 4 } };
    expect(damageAfterArmor(10, elytra)).toBeCloseTo(8.4, 6);
    const prot = emptyArmorSlots();
    prot.helmet = { durability: 1, material: 'iron', ench: { protection: 4 } };
    // 铁头 2 点：reduction = max(2/5, 2-10/2)/25 = 0.4/25；再乘 EPF 4 的 ×0.84
    expect(damageAfterArmor(10, prot)).toBeCloseTo(10 * (1 - 0.4 / 25) * (1 - 0.16), 6);
  });

  it('EPF 合计封顶 20（保护 7×4 = 28 → 按 20 计 → ×0.2）', () => {
    expect(damageAfterArmor(10, fullSet('diamond', 7))).toBeCloseTo(damageAfterArmor(10, fullSet('diamond', 5)), 6);
    // 无甲 EPF 20：10 × (1-0.8) = 2
    const slots = emptyArmorSlots();
    for (const p of ['helmet', 'chestplate', 'leggings', 'boots'] as const) {
      slots[p] = { durability: 1, material: 'leather', ench: { protection: 7 } };
    }
    expect(damageAfterArmor(10, slots)).toBeCloseTo(10 * (1 - Math.min(20, Math.max(7 / 5, 7 - 10 / 2)) / 25) * 0.2, 6);
  });
});
