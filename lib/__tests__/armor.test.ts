import { beforeEach, describe, expect, it } from 'vitest';
import { armorPoints, ARMOR_DEFS, emptyArmorSlots } from '../armor';
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
    expect(s.armorSlots.helmet).toEqual({ durability: ARMOR_DEFS.helmet.durability });
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
