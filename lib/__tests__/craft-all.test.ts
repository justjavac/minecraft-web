// shift 连取（MC Java）：store.craftAll 连续合成直到材料耗尽或背包满，单次 action 完成

import { beforeEach, describe, expect, it } from 'vitest';
import { BLOCK_BY_KEY, PLANKS } from '../blocks';
import { RECIPES } from '../recipes';
import { useGameStore } from '../store';
import { emptyBackpack, emptySlots, type Slot } from '../slots';

const blk = (key: string, count: number): Slot => ({ kind: 'block', id: BLOCK_BY_KEY[key].id, count });
const mat = (material: string, count: number): Slot => ({ kind: 'material', material, count });

const sticks = RECIPES.find((r) => r.id === 'stick')!; // 2 木板 → 4 木棍
const pickaxe = RECIPES.find((r) => r.id === 'wooden_pickaxe')!; // 3 木板 + 2 木棍 → 木镐

const allSlots = (): Slot[] => [...useGameStore.getState().hotbarSlots, ...useGameStore.getState().mainSlots];
const planksLeft = (): number => allSlots().reduce((n, s) => n + (s?.kind === 'block' && s.id === PLANKS ? s.count : 0), 0);
const sticksLeft = (): number => allSlots().reduce((n, s) => n + (s?.kind === 'material' && s.material === 'stick' ? s.count : 0), 0);

beforeEach(() => {
  useGameStore.getState().loadSurvival({ health: 20, hunger: 20, slots: emptySlots(), backpack: emptyBackpack() });
  useGameStore.setState({ worldMode: 'survival' });
});

describe('shift 连取（craftAll）', () => {
  it('材料足够：一次调用连取到材料耗尽，数量正确', () => {
    useGameStore.getState().loadSurvival({ health: 20, hunger: 20, slots: [{ kind: 'block', id: PLANKS, count: 8 }, ...emptySlots().slice(1)], backpack: emptyBackpack() });
    const n = useGameStore.getState().craftAll(sticks);
    expect(n).toBe(4); // 8 木板 / 2 = 4 次
    expect(planksLeft()).toBe(0);
    expect(sticksLeft()).toBe(16); // 4 × 4 木棍
  });

  it('材料不足一次时停止（余料保留）', () => {
    useGameStore.getState().loadSurvival({ health: 20, hunger: 20, slots: [{ kind: 'block', id: PLANKS, count: 3 }, ...emptySlots().slice(1)], backpack: emptyBackpack() });
    const n = useGameStore.getState().craftAll(sticks);
    expect(n).toBe(1); // 3 木板只够 1 次
    expect(planksLeft()).toBe(1); // 余 1 木板
    expect(sticksLeft()).toBe(4);
  });

  it('背包满：无空槽放产物时停止（工具类，材料尚有剩余）', () => {
    // 热键栏 2 格材料 + 7 空槽；背包 27 格全满圆石 → 最多产出 7 把木镐
    useGameStore.getState().loadSurvival({
      health: 20,
      hunger: 20,
      slots: [{ kind: 'block', id: PLANKS, count: 30 }, mat('stick', 20), ...emptySlots().slice(2)],
      backpack: emptyBackpack().map(() => blk('cobble', 64)),
    });
    const n = useGameStore.getState().craftAll(pickaxe);
    expect(n).toBe(7); // 空槽耗尽即止，而非材料耗尽（材料够 10 次）
    expect(planksLeft()).toBe(30 - 7 * 3);
    expect(sticksLeft()).toBe(20 - 7 * 2);
    const tools = allSlots().filter((s) => s?.kind === 'tool' && s.tool === 'wooden_pickaxe');
    expect(tools).toHaveLength(7);
    expect(useGameStore.getState().craftAll(pickaxe)).toBe(0); // 满后再取为 0
  });

  it('单次 craft 行为不变（连取不干扰普通点击）', () => {
    useGameStore.getState().loadSurvival({ health: 20, hunger: 20, slots: [{ kind: 'block', id: PLANKS, count: 8 }, ...emptySlots().slice(1)], backpack: emptyBackpack() });
    expect(useGameStore.getState().craft(sticks)).toBe(true);
    expect(sticksLeft()).toBe(4);
    expect(planksLeft()).toBe(6);
  });
});
