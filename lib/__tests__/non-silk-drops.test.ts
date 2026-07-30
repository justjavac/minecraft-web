// 非常规掉落（MC）：玻璃/冰非精准无掉落；书架→3 书、黏土→4 黏土球、西瓜→3-7 片、雪块→4 雪球、海晶灯→2-3 海晶砂粒；
// 精准采集（silk_touch）时这些方块一律掉自身

import { beforeEach, describe, expect, it } from 'vitest';
import { breakBlock } from '../actions';
import { BLOCK_BY_KEY } from '../blocks';
import { clearDrops, itemDrops } from '../items';
import { VOID_TERRAIN } from '../noise';
import { emptySlots } from '../slots';
import { useGameStore } from '../store';
import { World } from '../world';

function worldWith(id: number): World {
  const w = new World('non-silk-drop', undefined, VOID_TERRAIN);
  w.setBlock(4, 4, 4, id);
  return w;
}

/** 徒手（无精准） */
function holdNothing(): void {
  useGameStore.getState().loadSurvival({ health: 20, hunger: 20, slots: emptySlots() });
}

/** 带精准采集附魔的工具 */
function holdSilk(): void {
  const slots = emptySlots();
  slots[0] = { kind: 'tool', tool: 'iron_shovel', durability: 250, ench: { silk_touch: 1 } };
  useGameStore.getState().loadSurvival({ health: 20, hunger: 20, slots });
}

const matDrops = () => itemDrops.filter((d) => d.drop.kind === 'material').map((d) => `${(d.drop as { material: string }).material}x${d.count}`);
const blockDrops = () => itemDrops.filter((d) => d.drop.kind === 'block').map((d) => (d.drop as { blockId: number }).blockId);

beforeEach(() => {
  clearDrops();
  useGameStore.setState({ worldMode: 'survival' });
  holdNothing();
});

describe('非精准采集掉落规则（MC）', () => {
  it('玻璃/染色玻璃/冰/浮冰/蓝冰：非精准无掉落', () => {
    for (const k of ['glass', 'white_stained_glass', 'ice', 'packed_ice', 'blue_ice'] as const) {
      clearDrops();
      breakBlock(worldWith(BLOCK_BY_KEY[k].id), 4, 4, 4);
      expect(itemDrops.length, k).toBe(0);
    }
  });

  it('玻璃：精准采集掉玻璃方块自身', () => {
    holdSilk();
    breakBlock(worldWith(BLOCK_BY_KEY.glass.id), 4, 4, 4);
    expect(blockDrops()).toEqual([BLOCK_BY_KEY.glass.id]);
  });

  it('书架：非精准掉 3 本书；精准掉书架方块', () => {
    breakBlock(worldWith(BLOCK_BY_KEY.bookshelf.id), 4, 4, 4);
    expect(matDrops()).toEqual(['bookx3']);
    clearDrops();
    holdSilk();
    breakBlock(worldWith(BLOCK_BY_KEY.bookshelf.id), 4, 4, 4);
    expect(blockDrops()).toEqual([BLOCK_BY_KEY.bookshelf.id]);
  });

  it('黏土块：非精准掉 4 黏土球', () => {
    breakBlock(worldWith(BLOCK_BY_KEY.clay.id), 4, 4, 4);
    expect(matDrops()).toEqual(['clay_ballx4']);
  });

  it('西瓜：非精准掉 3-7 西瓜片', () => {
    breakBlock(worldWith(BLOCK_BY_KEY.melon.id), 4, 4, 4);
    expect(matDrops().length).toBe(1);
    const count = itemDrops[0].count;
    expect(count).toBeGreaterThanOrEqual(3);
    expect(count).toBeLessThanOrEqual(7);
  });

  it('雪块掉 4 雪球、雪层掉 1 雪球', () => {
    breakBlock(worldWith(BLOCK_BY_KEY.snow_block.id), 4, 4, 4);
    expect(matDrops()).toEqual(['snowballx4']);
    clearDrops();
    breakBlock(worldWith(BLOCK_BY_KEY.snow_layer.id), 4, 4, 4);
    expect(matDrops()).toEqual(['snowballx1']);
  });

  it('海晶灯：非精准掉 2-3 海晶砂粒', () => {
    breakBlock(worldWith(BLOCK_BY_KEY.sea_lantern.id), 4, 4, 4);
    expect(matDrops().length).toBe(1);
    const count = itemDrops[0].count;
    expect(count).toBeGreaterThanOrEqual(2);
    expect(count).toBeLessThanOrEqual(3);
  });
});
