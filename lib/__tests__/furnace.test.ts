import { beforeEach, describe, expect, it } from 'vitest';
import { COBBLE, LOG, PLANKS, STONE } from '../blocks';
import {
  clearFurnaces,
  getFurnace,
  putIntoFurnace,
  SMELT_TIME,
  takeOutput,
  tickFurnaces,
} from '../furnace';
import { addStackToSlots, emptySlots, type Slot } from '../slots';

function slotsWith(item: { kind: 'block'; id: number } | { kind: 'material'; material: string }, count: number): Slot[] {
  return addStackToSlots(emptySlots(), item as never, count).slots;
}

describe('熔炉', () => {
  beforeEach(() => clearFurnaces());

  it('放入路由：燃料进燃料槽，可烧物进烧炼槽，无关物品拒绝', () => {
    const f = getFurnace('0,10,0');
    let slots = slotsWith({ kind: 'block', id: PLANKS }, 2);
    const r1 = putIntoFurnace(slots, 0, f);
    expect(r1.to).toBe('fuel');
    expect(f.fuel).toEqual({ item: `block:${PLANKS}`, count: 1 });

    slots = slotsWith({ kind: 'block', id: COBBLE }, 3);
    const r2 = putIntoFurnace(slots, 0, f);
    expect(r2.to).toBe('input');
    expect(f.input).toEqual({ item: `block:${COBBLE}`, count: 1 });
    // 圆石已在烧炼槽后可继续合并
    const r3 = putIntoFurnace(r2.slots, 0, f);
    expect(f.input?.count).toBe(2);
    expect(r3.slots[0]).toEqual({ kind: 'block', id: COBBLE, count: 1 });

    // 石头（非燃料非可烧物）被拒绝
    const r4 = putIntoFurnace(slotsWith({ kind: 'block', id: STONE }, 1), 0, f);
    expect(r4.to).toBeNull();
  });

  it('圆石 + 木板燃料 → 10 秒烧出石头，燃料耗尽即停', () => {
    const f = getFurnace('1,10,1');
    f.input = { item: `block:${COBBLE}`, count: 2 };
    f.fuel = { item: `block:${PLANKS}`, count: 1 };
    tickFurnaces(SMELT_TIME);
    expect(f.output).toEqual({ item: `block:${STONE}`, count: 1 });
    expect(f.input?.count).toBe(1);
    // 木板 15s：已烧 10s，剩 5s 不够第二件，5 秒后停止
    tickFurnaces(5);
    expect(f.fuel).toBeNull();
    const before = f.progress;
    tickFurnaces(SMELT_TIME);
    expect(f.output?.count).toBe(1); // 无燃料不再产出
    expect(f.progress).toBeLessThanOrEqual(before);
  });

  it('原木烧木炭，木炭可作 80s 长效燃料', () => {
    const f = getFurnace('2,10,2');
    f.input = { item: `block:${LOG}`, count: 1 };
    f.fuel = { item: 'material:charcoal', count: 1 };
    tickFurnaces(SMELT_TIME);
    expect(f.output).toEqual({ item: 'material:charcoal', count: 1 });
    expect(f.burnLeft).toBeCloseTo(80 - SMELT_TIME, 1);
  });

  it('产出取出到背包，满则留在炉中', () => {
    const f = getFurnace('3,10,3');
    f.output = { item: `block:${STONE}`, count: 3 };
    const slots = takeOutput(emptySlots(), f);
    expect(f.output).toBeNull();
    expect(slots[0]).toEqual({ kind: 'block', id: STONE, count: 3 });
  });
});

describe('进食', () => {
  it('熟猪排回复 8 饥饿，饱和度受饥饿/4 上限约束', async () => {
    const { useGameStore, MAX_SATURATION } = await import('../store');
    useGameStore.setState({
      worldMode: 'survival',
      health: 20,
      hunger: 6,
      saturation: MAX_SATURATION,
      hotbarSlots: [{ kind: 'material', material: 'cooked_pork', count: 2 }, ...emptySlots().slice(1)],
      selectedSlot: 0,
    });
    expect(useGameStore.getState().eatSelectedFood()).toBe(true);
    const s = useGameStore.getState();
    expect(s.hunger).toBe(14); // 6 + 8
    expect(s.saturation).toBeLessThanOrEqual(14 / 4);
    expect(s.hotbarSlots[0]).toEqual({ kind: 'material', material: 'cooked_pork', count: 1 });
    expect(useGameStore.getState().eatSelectedFood()).toBe(true);
    expect(useGameStore.getState().hotbarSlots[0]).toBeNull();
    expect(useGameStore.getState().eatSelectedFood()).toBe(false); // 空槽不可吃
  });
});
