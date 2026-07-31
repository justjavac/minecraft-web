// 光标交互纯函数（lib/inventory.ts）：左键拿放/合并/交换、右键半取/单放、
// 左键拖动均分、右键拖动单放、双击收集、shift 快移、字符串栈（熔炉/酿造）点击；
// 末尾为 store 薄 action（slotMouseDown/slotDragEnter/dragEnd/slotDoubleClick/stowCursor 等）集成测试

import { beforeEach, describe, expect, it } from 'vitest';
import { BLOCK_BY_KEY, COBBLE } from '../blocks';
import { clearBrews, getBrew } from '../brewing';
import { clearFurnaces, getFurnace } from '../furnace';
import { clearDrops, itemDrops } from '../items';
import {
  clickItemStack,
  clickSlot,
  collectToCursor,
  dragPlaceOne,
  dragSplit,
  itemKeyToSlot,
  rightClickSlot,
  shiftMove,
  slotToItemKey,
} from '../inventory';
import { emptyBackpack, emptySlots, type Slot } from '../slots';
import { clearStorages, getStorage } from '../storage';
import { useGameStore } from '../store';

const STONE = BLOCK_BY_KEY.stone.id;
const DIRT = BLOCK_BY_KEY.dirt.id;

const stone = (count: number): Slot => ({ kind: 'block', id: STONE, count });
const dirt = (count: number): Slot => ({ kind: 'block', id: DIRT, count });
const coal = (count: number): Slot => ({ kind: 'material', material: 'coal', count });
const pick = (): Slot => ({ kind: 'tool', tool: 'iron_pickaxe', durability: 200 });

function slotsWith(...entries: [number, Slot][]): Slot[] {
  const slots = emptySlots();
  for (const [i, s] of entries) slots[i] = s;
  return slots;
}

describe('clickSlot（左键）', () => {
  it('光标空 → 拿起整堆', () => {
    const r = clickSlot(slotsWith([0, stone(30)]), 0, null);
    expect(r.cursor).toEqual(stone(30));
    expect(r.slots[0]).toBeNull();
  });

  it('光标有物 + 空格 → 放下', () => {
    const r = clickSlot(slotsWith(), 3, stone(10));
    expect(r.slots[3]).toEqual(stone(10));
    expect(r.cursor).toBeNull();
  });

  it('同类合并到 64，余数留光标', () => {
    const r = clickSlot(slotsWith([0, stone(50)]), 0, stone(30));
    expect(r.slots[0]).toEqual(stone(64));
    expect(r.cursor).toEqual(stone(16));
  });

  it('同类合并刚好放满 → 光标清空', () => {
    const r = clickSlot(slotsWith([0, stone(50)]), 0, stone(14));
    expect(r.slots[0]).toEqual(stone(64));
    expect(r.cursor).toBeNull();
  });

  it('异类 → 交换', () => {
    const r = clickSlot(slotsWith([0, dirt(5)]), 0, stone(10));
    expect(r.slots[0]).toEqual(stone(10));
    expect(r.cursor).toEqual(dirt(5));
  });

  it('目标已满（64）→ 交换', () => {
    const r = clickSlot(slotsWith([0, stone(64)]), 0, stone(10));
    expect(r.slots[0]).toEqual(stone(10));
    expect(r.cursor).toEqual(stone(64));
  });

  it('不可堆叠工具：与方块交换，永不合并', () => {
    const r = clickSlot(slotsWith([0, stone(10)]), 0, pick());
    expect(r.slots[0]).toEqual(pick());
    expect(r.cursor).toEqual(stone(10));
  });

  it('双空点击无操作（引用不变）', () => {
    const slots = slotsWith();
    const r = clickSlot(slots, 0, null);
    expect(r.slots).toBe(slots);
    expect(r.cursor).toBeNull();
  });
});

