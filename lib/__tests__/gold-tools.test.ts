// 金工具：MC 数值（耐久 32 / 速度 12 全游戏最快 / 攻击同木 / 采掘层级同木）与合成配方

import { describe, expect, it } from 'vitest';
import { ATLAS_COLS, ATLAS_ROWS, ICON_TILE_COUNT, ICON_TILE_START } from '../blocks';
import { MATERIAL_INFO } from '../materials';
import { applyCraft, canCraft, RECIPES } from '../recipes';
import { addStackToSlots, emptySlots } from '../slots';
import { TOOLS } from '../tools';

const GOLDEN = ['golden_pickaxe', 'golden_axe', 'golden_shovel', 'golden_sword'] as const;

describe('金工具数值（MC）', () => {
  it('四件金工具都已注册，耐久均为 32', () => {
    for (const t of GOLDEN) {
      expect(TOOLS[t], t).toBeDefined();
      expect(TOOLS[t].durability, t).toBe(32);
    }
  });

  it('镐/斧/锹速度 12（全游戏最快），剑 1（同其他剑）', () => {
    expect(TOOLS.golden_pickaxe.speed).toBe(12);
    expect(TOOLS.golden_axe.speed).toBe(12);
    expect(TOOLS.golden_shovel.speed).toBe(12);
    expect(TOOLS.golden_sword.speed).toBe(1);
    for (const [t, def] of Object.entries(TOOLS)) {
      if (!(GOLDEN as readonly string[]).includes(t)) expect(def.speed, t).toBeLessThanOrEqual(12);
    }
  });

  it('攻击与木同级（剑 4、斧 7、镐/锹 2）', () => {
    expect(TOOLS.golden_sword.attackDamage).toBe(TOOLS.wooden_sword.attackDamage);
    expect(TOOLS.golden_axe.attackDamage).toBe(TOOLS.wooden_axe.attackDamage);
    expect(TOOLS.golden_pickaxe.attackDamage).toBe(TOOLS.wooden_pickaxe.attackDamage);
    expect(TOOLS.golden_shovel.attackDamage).toBe(TOOLS.wooden_shovel.attackDamage);
  });

  it('采掘层级等同木（tier 字段即采掘层级，驱动 pickTier 比较）', () => {
    for (const t of GOLDEN) expect(TOOLS[t].tier, t).toBe(TOOLS.wooden_pickaxe.tier);
    expect(TOOLS.wooden_pickaxe.tier).toBe('wood'); // tier 0
  });
});

describe('金工具配方（金锭 + 木棍，同铁钻模式）', () => {
  const costs: Record<(typeof GOLDEN)[number], number> = {
    golden_pickaxe: 3,
    golden_axe: 3,
    golden_shovel: 1,
    golden_sword: 2,
  };

  it('四件配方存在：金锭 + 2/1 木棍，需工作台', () => {
    for (const t of GOLDEN) {
      const r = RECIPES.find((x) => x.id === t);
      expect(r, t).toBeDefined();
      expect(r!.out).toEqual({ kind: 'tool', tool: t });
      expect(r!.needsTable).toBe(true);
      expect(r!.cost).toEqual([
        { item: 'material:gold_ingot', count: costs[t] },
        { item: 'material:stick', count: t === 'golden_sword' ? 1 : 2 },
      ]);
    }
  });

  it('金锭 ×3 + 木棍 ×2 → 金镐（耐久 32）', () => {
    let slots = emptySlots();
    slots = addStackToSlots(slots, { kind: 'material', material: 'gold_ingot' }, 3).slots;
    slots = addStackToSlots(slots, { kind: 'material', material: 'stick' }, 2).slots;
    const r = RECIPES.find((x) => x.id === 'golden_pickaxe')!;
    expect(canCraft(slots, r)).toBe(true);
    slots = applyCraft(slots, r, TOOLS.golden_pickaxe.durability);
    expect(slots.some((s) => s?.kind === 'tool' && s.tool === 'golden_pickaxe' && s.durability === 32)).toBe(true);
    expect(canCraft(slots, r)).toBe(false); // 材料已耗尽
  });
});

describe('新增物品 canvas 图标格', () => {
  it('鸡蛋/河豚/蜘蛛眼/金粒落在 ICON_TILE_START+19..22 且在图标格范围内', () => {
    expect(MATERIAL_INFO.egg.tile).toBe(ICON_TILE_START + 19);
    expect(MATERIAL_INFO.pufferfish.tile).toBe(ICON_TILE_START + 20);
    expect(MATERIAL_INFO.spider_eye.tile).toBe(ICON_TILE_START + 21);
    expect(MATERIAL_INFO.gold_nugget.tile).toBe(ICON_TILE_START + 22);
    for (const m of ['egg', 'pufferfish', 'spider_eye', 'gold_nugget']) {
      expect(MATERIAL_INFO[m].tile, m).toBeLessThan(ICON_TILE_START + ICON_TILE_COUNT);
    }
  });

  it('atlas 容量覆盖全部图标格（ATLAS_ROWS × ATLAS_COLS ≥ 末格 + 1）', () => {
    expect(ATLAS_ROWS * ATLAS_COLS).toBeGreaterThanOrEqual(ICON_TILE_START + ICON_TILE_COUNT);
  });
});
