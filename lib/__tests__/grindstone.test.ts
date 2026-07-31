// 砂轮：方块/配方注册、合并修复与祛魔纯函数、store 槽位交互（Java 行为）

import { beforeEach, describe, expect, it } from 'vitest';
import { clearDrops } from '../items';
import { clearMobs } from '../mobs';
import { BLOCK_BY_KEY, BLOCKS } from '../blocks';
import { disenchantXp, grindResult, isGrindable, sameKind } from '../grindstone';
import { RECIPES } from '../recipes';
import { useGameStore } from '../store';
import { emptySlots, type Slot } from '../slots';
import type { EnchMap } from '../xp';

const sword = (durability: number, ench?: EnchMap): Slot => ({ kind: 'tool', tool: 'diamond_sword', durability, ench });
const pick = (durability: number, ench?: EnchMap): Slot => ({ kind: 'tool', tool: 'diamond_pickaxe', durability, ench });
const chest = (durability: number, material: 'iron' | 'diamond' = 'iron', ench?: EnchMap): Slot => ({ kind: 'armor', piece: 'chestplate', material, durability, ench });

function setup(slots?: Slot[]): void {
  clearDrops();
  clearMobs();
  useGameStore.getState().loadSurvival({ health: 20, hunger: 20, slots: slots ?? emptySlots() });
  useGameStore.setState({
    worldMode: 'survival', xpTotal: 0, cursorSlot: null,
    enchantOpen: null, enchantItem: null, enchantLapis: null,
    grindstoneOpen: null, grindSlots: [null, null],
  });
}

beforeEach(() => setup());

describe('砂轮方块与配方', () => {
  it('方块注册在注册表末尾（id 写存档）：镐挖、utility 类', () => {
    const def = BLOCK_BY_KEY.grindstone;
    expect(def).toBeDefined();
    expect(def.id).toBe(BLOCKS.length - 1);
    expect(def.tool).toBe('pickaxe');
    expect(def.cat).toBe('utility');
  });

  it('配方：2 木棍 + 1 石台阶 + 2 木板，需工作台（MC）', () => {
    const r = RECIPES.find((x) => x.id === 'grindstone');
    expect(r).toBeDefined();
    expect(r!.needsTable).toBe(true);
    expect(r!.out).toEqual({ kind: 'block', id: BLOCK_BY_KEY.grindstone.id, count: 1 });
    const cost = Object.fromEntries(r!.cost.map((c) => [c.item, c.count]));
    expect(cost['material:stick']).toBe(2);
    expect(cost[`block:${BLOCK_BY_KEY.stone_slab.id}`]).toBe(1);
    expect(cost[`block:${BLOCK_BY_KEY.planks.id}`]).toBe(2);
  });
});

describe('砂轮纯函数', () => {
  it('isGrindable / sameKind：工具同 type、装备同部位同材质', () => {
    expect(isGrindable(sword(100))).toBe(true);
    expect(isGrindable({ kind: 'block', id: 1, count: 1 })).toBe(false);
    expect(isGrindable({ kind: 'material', material: 'lapis', count: 1 })).toBe(false);
    expect(sameKind(sword(100), sword(200))).toBe(true);
    expect(sameKind(sword(100), pick(200))).toBe(false); // 不同工具
    expect(sameKind(chest(100, 'iron'), chest(200, 'iron'))).toBe(true);
    expect(sameKind(chest(100, 'iron'), chest(200, 'diamond'))).toBe(false); // 不同材质
    expect(sameKind(sword(100), chest(200))).toBe(false);
  });

  it('合并修复：耐久 = A+B + 5%×最大耐久（封顶 1561），附魔与 works 移除，经验按两件附魔折算', () => {
    const a = { ...sword(500, { sharpness: 3 }), works: 2 } as NonNullable<Slot>;
    const b = sword(400, { unbreaking: 2 });
    const r = grindResult(a, b);
    expect(r).not.toBe(null);
    const out = r!.out;
    if (out.kind !== 'tool') throw new Error('产出应为工具');
    expect(out.durability).toBe(500 + 400 + Math.ceil(1561 * 0.05)); // 979
    expect(out.ench).toBeUndefined(); // 附魔全部移除（MC）
    expect(out.works).toBeUndefined(); // MC：砂轮移除 prior work penalty
    expect(r!.xp).toBe(3 + 2);
  });

  it('合并修复封顶：两件高耐久相加超过最大耐久时封顶', () => {
    const out = grindResult(sword(1500), sword(1500))!.out;
    if (out.kind !== 'tool') throw new Error('产出应为工具');
    expect(out.durability).toBe(1561);
    expect(grindResult(sword(1500), sword(1500))!.xp).toBe(0); // 无附魔不返经验
  });

  it('祛魔：单件附魔物品移出附魔、耐久不变、按等级返经验；无附魔/空/异种无产出', () => {
    const r = grindResult(null, sword(700, { sharpness: 2, knockback: 1 }));
    expect(r).not.toBe(null);
    const out = r!.out;
    if (out.kind !== 'tool') throw new Error('产出应为工具');
    expect(out.durability).toBe(700);
    expect(out.ench).toBeUndefined();
    expect(r!.xp).toBe(3);
    expect(grindResult(sword(700), null)).toBe(null); // 无附魔无可祛
    expect(grindResult(null, null)).toBe(null);
    expect(grindResult(sword(100), pick(100))).toBe(null); // 两件不同种
    expect(grindResult({ kind: 'block', id: 1, count: 1 }, null)).toBe(null); // 不可磨物品
  });

  it('disenchantXp：按附魔等级求和（Java min/max 均值的近似）', () => {
    expect(disenchantXp(undefined)).toBe(0);
    expect(disenchantXp({})).toBe(0);
    expect(disenchantXp({ sharpness: 3, unbreaking: 2 })).toBe(5);
  });
});

