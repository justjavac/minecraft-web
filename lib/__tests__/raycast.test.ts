import { describe, expect, it } from 'vitest';
import { STONE, WATER } from '../blocks';
import { VOID_TERRAIN } from '../noise';
import { raycastBlock } from '../raycast';
import { World } from '../world';

function voidWorld(): World {
  return new World('test', undefined, VOID_TERRAIN);
}

describe('raycastBlock', () => {
  it('命中方块并返回放置面法线', () => {
    const w = voidWorld();
    w.setBlock(0, 0, 0, STONE);
    const hit = raycastBlock(w, 0.5, 0.5, 5.5, 0, 0, -1, 6);
    expect(hit).not.toBeNull();
    expect(hit!.block).toEqual([0, 0, 0]);
    expect(hit!.face).toEqual([0, 0, 1]); // 从 +z 方向命中，放在 (0,0,1)
  });

  it('从上方命中，面法线朝上', () => {
    const w = voidWorld();
    w.setBlock(3, 3, 3, STONE);
    const hit = raycastBlock(w, 3.5, 8.5, 3.5, 0, -1, 0, 6);
    expect(hit!.block).toEqual([3, 3, 3]);
    expect(hit!.face).toEqual([0, 1, 0]);
  });

  it('超出距离返回 null', () => {
    const w = voidWorld();
    w.setBlock(0, 0, 0, STONE);
    expect(raycastBlock(w, 0.5, 0.5, 20.5, 0, 0, -1, 6)).toBeNull();
  });

  it('斜向射线命中', () => {
    const w = voidWorld();
    w.setBlock(5, 5, 5, STONE);
    const hit = raycastBlock(w, 0.5, 0.5, 0.5, 1, 1, 1, 20);
    expect(hit).not.toBeNull();
    expect(hit!.block).toEqual([5, 5, 5]);
  });

  it('水不可被选中', () => {
    const w = voidWorld();
    w.setBlock(0, 0, 0, WATER);
    expect(raycastBlock(w, 0.5, 0.5, 5.5, 0, 0, -1, 6)).toBeNull();
  });
});
