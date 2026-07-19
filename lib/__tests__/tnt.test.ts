// TNT：引信计时爆炸 / 防爆规则 / 共享爆炸逻辑

import { describe, expect, it } from 'vitest';
import { AIR, BLOCK_BY_KEY, STONE } from '../blocks';
import { explodeAt } from '../explosion';
import { VOID_TERRAIN } from '../noise';
import { igniteTnt, primedTnt, tickTnt } from '../tnt';
import { World } from '../world';

const P = { x: 0, y: 0, z: 0 };

describe('TNT 与爆炸', () => {
  it('引信到 0 才爆炸，之前不炸', () => {
    const w = new World('tnt-fuse', undefined, VOID_TERRAIN);
    igniteTnt(4, 30, 4);
    tickTnt(w, 1, P, () => {});
    tickTnt(w, 2, P, () => {});
    expect(primedTnt.length).toBe(1);
    tickTnt(w, 1.1, P, () => {});
    expect(primedTnt.length).toBe(0);
  });

  it('爆炸破坏石头但不破坏黑曜石与基岩', () => {
    const w = new World('tnt-blast', undefined, VOID_TERRAIN);
    w.setBlock(4, 4, 4, STONE);
    w.setBlock(5, 4, 4, BLOCK_BY_KEY.obsidian.id);
    w.setBlock(6, 4, 4, BLOCK_BY_KEY.bedrock.id);
    explodeAt(w, 4.5, 4.5, 4.5, { x: 100, y: 100, z: 100 }, () => {}, { radius: 4, maxDamage: 32, hurtRadius: 7 });
    expect(w.getBlock(4, 4, 4)).toBe(AIR);
    expect(w.getBlock(5, 4, 4)).toBe(BLOCK_BY_KEY.obsidian.id);
    expect(w.getBlock(6, 4, 4)).toBe(BLOCK_BY_KEY.bedrock.id);
  });

  it('伤害随距离衰减，半径外无伤', () => {
    const w = new World('tnt-dmg', undefined, VOID_TERRAIN);
    let near = 0;
    explodeAt(w, 0, 10, 0, { x: 1.5, y: 10, z: 0 }, (d) => { near = d; }, { radius: 4, maxDamage: 32, hurtRadius: 7 });
    expect(near).toBeGreaterThan(15);
    let far = 0;
    explodeAt(w, 0, 10, 0, { x: 20, y: 10, z: 0 }, (d) => { far = d; }, { radius: 4, maxDamage: 32, hurtRadius: 7 });
    expect(far).toBe(0);
  });
});
