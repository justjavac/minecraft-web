// 下界合金：远古残骸（方块定义/下界矿脉）、碎片烧炼、合金锭配方、锻造台升级（保留附魔/耐久）

import { beforeEach, describe, expect, it } from 'vitest';
import { BLOCK_BY_KEY, BLOCKS } from '../blocks';
import { SMELTING } from '../furnace';
import { createNetherTerrain } from '../nether';
import { RECIPES } from '../recipes';
import { netheriteUpgradeOf, NETHERITE_UPGRADE } from '../smithing';
import { emptySlots, type Slot } from '../slots';
import { useGameStore } from '../store';
import { TOOLS, type ToolType } from '../tools';
import { localIndex, World } from '../world';

const K = (k: string) => BLOCK_BY_KEY[k].id;

beforeEach(() => {
  useGameStore.setState({
    worldMode: 'survival',
    hotbarSlots: emptySlots(),
    mainSlots: Array.from({ length: 27 }, () => null) as Slot[],
    selectedSlot: 0,
    notice: null,
  });
});

describe('远古残骸', () => {
  it('方块：需钻镐（pickTier 3 = 防爆）、高硬度（MC）', () => {
    const def = BLOCKS[K('ancient_debris')];
    expect(def.tool).toBe('pickaxe');
    expect(def.pickTier).toBe(3); // 钻镐以上，且防爆（explosion.ts 规则）
    expect(def.digTime).toBe(150); // MC 硬度 30 × 5（钻镐 150×0.3/8 = 5.6s，与 MC 一致）
  });

  it('下界矿脉：y8-22 存在远古残骸（埋于下界岩）', () => {
    const w = new World('netherite-test', undefined, createNetherTerrain('netherite-test'));
    let found = 0;
    const ys = new Set<number>();
    for (let cx = 0; cx < 6; cx++) {
      for (let cz = 0; cz < 6; cz++) {
        const chunk = w.getChunk(cx, cz);
        for (let x = 0; x < 16; x++) {
          for (let z = 0; z < 16; z++) {
            for (let y = 0; y < 40; y++) {
              if (chunk.data[localIndex(x, y, z)] === K('ancient_debris')) {
                found++;
                ys.add(y);
              }
            }
          }
        }
      }
    }
    expect(found).toBeGreaterThan(0);
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(8);
      expect(y).toBeLessThanOrEqual(22);
    }
  });

  it('烧炼：远古残骸 → 下界合金碎片（MC）', () => {
    const smelt = SMELTING[`block:${K('ancient_debris')}`];
    expect(smelt).toBeDefined();
    expect(smelt.out).toBe('material:netherite_scrap');
  });
});

describe('下界合金锭与工具', () => {
  it('配方：4 碎片 + 4 金锭（MC 无序）', () => {
    const r = RECIPES.find((r) => r.id === 'netherite_ingot');
    expect(r).toBeDefined();
    const cost = new Map(r!.cost.map((c) => [c.item, c.count]));
    expect(cost.get('material:netherite_scrap')).toBe(4);
    expect(cost.get('material:gold_ingot')).toBe(4);
  });

  it('五件下界合金工具：速度 9x、耐久 2031、剑 8 伤（MC 数值）', () => {
    for (const t of ['netherite_pickaxe', 'netherite_axe', 'netherite_shovel', 'netherite_sword', 'netherite_hoe'] as ToolType[]) {
      expect(TOOLS[t].tier).toBe('netherite');
      expect(TOOLS[t].durability).toBe(2031);
    }
    expect(TOOLS.netherite_pickaxe.speed).toBe(9);
    expect(TOOLS.netherite_sword.attackDamage).toBe(8);
    // 钻锄已补齐（升级链必需，MC 存在）
    expect(TOOLS.diamond_hoe.durability).toBe(1561);
    expect(RECIPES.find((r) => r.id === 'diamond_hoe')).toBeDefined();
  });

  it('升级映射：五件钻石工具 → 下界合金；其他工具不可升级', () => {
    expect(NETHERITE_UPGRADE.size).toBe(5);
    expect(netheriteUpgradeOf('diamond_sword')).toBe('netherite_sword');
    expect(netheriteUpgradeOf('diamond_hoe')).toBe('netherite_hoe');
    expect(netheriteUpgradeOf('iron_sword')).toBeNull();
    expect(netheriteUpgradeOf('bow')).toBeNull();
  });
});

describe('锻造台升级', () => {
  it('手持合金锭 + 钻剑（半耐久带附魔）→ 下界合金剑，附魔耐久保留，锭 -1', () => {
    const s = useGameStore.getState();
    const slots = emptySlots();
    slots[0] = { kind: 'material', material: 'netherite_ingot', count: 2 };
    slots[1] = { kind: 'tool', tool: 'diamond_sword', durability: 700, ench: { sharpness: 3 } };
    useGameStore.setState({ hotbarSlots: slots, selectedSlot: 0 });
    expect(s.smithingUpgrade()).toBe(true);
    const st = useGameStore.getState();
    expect(st.hotbarSlots[0]).toEqual({ kind: 'material', material: 'netherite_ingot', count: 1 });
    expect(st.hotbarSlots[1]).toEqual({ kind: 'tool', tool: 'netherite_sword', durability: 700, ench: { sharpness: 3 } });
  });

  it('钻石工具在背包也能升级（热键栏优先）；无可升级工具或缺锭则失败', () => {
    const s = useGameStore.getState();
    const slots = emptySlots();
    slots[0] = { kind: 'material', material: 'netherite_ingot', count: 1 };
    const main = Array.from({ length: 27 }, () => null) as Slot[];
    main[5] = { kind: 'tool', tool: 'diamond_pickaxe', durability: 1000 };
    useGameStore.setState({ hotbarSlots: slots, mainSlots: main, selectedSlot: 0 });
    expect(s.smithingUpgrade()).toBe(true);
    const st = useGameStore.getState();
    expect(st.hotbarSlots[0]).toBeNull(); // 锭耗尽
    expect(st.mainSlots[5]).toEqual({ kind: 'tool', tool: 'netherite_pickaxe', durability: 1000 });
    // 无锭：失败
    expect(useGameStore.getState().smithingUpgrade()).toBe(false);
    // 有锭无钻工具：失败
    useGameStore.setState({ hotbarSlots: [{ kind: 'material', material: 'netherite_ingot', count: 1 }, ...emptySlots().slice(1)] });
    expect(useGameStore.getState().smithingUpgrade()).toBe(false);
  });

  it('钻石甲也可锻造升级为下界合金甲（保留附魔/耐久，MC）', () => {
    const s = useGameStore.getState();
    const slots = emptySlots();
    slots[0] = { kind: 'material', material: 'netherite_ingot', count: 2 };
    slots[2] = { kind: 'armor', piece: 'chestplate', material: 'diamond', durability: 300, ench: { protection: 2 } };
    useGameStore.setState({ hotbarSlots: slots, selectedSlot: 0 });
    expect(s.smithingUpgrade()).toBe(true);
    const st = useGameStore.getState();
    expect(st.hotbarSlots[2]).toEqual({ kind: 'armor', piece: 'chestplate', material: 'netherite', durability: 300, ench: { protection: 2 } });
    expect(st.hotbarSlots[0]).toEqual({ kind: 'material', material: 'netherite_ingot', count: 1 });
  });
});
