// 背包（主物品栏）：拾取溢出、区域互移、合成跨区取材、卸下装备

import { beforeEach, describe, expect, it } from 'vitest';
import { BLOCK_BY_KEY, STONE } from '../blocks';
import { RECIPES } from '../recipes';
import { useGameStore } from '../store';
import { emptyBackpack, emptySlots } from '../slots';

const STICK_RECIPE = RECIPES.find((r) => r.id === 'stick')!;

function reset(): void {
  useGameStore.getState().loadSurvival({ health: 20, hunger: 20, slots: emptySlots(), backpack: emptyBackpack() });
  useGameStore.setState({ worldMode: 'survival' });
}

describe('背包', () => {
  beforeEach(reset);

  it('addStack：热键栏满后溢出到背包', () => {
    const s = useGameStore.getState();
    // 热键栏塞满石头（9×64）
    expect(s.addStack({ kind: 'block', id: STONE }, 9 * 64 + 10)).toBe(0);
    const st = useGameStore.getState();
    expect(st.hotbarSlots.every((x) => x?.kind === 'block' && x.count === 64)).toBe(true);
    expect(st.mainSlots[0]).toEqual({ kind: 'block', id: STONE, count: 10 });
  });

  it('addStack：背包也满则返回放不下数量', () => {
    const s = useGameStore.getState();
    const leftover = s.addStack({ kind: 'block', id: STONE }, 36 * 64 + 5);
    expect(leftover).toBe(5);
  });

  it('moveSlot：整叠在两区互移并自动合并', () => {
    const s = useGameStore.getState();
    s.addStack({ kind: 'block', id: STONE }, 70); // 热键栏 [64, 6]
    useGameStore.getState().moveSlot('hotbar', 0); // 64 → 背包
    let st = useGameStore.getState();
    expect(st.hotbarSlots[0]).toBeNull();
    expect(st.mainSlots[0]).toEqual({ kind: 'block', id: STONE, count: 64 });
    st.moveSlot('main', 0); // 移回：与热键栏余量 6 合并（6+58 满 64，剩 6 占空槽）
    st = useGameStore.getState();
    expect(st.hotbarSlots[1]).toEqual({ kind: 'block', id: STONE, count: 64 });
    expect(st.hotbarSlots[0]).toEqual({ kind: 'block', id: STONE, count: 6 });
    expect(st.mainSlots[0]).toBeNull();
  });

  it('合成：材料在背包也能用', () => {
    // 木板只放背包
    useGameStore.setState({
      mainSlots: [{ kind: 'block', id: BLOCK_BY_KEY.planks.id, count: 2 }, ...emptyBackpack().slice(1)],
    });
    expect(useGameStore.getState().craft(STICK_RECIPE)).toBe(true);
    const st = useGameStore.getState();
    // 木棍产物优先热键栏，木板被消耗
    expect(st.hotbarSlots[0]).toEqual({ kind: 'material', material: 'stick', count: 4 });
    expect(st.mainSlots[0]).toBeNull();
  });

  it('unequipArmor：卸下到热键栏', () => {
    const st = useGameStore.getState();
    useGameStore.setState({ armorSlots: { helmet: { durability: 50 }, chestplate: null, leggings: null, boots: null } });
    st.unequipArmor('helmet');
    const after = useGameStore.getState();
    expect(after.armorSlots.helmet).toBeNull();
    expect(after.hotbarSlots[0]).toEqual({ kind: 'armor', piece: 'helmet', durability: 50 });
  });

  it('死亡掉落包含背包物品', () => {
    const s = useGameStore.getState();
    s.addStack({ kind: 'block', id: STONE }, 9 * 64 + 3); // 背包 3 个
    useGameStore.getState().damagePlayer(100);
    const st = useGameStore.getState();
    expect(st.dead).toBe(true);
    expect(st.mainSlots.every((x) => x === null)).toBe(true);
  });
});
