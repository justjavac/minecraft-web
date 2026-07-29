// 树叶掉落规则（MC）：剪刀掉树叶方块；徒手/其他工具 5% 掉树苗，其余不掉
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { breakBlock } from '../actions';
import { BLOCK_BY_KEY } from '../blocks';
import { setActiveWorld } from '../game';
import { clearDrops, itemDrops } from '../items';
import { VOID_TERRAIN } from '../noise';
import { useGameStore } from '../store';
import { emptySlots } from '../slots';
import { World } from '../world';

const LEAVES = () => BLOCK_BY_KEY.leaves.id;
const SAPLING = () => BLOCK_BY_KEY.oak_sapling.id;

function setup(): World {
  clearDrops();
  const w = new World('leaf-test', undefined, VOID_TERRAIN);
  setActiveWorld(w);
  useGameStore.getState().loadSurvival({ health: 20, hunger: 20, slots: emptySlots() });
  useGameStore.setState({ worldMode: 'survival' });
  return w;
}

describe('树叶掉落（MC）', () => {
  beforeEach(setup);

  it('剪刀：掉树叶方块', () => {
    const w = setup();
    w.setBlock(3, 40, 3, LEAVES());
    useGameStore.setState({
      hotbarSlots: [{ kind: 'tool', tool: 'shears', durability: 1 }, ...emptySlots().slice(1)],
      selectedSlot: 0,
    });
    breakBlock(w, 3, 40, 3);
    expect(itemDrops).toHaveLength(1);
    expect(itemDrops[0].drop).toEqual({ kind: 'block', blockId: LEAVES() });
  });

  it('徒手：5% 掉树苗，95% 不掉', () => {
    const w = setup();
    useGameStore.setState({ hotbarSlots: emptySlots(), selectedSlot: 0 });
    vi.spyOn(Math, 'random').mockReturnValue(0.04); // < 0.05 命中掉树苗
    w.setBlock(3, 40, 3, LEAVES());
    breakBlock(w, 3, 40, 3);
    expect(itemDrops).toHaveLength(1);
    expect(itemDrops[0].drop).toEqual({ kind: 'block', blockId: SAPLING() });

    clearDrops();
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // 不掉
    w.setBlock(5, 40, 5, LEAVES());
    breakBlock(w, 5, 40, 5);
    expect(itemDrops).toHaveLength(0);
    vi.restoreAllMocks();
  });
});
