// 铁砧：修复材料映射、附魔合并规则（取高级/同级 +1 上限 5）、修复流程（耗材料 +25%）、配方

import { beforeEach, describe, expect, it } from 'vitest';
import { armorRepairMaterial, mergeEnchants, toolRepairMaterial } from '../anvil';
import { BLOCK_BY_KEY, BLOCKS } from '../blocks';
import { RECIPES } from '../recipes';
import { emptySlots, type Slot } from '../slots';
import { useGameStore } from '../store';

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

describe('修复材料映射（MC）', () => {
  it('工具按 tier：木→木板、石→圆石、铁→铁锭、钻→钻石、合金→合金锭；弓/钓竿→线，剪刀→铁锭', () => {
    expect(toolRepairMaterial('wooden_pickaxe')).toBe(`block:${K('planks')}`);
    expect(toolRepairMaterial('stone_axe')).toBe(`block:${K('cobble')}`);
    expect(toolRepairMaterial('iron_sword')).toBe('material:iron_ingot');
    expect(toolRepairMaterial('diamond_shovel')).toBe('material:diamond');
    expect(toolRepairMaterial('netherite_pickaxe')).toBe('material:netherite_ingot');
    expect(toolRepairMaterial('bow')).toBe('material:string');
    expect(toolRepairMaterial('fishing_rod')).toBe('material:string');
    expect(toolRepairMaterial('shears')).toBe('material:iron_ingot');
  });

  it('装备按材质：皮革→皮革、金/铁/钻/合金→对应锭、鞘翅→皮革（幻翼膜简化替代）', () => {
    expect(armorRepairMaterial('leather')).toBe('material:leather');
    expect(armorRepairMaterial('gold')).toBe('material:gold_ingot');
    expect(armorRepairMaterial('iron')).toBe('material:iron_ingot');
    expect(armorRepairMaterial('diamond')).toBe('material:diamond');
    expect(armorRepairMaterial('netherite')).toBe('material:netherite_ingot');
    expect(armorRepairMaterial('elytra')).toBe('material:leather');
    expect(armorRepairMaterial(undefined)).toBe('material:leather'); // 旧档缺省
  });
});

describe('附魔合并（MC 铁砧规则）', () => {
  it('取更高级；同级 +1（上限 5）；A 无附魔直接继承', () => {
    expect(mergeEnchants({ sharpness: 2 }, { sharpness: 4 })).toEqual({ sharpness: 4 });
    expect(mergeEnchants({ sharpness: 3 }, { sharpness: 3 })).toEqual({ sharpness: 4 });
    expect(mergeEnchants({ sharpness: 5 }, { sharpness: 5 })).toEqual({ sharpness: 5 }); // 上限
    expect(mergeEnchants(undefined, { efficiency: 2 })).toEqual({ efficiency: 2 });
    expect(mergeEnchants({ sharpness: 2 }, { efficiency: 3 })).toEqual({ sharpness: 2, efficiency: 3 }); // 不同条并存
  });
});

describe('铁砧使用', () => {
  it('修复：手持半耐久钻剑 + 背包钻石 → 耗 1 钻石补 25%（MC）', () => {
    const slots = emptySlots();
    slots[0] = { kind: 'tool', tool: 'diamond_sword', durability: 100 };
    slots[3] = { kind: 'material', material: 'diamond', count: 2 };
    useGameStore.setState({ hotbarSlots: slots, selectedSlot: 0 });
    const r = useGameStore.getState().anvilUse();
    expect(r.ok).toBe(true);
    const st = useGameStore.getState();
    expect(st.hotbarSlots[0]).toEqual({ kind: 'tool', tool: 'diamond_sword', durability: 100 + Math.ceil(1561 * 0.25) });
    expect(st.hotbarSlots[3]).toEqual({ kind: 'material', material: 'diamond', count: 1 });
  });

  it('修复：手持半耐久木镐 + 木板（方块）→ 耗 1 木板补 25%（物品键 block:<数字id> 对齐，曾用字符串 key 永不匹配）', () => {
    const slots = emptySlots();
    slots[0] = { kind: 'tool', tool: 'wooden_pickaxe', durability: 10 };
    slots[1] = { kind: 'block', id: K('planks'), count: 3 };
    useGameStore.setState({ hotbarSlots: slots, selectedSlot: 0 });
    const r = useGameStore.getState().anvilUse();
    expect(r.ok).toBe(true);
    const st = useGameStore.getState();
    expect(st.hotbarSlots[0]).toEqual({ kind: 'tool', tool: 'wooden_pickaxe', durability: 10 + Math.ceil(59 * 0.25) });
    expect(st.hotbarSlots[1]).toEqual({ kind: 'block', id: K('planks'), count: 2 });
  });

  it('满耐久拒绝；缺材料拒绝并提示材料名', () => {
    const slots = emptySlots();
    slots[0] = { kind: 'tool', tool: 'iron_pickaxe', durability: 250 };
    useGameStore.setState({ hotbarSlots: slots, selectedSlot: 0 });
    expect(useGameStore.getState().anvilUse().ok).toBe(false);
    // 缺材料
    slots[0] = { kind: 'tool', tool: 'iron_pickaxe', durability: 100 };
    useGameStore.setState({ hotbarSlots: slots, selectedSlot: 0 });
    const r = useGameStore.getState().anvilUse();
    expect(r.ok).toBe(false);
    expect(r.notice).toContain('铁锭');
  });

  it('附魔合并：手持钻剑 A + 物品栏同型带附魔 B → A 吸收附魔（同级 +1）+ B 消失 + 耐久 +12%', () => {
    const slots = emptySlots();
    slots[0] = { kind: 'tool', tool: 'diamond_sword', durability: 500, ench: { sharpness: 2 } };
    slots[5] = { kind: 'tool', tool: 'diamond_sword', durability: 300, ench: { sharpness: 2, looting: 1 } };
    useGameStore.setState({ hotbarSlots: slots, selectedSlot: 0 });
    const r = useGameStore.getState().anvilUse();
    expect(r.ok).toBe(true);
    const st = useGameStore.getState();
    expect(st.hotbarSlots[0]).toEqual({
      kind: 'tool',
      tool: 'diamond_sword',
      durability: 500 + Math.ceil(1561 * 0.12),
      ench: { sharpness: 3, looting: 1 },
    });
    expect(st.hotbarSlots[5]).toBeNull();
  });

  it('铁砧方块与配方：3 铁块 + 4 铁锭（MC），高硬度', () => {
    expect(BLOCKS[K('anvil')].digTime).toBe(35);
    const r = RECIPES.find((r) => r.id === 'anvil');
    expect(r).toBeDefined();
    const cost = new Map(r!.cost.map((c) => [c.item, c.count]));
    expect(cost.get(`block:${K('iron_block')}`)).toBe(3);
    expect(cost.get('material:iron_ingot')).toBe(4);
  });
});
