// 附魔台书架规则（MC）：2 格环内书架计数 0-15；无书架最高 8 级档、满 15 书架 30 级档

import { describe, expect, it } from 'vitest';
import { BLOCK_BY_KEY } from '../blocks';
import { VOID_TERRAIN } from '../noise';
import { bookshelfPower, enchantLevelCap } from '../xp';
import { World } from '../world';

describe('附魔台书架功率', () => {
  it('无书架 0；2 格环内计数；内圈 3×3 不算；封顶 15', () => {
    const w = new World('bookshelf-power', undefined, VOID_TERRAIN);
    // 附魔台在 (0, 30, 0)
    expect(bookshelfPower(w, 0, 30, 0)).toBe(0);
    // 内圈放书架：不应计入
    w.setBlock(1, 30, 1, BLOCK_BY_KEY.bookshelf.id);
    w.setBlock(0, 31, 0, BLOCK_BY_KEY.bookshelf.id);
    expect(bookshelfPower(w, 0, 30, 0)).toBe(0);
    // 环上放 5 个
    w.setBlock(2, 30, 0, BLOCK_BY_KEY.bookshelf.id);
    w.setBlock(-2, 30, 0, BLOCK_BY_KEY.bookshelf.id);
    w.setBlock(0, 30, 2, BLOCK_BY_KEY.bookshelf.id);
    w.setBlock(2, 31, 2, BLOCK_BY_KEY.bookshelf.id);
    w.setBlock(-2, 32, -2, BLOCK_BY_KEY.bookshelf.id);
    expect(bookshelfPower(w, 0, 30, 0)).toBe(5);
    // 放满两圈 16 个：封顶 15
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++)
        if (Math.abs(dx) === 2 || Math.abs(dz) === 2) w.setBlock(dx, 30, dz, BLOCK_BY_KEY.bookshelf.id);
    expect(bookshelfPower(w, 0, 30, 0)).toBe(15);
  });

  it('功率 → 附魔等级上限：无书架 8、15 书架 30（MC）', () => {
    expect(enchantLevelCap(0)).toBe(8);
    expect(enchantLevelCap(3)).toBe(8); // 低功率仍保底 8
    expect(enchantLevelCap(10)).toBe(20);
    expect(enchantLevelCap(15)).toBe(30);
    expect(enchantLevelCap(99)).toBe(30);
  });
});