describe('rightClickSlot（右键）', () => {
  it('光标空 → 拿起一半（向上取整）', () => {
    const r = rightClickSlot(slotsWith([0, stone(5)]), 0, null);
    expect(r.cursor).toEqual(stone(3));
    expect(r.slots[0]).toEqual(stone(2));
  });

  it('只有 1 个时右键拿起整件', () => {
    const r = rightClickSlot(slotsWith([0, stone(1)]), 0, null);
    expect(r.cursor).toEqual(stone(1));
    expect(r.slots[0]).toBeNull();
  });

  it('光标空 + 工具 → 拿起整件', () => {
    const r = rightClickSlot(slotsWith([0, pick()]), 0, null);
    expect(r.cursor).toEqual(pick());
    expect(r.slots[0]).toBeNull();
  });

  it('光标有物 + 空格 → 放一个', () => {
    const r = rightClickSlot(slotsWith(), 2, stone(10));
    expect(r.slots[2]).toEqual(stone(1));
    expect(r.cursor).toEqual(stone(9));
  });

  it('光标有物 + 同类未满 → 放一个', () => {
    const r = rightClickSlot(slotsWith([0, stone(63)]), 0, stone(5));
    expect(r.slots[0]).toEqual(stone(64));
    expect(r.cursor).toEqual(stone(4));
  });

  it('光标只剩 1 个时放下后光标清空', () => {
    const r = rightClickSlot(slotsWith(), 0, stone(1));
    expect(r.slots[0]).toEqual(stone(1));
    expect(r.cursor).toBeNull();
  });

  it('同类已满 / 异类 → 不动', () => {
    const full = slotsWith([0, stone(64)]);
    expect(rightClickSlot(full, 0, stone(5)).slots).toBe(full);
    const other = slotsWith([0, dirt(3)]);
    expect(rightClickSlot(other, 0, stone(5)).slots).toBe(other);
  });

  it('光标为工具 → 整件放入空格', () => {
    const r = rightClickSlot(slotsWith(), 0, pick());
    expect(r.slots[0]).toEqual(pick());
    expect(r.cursor).toBeNull();
  });
});

describe('dragSplit（左键拖动均分）', () => {
  it('10 个均分 3 空格：3/3/3，余 1 留光标', () => {
    const r = dragSplit([null, null, null], stone(10));
    expect(r.slots).toEqual([stone(3), stone(3), stone(3)]);
    expect(r.cursor).toEqual(stone(1));
  });

  it('异类格不参与计数', () => {
    const r = dragSplit([dirt(5), null, null], stone(8));
    expect(r.slots[0]).toEqual(dirt(5));
    expect(r.slots[1]).toEqual(stone(4));
    expect(r.slots[2]).toEqual(stone(4));
    expect(r.cursor).toBeNull();
  });

  it('同类未满格在原有数量上叠加、封顶 64，溢出退回光标', () => {
    // 份额 floor(20/2)=10；第一格只剩 4 空间，多出的 6 退回光标
    const r = dragSplit([stone(60), null], stone(20));
    expect(r.slots[0]).toEqual(stone(64));
    expect(r.slots[1]).toEqual(stone(10));
    expect(r.cursor).toEqual(stone(6));
  });

  it('数量不足均分（份额 0）→ 不动', () => {
    const before: Slot[] = [null, null, null];
    const r = dragSplit(before, stone(2));
    expect(r.slots).toBe(before);
    expect(r.cursor).toEqual(stone(2));
  });

  it('不可堆叠光标 → 不动', () => {
    const before: Slot[] = [null, null];
    const r = dragSplit(before, pick());
    expect(r.slots).toBe(before);
    expect(r.cursor).toEqual(pick());
  });
});

describe('dragPlaceOne（右键拖动单放）', () => {
  it('空格放 1 个', () => {
    const r = dragPlaceOne(null, stone(3));
    expect(r.slot).toEqual(stone(1));
    expect(r.cursor).toEqual(stone(2));
  });

  it('同类未满 +1', () => {
    const r = dragPlaceOne(stone(63), stone(3));
    expect(r.slot).toEqual(stone(64));
    expect(r.cursor).toEqual(stone(2));
  });

  it('异类/已满跳过', () => {
    expect(dragPlaceOne(dirt(1), stone(3)).slot).toEqual(dirt(1));
    expect(dragPlaceOne(stone(64), stone(3)).slot).toEqual(stone(64));
  });
});

