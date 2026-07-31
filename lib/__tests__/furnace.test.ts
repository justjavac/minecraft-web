import { beforeEach, describe, expect, it } from 'vitest';
import { BLOCK_BY_KEY, COBBLE, GLASS, LOG, PLANKS, STONE } from '../blocks';
import {
  clearFurnaces,
  FOODS,
  FUELS,
  getFurnace,
  putIntoFurnace,
  SMELT_TIME,
  SMELTING,
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

  it('输出槽堵住时已点燃的燃料照常燃烧，只冻结烧炼进度（MC）', () => {
    const f = getFurnace('4,10,4');
    f.input = { item: `block:${COBBLE}`, count: 1 };
    f.fuel = { item: 'material:coal', count: 1 };
    f.output = { item: `block:${GLASS}`, count: 1 }; // 与产出（石头）不同 → 堵住
    f.burnLeft = 50; // 视同已在燃烧
    tickFurnaces(10);
    expect(f.burnLeft).toBeCloseTo(40, 5); // 燃料照烧
    expect(f.progress).toBe(0); // 进度冻结
    expect(f.output).toEqual({ item: `block:${GLASS}`, count: 1 });
    // 未点燃（burnLeft 0）且输出堵住时不会新点燃料（MC：无可烧产物不点火）
    const g = getFurnace('4,11,4');
    g.input = { item: `block:${COBBLE}`, count: 1 };
    g.fuel = { item: 'material:coal', count: 1 };
    g.output = { item: `block:${GLASS}`, count: 1 };
    tickFurnaces(10);
    expect(g.burnLeft).toBe(0);
    expect(g.fuel?.count).toBe(1);
  });

  it('烧炼经验按配方表累积（MC）：铁/铜 0.7、金 1.0、食物 0.35、木炭 0.15、远古残骸 2.0，缺省 0.1', () => {
    expect(SMELTING['material:raw_iron'].xp).toBe(0.7);
    expect(SMELTING['material:raw_copper'].xp).toBe(0.7);
    expect(SMELTING['material:raw_gold'].xp).toBe(1.0);
    expect(SMELTING['material:raw_pork'].xp).toBe(0.35);
    expect(SMELTING[`block:${LOG}`].xp).toBe(0.15);
    expect(SMELTING[`block:${BLOCK_BY_KEY.ancient_debris.id}`].xp).toBe(2.0);
    // 缺省 0.1：烧 1 个圆石（无 xp 字段）炉内累积 0.1
    const f = getFurnace('6,10,6');
    f.input = { item: `block:${COBBLE}`, count: 1 };
    f.fuel = { item: 'material:coal', count: 1 };
    tickFurnaces(SMELT_TIME);
    expect(f.xp).toBeCloseTo(0.1, 5);
  });

  it('取出经验按炉内累积结算：烧 3 个铁取出 = floor(3×0.7) = 2 XP，余 0.1 留炉（MC）', async () => {
    const { useGameStore } = await import('../store');
    const f = getFurnace('9,9,9');
    f.input = { item: 'material:raw_iron', count: 3 };
    f.fuel = { item: 'material:coal', count: 1 };
    for (let i = 0; i < 3; i++) tickFurnaces(SMELT_TIME); // tick 一次最多烧 1 件
    expect(f.output).toEqual({ item: 'material:iron_ingot', count: 3 });
    expect(f.xp).toBeCloseTo(2.1, 5);
    useGameStore.setState({ worldMode: 'survival', furnaceOpen: '9,9,9', hotbarSlots: emptySlots(), xpTotal: 0 });
    useGameStore.getState().furnaceTakeOutput();
    expect(useGameStore.getState().xpTotal).toBe(2); // floor(2.1)
    expect(f.xp).toBeCloseTo(0.1, 5); // 余数留炉
    expect(f.output).toBeNull();
    useGameStore.setState({ furnaceOpen: null });
  });

  it('取出经验：热键栏满取不出则不给、经验留炉（MC）', async () => {
    const { useGameStore } = await import('../store');
    const f = getFurnace('10,10,10');
    f.output = { item: `block:${STONE}`, count: 4 };
    f.xp = 3.7;
    const full = emptySlots().map(() => ({ kind: 'block', id: COBBLE, count: 64 }) as Slot);
    useGameStore.setState({ worldMode: 'survival', furnaceOpen: '10,10,10', hotbarSlots: full, xpTotal: 0 });
    useGameStore.getState().furnaceTakeOutput();
    expect(useGameStore.getState().xpTotal).toBe(0);
    expect(f.xp).toBeCloseTo(3.7, 5);
    expect(f.output?.count).toBe(4);
    useGameStore.setState({ furnaceOpen: null });
  });

  it('从未烧炼（xp=0）的炉取出成品不给经验、不报错', async () => {
    const { useGameStore } = await import('../store');
    const f = getFurnace('11,11,11');
    f.output = { item: `block:${STONE}`, count: 2 };
    expect(f.xp).toBe(0);
    useGameStore.setState({ worldMode: 'survival', furnaceOpen: '11,11,11', hotbarSlots: emptySlots(), xpTotal: 0 });
    useGameStore.getState().furnaceTakeOutput();
    expect(useGameStore.getState().xpTotal).toBe(0);
    expect(f.output).toBeNull();
    useGameStore.setState({ furnaceOpen: null });
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

  it('满饥饿拒绝进食并提示「还不饿」', async () => {
    const { useGameStore } = await import('../store');
    useGameStore.setState({
      worldMode: 'survival',
      health: 20,
      hunger: 20,
      saturation: 0,
      notice: null,
      hotbarSlots: [{ kind: 'material', material: 'cooked_pork', count: 1 }, ...emptySlots().slice(1)],
      selectedSlot: 0,
    });
    expect(useGameStore.getState().eatSelectedFood()).toBe(false);
    expect(useGameStore.getState().notice).toBe('还不饿');
    expect(useGameStore.getState().hotbarSlots[0]).toEqual({ kind: 'material', material: 'cooked_pork', count: 1 }); // 不消耗
  });

  it('腐肉可食用（MC：饥饿 4、饱和 0.8 ÷4 缩放 0.2）', async () => {
    expect(FOODS.rotten_flesh).toEqual({ name: '腐肉', hunger: 4, saturation: 0.2 });
    const { useGameStore } = await import('../store');
    useGameStore.setState({
      worldMode: 'survival',
      health: 20,
      hunger: 10,
      saturation: 0,
      hotbarSlots: [{ kind: 'material', material: 'rotten_flesh', count: 1 }, ...emptySlots().slice(1)],
      selectedSlot: 0,
    });
    expect(useGameStore.getState().eatSelectedFood()).toBe(true);
    const s = useGameStore.getState();
    expect(s.hunger).toBe(14); // 10 + 4
    expect(s.saturation).toBeCloseTo(0.2, 5);
    expect(s.hotbarSlots[0]).toBeNull();
  });
});

describe('燃料', () => {
  beforeEach(() => clearFurnaces());

  it('烈焰棒可作燃料（MC 120 秒，一根烧 12 件）', () => {
    expect(FUELS['material:blaze_rod']).toBe(120);
    const f = getFurnace('5,10,5');
    f.input = { item: `block:${COBBLE}`, count: 1 };
    f.fuel = { item: 'material:blaze_rod', count: 1 };
    tickFurnaces(SMELT_TIME);
    expect(f.output).toEqual({ item: `block:${STONE}`, count: 1 });
    expect(f.burnLeft).toBeCloseTo(120 - SMELT_TIME, 1);
  });
});
