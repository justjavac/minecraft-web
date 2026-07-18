// 矿石掉落线：镐层级门控 / 材料掉落 / 烧炼 / 工具与储物配方

import { beforeEach, describe, expect, it } from 'vitest';
import { breakBlock } from '../actions';
import { BLOCK_BY_KEY, STONE } from '../blocks';
import { SMELTING } from '../furnace';
import { clearDrops, itemDrops } from '../items';
import { VOID_TERRAIN } from '../noise';
import { applyCraft, canCraft, RECIPES } from '../recipes';
import { emptySlots, type Slot } from '../slots';
import { useGameStore } from '../store';
import { World } from '../world';

function worldWith(id: number, x = 4, y = 4, z = 4): World {
  const w = new World('ore-drop', undefined, VOID_TERRAIN);
  w.setBlock(x, y, z, id);
  return w;
}

function holdTool(tool: string | null): void {
  const slots: Slot[] = emptySlots();
  if (tool) slots[0] = { kind: 'tool', tool: tool as never, durability: 500 };
  useGameStore.getState().loadSurvival({ health: 20, hunger: 20, slots });
}

beforeEach(() => {
  clearDrops();
  useGameStore.getState().loadSurvival({ health: 20, hunger: 20, slots: emptySlots() });
  useGameStore.setState({ worldMode: 'survival' });
});

describe('矿石定义', () => {
  it('8 种矿石都有 pickTier 与材料掉落', () => {
    for (const k of ['coal_ore', 'iron_ore', 'copper_ore', 'gold_ore', 'redstone_ore', 'lapis_ore', 'diamond_ore', 'emerald_ore']) {
      const def = BLOCK_BY_KEY[k];
      expect(def.pickTier, k).not.toBeUndefined();
      expect(def.drop, k).toBeDefined();
      expect(def.drop!.count[0]).toBeGreaterThanOrEqual(1);
    }
    expect(BLOCK_BY_KEY.coal_ore.pickTier).toBe(0);
    expect(BLOCK_BY_KEY.iron_ore.pickTier).toBe(1);
    expect(BLOCK_BY_KEY.diamond_ore.pickTier).toBe(2);
    expect(BLOCK_BY_KEY.obsidian.pickTier).toBe(3);
  });
});

describe('镐层级门控掉落', () => {
  it('徒手挖石头无掉落（needsPick）', () => {
    holdTool(null);
    breakBlock(worldWith(STONE), 4, 4, 4);
    expect(itemDrops.length).toBe(0);
  });

  it('木镐挖煤矿掉煤（tier 0）', () => {
    holdTool('wooden_pickaxe');
    breakBlock(worldWith(BLOCK_BY_KEY.coal_ore.id), 4, 4, 4);
    expect(itemDrops.length).toBe(1);
    expect(itemDrops[0].drop).toEqual({ kind: 'material', material: 'coal' });
  });

  it('木镐挖钻石矿无掉落（需 tier 2）；铁镐则掉钻石', () => {
    holdTool('wooden_pickaxe');
    breakBlock(worldWith(BLOCK_BY_KEY.diamond_ore.id), 4, 4, 4);
    expect(itemDrops.length).toBe(0);

    holdTool('iron_pickaxe');
    breakBlock(worldWith(BLOCK_BY_KEY.diamond_ore.id), 4, 4, 4);
    expect(itemDrops.length).toBe(1);
    expect(itemDrops[0].drop).toEqual({ kind: 'material', material: 'diamond' });
  });

  it('石镐挖铁矿掉粗铁（tier 1），挖深层矿同效', () => {
    holdTool('stone_pickaxe');
    breakBlock(worldWith(BLOCK_BY_KEY.iron_ore.id), 4, 4, 4);
    expect(itemDrops[0]?.drop).toEqual({ kind: 'material', material: 'raw_iron' });
    clearDrops();
    breakBlock(worldWith(BLOCK_BY_KEY.deepslate_iron_ore.id), 4, 4, 4);
    expect(itemDrops[0]?.drop).toEqual({ kind: 'material', material: 'raw_iron' });
  });
});

describe('烧炼与配方', () => {
  it('粗矿可烧成锭，煤可作燃料', () => {
    expect(SMELTING['material:raw_iron'].out).toBe('material:iron_ingot');
    expect(SMELTING['material:raw_gold'].out).toBe('material:gold_ingot');
    expect(SMELTING['material:raw_copper'].out).toBe('material:copper_ingot');
  });

  it('铁镐配方：铁锭×3 + 木棍×2', () => {
    const r = RECIPES.find((x) => x.id === 'iron_pickaxe')!;
    const slots: Slot[] = emptySlots();
    slots[0] = { kind: 'material', material: 'iron_ingot', count: 3 };
    slots[1] = { kind: 'material', material: 'stick', count: 2 };
    expect(canCraft(slots, r)).toBe(true);
    const out = applyCraft(slots, r, 250);
    expect(out.find((s) => s?.kind === 'tool')).toEqual({ kind: 'tool', tool: 'iron_pickaxe', durability: 250 });
  });

  it('铁块 9 合 1 拆（储物配方）', () => {
    const pack = RECIPES.find((x) => x.id === 'iron_block')!;
    const slots: Slot[] = emptySlots();
    slots[0] = { kind: 'material', material: 'iron_ingot', count: 9 };
    expect(canCraft(slots, pack)).toBe(true);
    const made = applyCraft(slots, pack, 0);
    expect(made.find((s) => s?.kind === 'block')?.kind).toBe('block');

    const unpack = RECIPES.find((x) => x.id === 'iron_ingot_from_block')!;
    const out = applyCraft(made, unpack, 0);
    expect(out.find((s) => s?.kind === 'material')).toEqual({ kind: 'material', material: 'iron_ingot', count: 9 });
  });
});