describe('collectToCursor（双击收集）', () => {
  it('跨区域收集同类到 64', () => {
    const hotbar = slotsWith([0, stone(40)], [1, dirt(9)], [2, stone(30)]);
    const main = slotsWith([0, stone(10)]);
    const r = collectToCursor([hotbar, main], stone(20));
    expect(r.cursor).toEqual(stone(64));
    // 20+40=60 取空第一格，再从第二堆取 4 个凑满，后续格不动
    expect(r.areas[0][0]).toBeNull();
    expect(r.areas[0][2]).toEqual(stone(26));
    expect(r.areas[1][0]).toEqual(stone(10));
    expect(r.areas[0][1]).toEqual(dirt(9)); // 异类不动
  });

  it('收集把源堆取空后清格，部分取留余数', () => {
    const hotbar = slotsWith([0, stone(50)]);
    const r = collectToCursor([hotbar], stone(30));
    expect(r.cursor).toEqual(stone(64));
    expect(r.areas[0][0]).toEqual(stone(16));
  });

  it('光标已满 / 不可堆叠 → 不动', () => {
    const hotbar = slotsWith([0, stone(10)]);
    expect(collectToCursor([hotbar], stone(64)).cursor).toEqual(stone(64));
    expect(collectToCursor([hotbar], pick()).areas[0][0]).toEqual(stone(10));
  });
});

describe('shiftMove（shift 快速移动）', () => {
  it('整叠移入目标：先并堆再占空格（MC），源格清空', () => {
    const target = slotsWith([0, stone(50)]);
    const r = shiftMove(stone(30), target);
    expect(r.target[0]).toEqual(stone(64));
    expect(r.target[1]).toEqual(stone(16)); // 并堆余量占目标区空格
    expect(r.slot).toBeNull();
  });

  it('目标区并堆后仍放不下 → 余数留原格', () => {
    // 仅 slot0 可并 14 个，其余格被泥土塞满：80-14=66 留原格
    const target = [stone(50), ...emptySlots().slice(1).map(() => dirt(64))];
    const r = shiftMove(stone(80), target);
    expect(r.target[0]).toEqual(stone(64));
    expect(r.slot).toEqual(stone(66));
  });

  it('工具占第一个空槽', () => {
    const target = slotsWith([0, stone(1)]);
    const r = shiftMove(pick(), target);
    expect(r.target[1]).toEqual(pick());
    expect(r.slot).toBeNull();
  });

  it('目标满 → 引用不变', () => {
    const target = emptySlots().map(() => dirt(64));
    const r = shiftMove(stone(10), target);
    expect(r.target).toBe(target);
    expect(r.slot).toEqual(stone(10));
  });
});

describe('字符串栈（熔炉/酿造槽）', () => {
  it('slotToItemKey / itemKeyToSlot 互转，工具返回 null', () => {
    expect(slotToItemKey(stone(5))).toBe(`block:${STONE}`);
    expect(slotToItemKey(coal(2))).toBe('material:coal');
    expect(slotToItemKey(pick())).toBeNull();
    expect(itemKeyToSlot(`block:${STONE}`, 3)).toEqual(stone(3));
    expect(itemKeyToSlot('material:coal', 2)).toEqual(coal(2));
    expect(itemKeyToSlot('blaze_powder', 1)).toEqual({ kind: 'material', material: 'blaze_powder', count: 1 });
  });

  it('左键拿起/放下/合并', () => {
    let r = clickItemStack({ item: 'material:coal', count: 10 }, null, 0);
    expect(r.stack).toBeNull();
    expect(r.cursor).toEqual(coal(10));
    r = clickItemStack(null, coal(5), 0);
    expect(r.stack).toEqual({ item: 'material:coal', count: 5 });
    expect(r.cursor).toBeNull();
    r = clickItemStack({ item: 'material:coal', count: 60 }, coal(10), 0);
    expect(r.stack).toEqual({ item: 'material:coal', count: 64 });
    expect(r.cursor).toEqual(coal(6));
  });

  it('右键半取（向上取整）与单放', () => {
    let r = clickItemStack({ item: 'material:coal', count: 5 }, null, 2);
    expect(r.cursor).toEqual(coal(3));
    expect(r.stack).toEqual({ item: 'material:coal', count: 2 });
    r = clickItemStack({ item: 'material:coal', count: 63 }, coal(4), 2);
    expect(r.stack).toEqual({ item: 'material:coal', count: 64 });
    expect(r.cursor).toEqual(coal(3));
  });

  it('异类左键交换；工具/装备进不了字符串栈', () => {
    const r = clickItemStack({ item: `block:${DIRT}`, count: 2 }, coal(5), 0);
    expect(r.stack).toEqual({ item: 'material:coal', count: 5 });
    expect(r.cursor).toEqual(dirt(2));
    const noop = clickItemStack({ item: 'material:coal', count: 2 }, pick(), 0);
    expect(noop.stack).toEqual({ item: 'material:coal', count: 2 });
    expect(noop.cursor).toEqual(pick());
  });

  it('max=1（药水槽）：只能放 1 个，满时不交换大堆', () => {
    const r = clickItemStack(null, coal(10), 0, 1, true);
    expect(r.stack).toEqual({ item: 'coal', count: 1 });
    expect(r.cursor).toEqual(coal(9));
    // 已有 1 个且光标为异类大堆：max=1 放不下 → 不交换
    const busy = clickItemStack({ item: 'awkward', count: 1 }, coal(10), 0, 1, true);
    expect(busy.stack).toEqual({ item: 'awkward', count: 1 });
    expect(busy.cursor).toEqual(coal(10));
  });

  it('bare 模式：裸材料名（酿造台），带前缀光标串可合并', () => {
    const r = clickItemStack({ item: 'nether_wart', count: 3 }, { kind: 'material', material: 'nether_wart', count: 2 }, 0, 64, true);
    expect(r.stack).toEqual({ item: 'nether_wart', count: 5 });
    expect(r.cursor).toBeNull();
  });
});

