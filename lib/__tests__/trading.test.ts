// 村民交易：职业分配、交易表完整性、付出扣减与获得、经验

import { beforeEach, describe, expect, it } from 'vitest';
import { BLOCK_BY_KEY } from '../blocks';
import { MATERIAL_INFO } from '../materials';
import { useGameStore } from '../store';
import { emptySlots, type Slot } from '../slots';
import { canAfford, executeTrade, professionOf, TRADES, tradeItemName, type Profession } from '../trading';

const mat = (material: string, count = 1): Slot => ({ kind: 'material', material, count });
const blk = (key: string, count = 1): Slot => ({ kind: 'block', id: BLOCK_BY_KEY[key].id, count });

beforeEach(() => {
  useGameStore.getState().loadSurvival({ health: 20, hunger: 20, slots: emptySlots() });
  useGameStore.setState({ worldMode: 'survival', xpTotal: 0 });
});

describe('职业分配', () => {
  it('按 id 确定性且覆盖全部 5 职业', () => {
    expect(professionOf(7)).toBe(professionOf(7));
    const seen = new Set<Profession>();
    for (let id = 1; id <= 50; id++) seen.add(professionOf(id));
    expect(seen.size).toBe(5);
  });
});

describe('交易表完整性', () => {
  it('全部交易项的材料/方块都已注册', () => {
    for (const list of Object.values(TRADES)) {
      for (const t of list) {
        for (const g of t.give) {
          if (g.kind === 'material') expect(MATERIAL_INFO[g.material] !== undefined || g.material.startsWith('armor:'), g.material).toBe(true);
          else expect(BLOCK_BY_KEY[Object.keys(BLOCK_BY_KEY).find((k) => BLOCK_BY_KEY[k].id === g.id) ?? ''], `block:${g.id}`).toBeDefined();
        }
        expect(t.get.count).toBeGreaterThan(0);
        expect(t.xp).toBeGreaterThan(0);
      }
    }
  });

  it('每职业至少 4 项交易', () => {
    for (const list of Object.values(TRADES)) expect(list.length).toBeGreaterThanOrEqual(4);
  });
});

describe('交易执行', () => {
  it('小麦 ×20 → 绿宝石 ×1（扣付出、给获得、有经验）', () => {
    const trade = TRADES.farmer[0];
    const hotbar: Slot[] = [mat('wheat', 20), ...emptySlots().slice(1)];
    expect(canAfford(hotbar, trade)).toBe(true);
    const r = executeTrade(hotbar, emptySlots(), trade)!;
    expect(r).not.toBeNull();
    expect(r.xp).toBe(4);
    // 小麦扣光，绿宝石进栏
    expect(r.hotbar.every((s) => s?.kind !== 'material' || s.material !== 'wheat')).toBe(true);
    expect(r.hotbar.some((s) => s?.kind === 'material' && s.material === 'emerald' && s.count === 1)).toBe(true);
  });

  it('绿宝石 → 面包 ×6（从热键栏扣）', () => {
    const trade = TRADES.farmer[1];
    const hotbar: Slot[] = [mat('emerald', 1), ...emptySlots().slice(1)];
    const r = executeTrade(hotbar, emptySlots(), trade)!;
    expect(r.hotbar.every((s) => s?.kind !== 'material' || s.material !== 'emerald')).toBe(true);
    expect(r.hotbar.some((s) => s?.kind === 'material' && s.material === 'bread' && s.count === 6)).toBe(true);
  });

  it('库存不足返回 null（不扣不减）', () => {
    const trade = TRADES.farmer[0];
    const hotbar: Slot[] = [mat('wheat', 19), ...emptySlots().slice(1)];
    expect(canAfford(hotbar, trade)).toBe(false);
    expect(executeTrade(hotbar, emptySlots(), trade)).toBeNull();
    expect(hotbar[0]?.kind === 'material' && hotbar[0].count === 19).toBe(true);
  });

  it('方块付出：圆石 ×16 → 绿宝石（石匠）', () => {
    const trade = TRADES.mason[0];
    const hotbar: Slot[] = [blk('cobble', 16), ...emptySlots().slice(1)];
    const r = executeTrade(hotbar, emptySlots(), trade)!;
    expect(r.hotbar.every((s) => s?.kind !== 'block')).toBe(true);
    expect(r.hotbar.some((s) => s?.kind === 'material' && s.material === 'emerald')).toBe(true);
  });

  it('装备交易：绿宝石 ×5 → 皮盔（放热键栏空格，满耐久）', () => {
    const trade = TRADES.leatherworker[1];
    const hotbar: Slot[] = [mat('emerald', 5), ...emptySlots().slice(1)];
    const r = executeTrade(hotbar, emptySlots(), trade)!;
    expect(r.hotbar.every((s) => s?.kind !== 'material' || s.material !== 'emerald')).toBe(true);
    expect(r.hotbar.some((s) => s?.kind === 'armor' && s.piece === 'helmet' && s.durability === 55)).toBe(true);
  });

  it('store.executeMobTrade：扣付出给获得并加经验', () => {
    useGameStore.getState().loadSurvival({ health: 20, hunger: 20, slots: [mat('wheat', 20), ...emptySlots().slice(1)] });
    const s = useGameStore.getState();
    // 找一个 farmer 村民 id
    let id = 1;
    while (professionOf(id) !== 'farmer') id++;
    s.setTradeMob(id);
    useGameStore.getState().executeMobTrade(0);
    const after = useGameStore.getState();
    expect(after.hotbarSlots.some((s2) => s2?.kind === 'material' && s2.material === 'emerald')).toBe(true);
    expect(after.xpTotal).toBe(4);
    useGameStore.getState().setTradeMob(null);
  });
});

describe('界面辅助', () => {
  it('tradeItemName 覆盖材料/方块/装备', () => {
    expect(tradeItemName({ kind: 'material', material: 'emerald', count: 1 })).toBe('绿宝石');
    expect(tradeItemName({ kind: 'block', id: BLOCK_BY_KEY.cobble.id, count: 16 })).toBe('圆石');
    expect(tradeItemName({ kind: 'material', material: 'armor:helmet', count: 1 })).toBe('皮革头盔');
  });
});