describe('砂轮 store 槽位交互', () => {
  const openGrind = (): void => useGameStore.setState({ grindstoneOpen: '0,64,0' });

  it('输入槽只收工具/装备：方块/材料光标拒入，工具光标放入', () => {
    openGrind();
    useGameStore.setState({ cursorSlot: { kind: 'block', id: BLOCK_BY_KEY.stone.id, count: 1 } });
    useGameStore.getState().grindSlotMouseDown(0, { button: 0, shift: false });
    expect(useGameStore.getState().grindSlots[0]).toBe(null);
    expect(useGameStore.getState().cursorSlot?.kind).toBe('block');
    useGameStore.setState({ cursorSlot: sword(500, { sharpness: 2 }) });
    useGameStore.getState().grindSlotMouseDown(0, { button: 0, shift: false });
    expect(useGameStore.getState().grindSlots[0]?.kind).toBe('tool');
    expect(useGameStore.getState().cursorSlot).toBe(null);
  });

  it('取出产出：两件输入清空、成品入光标、返还祛魔经验', () => {
    openGrind();
    useGameStore.setState({ grindSlots: [sword(500, { sharpness: 3 }), sword(400)] });
    useGameStore.getState().grindTakeOutput({ button: 0, shift: false });
    const s = useGameStore.getState();
    expect(s.grindSlots).toEqual([null, null]);
    const cur = s.cursorSlot;
    expect(cur?.kind === 'tool' && cur.durability).toBe(500 + 400 + Math.ceil(1561 * 0.05));
    expect(cur?.kind === 'tool' && cur.ench).toBeUndefined();
    expect(s.xpTotal).toBe(3);
  });

  it('取出产出：光标有物时拒取（成品不可堆叠）', () => {
    openGrind();
    useGameStore.setState({ grindSlots: [sword(500), sword(400)], cursorSlot: { kind: 'material', material: 'lapis', count: 1 } });
    useGameStore.getState().grindTakeOutput({ button: 0, shift: false });
    expect(useGameStore.getState().grindSlots[0]?.kind).toBe('tool'); // 未消耗
  });

  it('shift 取出产出直接入背包并返经验；shift 点击输入槽退回背包', () => {
    const slots = emptySlots();
    setup(slots);
    openGrind();
    useGameStore.setState({ grindSlots: [sword(500, { sharpness: 1 }), sword(400)] });
    useGameStore.getState().grindTakeOutput({ button: 0, shift: true });
    const s = useGameStore.getState();
    expect(s.grindSlots).toEqual([null, null]);
    expect(s.cursorSlot).toBe(null);
    expect(s.hotbarSlots[0]?.kind === 'tool' && s.hotbarSlots[0].durability).toBe(979);
    expect(s.xpTotal).toBe(1);
    // shift 点击输入槽：退回背包
    useGameStore.setState({ grindSlots: [sword(300), null] });
    useGameStore.getState().grindSlotMouseDown(0, { button: 0, shift: true });
    expect(useGameStore.getState().grindSlots[0]).toBe(null);
    const back = useGameStore.getState().hotbarSlots[1];
    expect(back?.kind === 'tool' && back.durability).toBe(300);
  });

  it('shift 快移：背包工具进砂轮第一个空输入槽（Java）', () => {
    const slots = emptySlots();
    slots[2] = sword(600);
    setup(slots);
    openGrind();
    useGameStore.getState().slotMouseDown('hotbar', 2, { button: 0, shift: true });
    const s = useGameStore.getState();
    expect(s.hotbarSlots[2]).toBe(null);
    expect(s.grindSlots[0]?.kind === 'tool' && s.grindSlots[0].durability).toBe(600);
  });

  it('关闭砂轮界面：输入槽内容退回背包（不吞物品）', () => {
    const slots = emptySlots();
    setup(slots);
    openGrind();
    useGameStore.setState({ grindSlots: [sword(500), sword(400, { unbreaking: 1 })] });
    useGameStore.getState().setGrindstoneOpen(null);
    const s = useGameStore.getState();
    expect(s.grindSlots).toEqual([null, null]);
    expect(s.hotbarSlots[0]?.kind === 'tool' && s.hotbarSlots[0].durability).toBe(500);
    expect(s.hotbarSlots[1]?.kind === 'tool' && s.hotbarSlots[1].ench?.unbreaking).toBe(1);
  });

  it('界面互斥：砂轮开时开熔炉，砂轮关闭且槽内物品退回背包', () => {
    const slots = emptySlots();
    setup(slots);
    openGrind();
    useGameStore.setState({ grindSlots: [sword(500), null] });
    useGameStore.getState().setFurnaceOpen('1,64,1');
    const s = useGameStore.getState();
    expect(s.grindstoneOpen).toBe(null);
    expect(s.furnaceOpen).toBe('1,64,1');
    expect(s.grindSlots).toEqual([null, null]);
    expect(s.hotbarSlots[0]?.kind).toBe('tool');
  });
});