// ——— store 薄 action 集成（MC Java 光标语义在 zustand 上的接线） ———

const LEFT = { button: 0, shift: false };
const RIGHT = { button: 2, shift: false };
const SHIFT_LEFT = { button: 0, shift: true };

function resetStore(): void {
  clearStorages();
  clearFurnaces();
  clearBrews();
  clearDrops();
  useGameStore.getState().loadSurvival({ health: 20, hunger: 20, slots: emptySlots(), backpack: emptyBackpack() });
  useGameStore.setState({
    worldMode: 'survival',
    craftingOpen: false,
    furnaceOpen: null,
    brewingOpen: null,
    storageOpen: null,
    cursorSlot: null,
  });
  useGameStore.getState().dragEnd(); // 清掉上个用例可能残留的拖动 pending
}

describe('store 光标 action', () => {
  beforeEach(resetStore);

  it('空光标按下拿起整堆；有光标按下+松开（未拖动）= 放下', () => {
    useGameStore.setState({ hotbarSlots: slotsWith([0, stone(30)]) });
    const st = useGameStore.getState();
    st.slotMouseDown('hotbar', 0, LEFT);
    expect(useGameStore.getState().cursorSlot).toEqual(stone(30));
    expect(useGameStore.getState().hotbarSlots[0]).toBeNull();
    // 光标有物：按下只记 pending，pointerup（dragEnd）未拖动才结算
    st.slotMouseDown('main', 4, LEFT);
    expect(useGameStore.getState().mainSlots[4]).toBeNull();
    st.dragEnd();
    expect(useGameStore.getState().mainSlots[4]).toEqual(stone(30));
    expect(useGameStore.getState().cursorSlot).toBeNull();
  });

  it('右键空光标拿起一半（向上取整）；有光标右键放下 1 个', () => {
    useGameStore.setState({ hotbarSlots: slotsWith([0, stone(5)]) });
    const st = useGameStore.getState();
    st.slotMouseDown('hotbar', 0, RIGHT);
    expect(useGameStore.getState().cursorSlot).toEqual(stone(3));
    expect(useGameStore.getState().hotbarSlots[0]).toEqual(stone(2));
    st.slotMouseDown('main', 0, RIGHT);
    st.dragEnd();
    expect(useGameStore.getState().mainSlots[0]).toEqual(stone(1));
    expect(useGameStore.getState().cursorSlot).toEqual(stone(2));
  });

  it('左键拖动均分（floor，余数留光标），mouseup 后余数保留', () => {
    useGameStore.setState({ hotbarSlots: slotsWith([0, stone(10)]) });
    const st = useGameStore.getState();
    st.slotMouseDown('hotbar', 0, LEFT); // 拿起 10
    st.slotMouseDown('main', 0, LEFT); // pending
    st.slotDragEnter('main', 1); // 晋升拖动：2 格 5/5
    st.slotDragEnter('main', 2); // 3 格重算 3/3/3
    let cur = useGameStore.getState();
    expect(cur.mainSlots[0]).toEqual(stone(3));
    expect(cur.mainSlots[1]).toEqual(stone(3));
    expect(cur.mainSlots[2]).toEqual(stone(3));
    expect(cur.cursorSlot).toEqual(stone(1));
    st.dragEnd(); // 真拖动：余数留光标
    cur = useGameStore.getState();
    expect(cur.cursorSlot).toEqual(stone(1));
  });

  it('右键拖动逐格放 1 个（含起点格），光标耗尽即停', () => {
    useGameStore.setState({ hotbarSlots: slotsWith([0, stone(5)]) });
    const st = useGameStore.getState();
    st.slotMouseDown('hotbar', 0, LEFT); // 拿起 5
    st.slotMouseDown('main', 0, RIGHT); // pending（右键）
    st.slotDragEnter('main', 1);
    st.slotDragEnter('main', 2);
    const cur = useGameStore.getState();
    expect(cur.mainSlots[0]).toEqual(stone(1));
    expect(cur.mainSlots[1]).toEqual(stone(1));
    expect(cur.mainSlots[2]).toEqual(stone(1));
    expect(cur.cursorSlot).toEqual(stone(2));
  });

  it('shift 快移：合成界面背包↔热键栏；容器界面背包→容器、容器→背包', () => {
    useGameStore.setState({ hotbarSlots: slotsWith([0, stone(10)]), craftingOpen: true });
    const st = useGameStore.getState();
    st.slotMouseDown('hotbar', 0, SHIFT_LEFT);
    expect(useGameStore.getState().mainSlots[0]).toEqual(stone(10));
    expect(useGameStore.getState().hotbarSlots[0]).toBeNull();
    // 容器界面：背包 → 容器，容器 → 热键栏优先
    useGameStore.setState({ craftingOpen: false, storageOpen: '1,2,3' });
    st.slotMouseDown('main', 0, SHIFT_LEFT);
    expect(getStorage('1,2,3')[0]).toEqual(stone(10));
    st.slotMouseDown('storage', 0, SHIFT_LEFT);
    expect(getStorage('1,2,3')[0]).toBeNull();
    expect(useGameStore.getState().hotbarSlots[0]).toEqual(stone(10));
  });

  it('shift 快移：熔炉界面可烧炼物→输入槽、燃料→燃料槽、其余不动', () => {
    useGameStore.setState({
      hotbarSlots: slotsWith([0, { kind: 'block', id: COBBLE, count: 20 }], [1, coal(5)], [2, dirt(3)], [3, pick()]),
      furnaceOpen: '5,6,7',
    });
    const st = useGameStore.getState();
    const f = getFurnace('5,6,7');
    st.slotMouseDown('hotbar', 0, SHIFT_LEFT);
    expect(f.input).toEqual({ item: `block:${COBBLE}`, count: 20 });
    st.slotMouseDown('hotbar', 1, SHIFT_LEFT);
    expect(f.fuel).toEqual({ item: 'material:coal', count: 5 });
    st.slotMouseDown('hotbar', 2, SHIFT_LEFT); // 不可烧非燃料：不动
    st.slotMouseDown('hotbar', 3, SHIFT_LEFT); // 工具：不动
    expect(f.input).toEqual({ item: `block:${COBBLE}`, count: 20 });
    expect(f.fuel).toEqual({ item: 'material:coal', count: 5 });
    expect(useGameStore.getState().hotbarSlots[2]).toEqual(dirt(3));
    expect(useGameStore.getState().hotbarSlots[3]).toEqual(pick());
  });

  it('熔炉槽光标：输入槽拿放/合并，工具拒绝，产出槽只能取', () => {
    useGameStore.setState({ furnaceOpen: '5,6,7' });
    const st = useGameStore.getState();
    const f = getFurnace('5,6,7');
    f.input = { item: `block:${COBBLE}`, count: 10 };
    st.furnaceSlotMouseDown('input', LEFT); // 拿起
    expect(useGameStore.getState().cursorSlot).toEqual({ kind: 'block', id: COBBLE, count: 10 });
    expect(f.input).toBeNull();
    st.furnaceSlotMouseDown('input', LEFT); // 放回
    expect(f.input).toEqual({ item: `block:${COBBLE}`, count: 10 });
    expect(useGameStore.getState().cursorSlot).toBeNull();
    // 工具进不了熔炉槽
    useGameStore.setState({ cursorSlot: pick() });
    st.furnaceSlotMouseDown('input', LEFT);
    expect(f.input).toEqual({ item: `block:${COBBLE}`, count: 10 });
    expect(useGameStore.getState().cursorSlot).toEqual(pick());
    // 产出槽：左键取到光标；有光标（异类）不能放
    f.output = { item: `block:${STONE}`, count: 5 };
    st.furnaceSlotMouseDown('output', LEFT);
    expect(useGameStore.getState().cursorSlot).toEqual(pick()); // 拿着工具点产出：异类不能取
    useGameStore.setState({ cursorSlot: null });
    st.furnaceSlotMouseDown('output', LEFT);
    expect(useGameStore.getState().cursorSlot).toEqual(stone(5));
    expect(f.output).toBeNull();
    // 产出槽不能放入
    st.furnaceSlotMouseDown('output', LEFT);
    expect(f.output).toBeNull();
    expect(useGameStore.getState().cursorSlot).toEqual(stone(5));
  });

  it('酿造台槽光标：类型约束（烈焰粉/材料/药水），药水槽 1 个', () => {
    useGameStore.setState({ brewingOpen: '9,9,9' });
    const st = useGameStore.getState();
    const b = getBrew('9,9,9');
    // 煤炭放不进任何酿造槽
    useGameStore.setState({ cursorSlot: coal(3) });
    st.brewingSlotMouseDown('fuel', 0, LEFT);
    st.brewingSlotMouseDown('ingredient', 0, LEFT);
    st.brewingSlotMouseDown('potion', 0, LEFT);
    expect(b.fuel).toBeNull();
    expect(b.ingredient).toBeNull();
    expect(b.potions[0]).toBeNull();
    // 烈焰粉 → 燃料槽；地狱疣 → 材料槽；水瓶 → 药水槽（放 1 个）
    useGameStore.setState({ cursorSlot: { kind: 'material', material: 'blaze_powder', count: 2 } });
    st.brewingSlotMouseDown('fuel', 0, LEFT);
    expect(b.fuel).toEqual({ item: 'blaze_powder', count: 2 });
    useGameStore.setState({ cursorSlot: { kind: 'material', material: 'nether_wart', count: 4 } });
    st.brewingSlotMouseDown('ingredient', 0, LEFT);
    expect(b.ingredient).toEqual({ item: 'nether_wart', count: 4 });
    useGameStore.setState({ cursorSlot: { kind: 'material', material: 'water_bottle', count: 3 } });
    st.brewingSlotMouseDown('potion', 0, LEFT);
    expect(b.potions[0]).toEqual({ item: 'water_bottle', count: 1 });
    expect(useGameStore.getState().cursorSlot).toEqual({ kind: 'material', material: 'water_bottle', count: 2 });
  });

  it('双击收集：界面内同类收进光标到 64', () => {
    useGameStore.setState({
      hotbarSlots: slotsWith([0, stone(40)], [1, dirt(9)]),
      mainSlots: slotsWith([0, stone(30)]),
      cursorSlot: stone(10),
      craftingOpen: true,
    });
    useGameStore.getState().slotDoubleClick('hotbar', 0);
    const cur = useGameStore.getState();
    expect(cur.cursorSlot).toEqual(stone(64));
    expect(cur.hotbarSlots[0]).toBeNull();
    expect(cur.hotbarSlots[1]).toEqual(dirt(9));
    expect(cur.mainSlots[0]).toEqual(stone(16));
  });

  it('stowCursor：退回背包（并堆+空格），全满则在脚下生成掉落', () => {
    useGameStore.setState({ hotbarSlots: slotsWith([0, stone(50)]), cursorSlot: stone(30) });
    useGameStore.getState().stowCursor();
    let cur = useGameStore.getState();
    expect(cur.cursorSlot).toBeNull();
    expect(cur.hotbarSlots[0]).toEqual(stone(64));
    expect(cur.hotbarSlots[1]).toEqual(stone(16));
    // 全满 → 掉落
    useGameStore.setState({
      hotbarSlots: emptySlots().map(() => stone(64)),
      mainSlots: emptyBackpack().map(() => stone(64)),
      cursorSlot: stone(5),
    });
    useGameStore.getState().stowCursor();
    cur = useGameStore.getState();
    expect(cur.cursorSlot).toBeNull();
    expect(itemDrops.reduce((n, d) => n + d.count, 0)).toBe(5);
  });
});
