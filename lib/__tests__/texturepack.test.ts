// matchTiles：现代 MC 贴图包文件名 → atlas tile 索引的匹配逻辑

import { describe, expect, it } from 'vitest';
import { matchTiles } from '../texturepack';

const MODERN = (name: string) => `assets/minecraft/textures/block/${name}.png`;

describe('matchTiles', () => {
  it('匹配现代 MC 包结构（grass_block_top / oak_log 等命名）', () => {
    const m = matchTiles([
      MODERN('grass_block_top'),
      MODERN('grass_block_side'),
      MODERN('dirt'),
      MODERN('stone'),
      MODERN('cobblestone'),
      MODERN('sand'),
      MODERN('oak_log'),
      MODERN('oak_log_top'),
      MODERN('oak_planks'),
      MODERN('oak_leaves'),
      MODERN('glass'),
      MODERN('bricks'),
      MODERN('water_still'),
      MODERN('unrelated_texture'),
    ]);
    expect(m.size).toBe(13);
    expect(m.get(0)).toBe(MODERN('grass_block_top'));
    expect(m.get(1)).toBe(MODERN('grass_block_side'));
    expect(m.get(6)).toBe(MODERN('oak_log'));
    expect(m.get(11)).toBe(MODERN('bricks'));
    expect(m.get(12)).toBe(MODERN('water_still'));
  });

  it('平铺文件名（无目录）也能匹配，且 /textures/block/ 路径优先于其他同名路径', () => {
    const m = matchTiles([
      'random/other/dirt.png', // 低优先级路径
      MODERN('dirt'), // 高优先级路径
      'grass_block_top.png', // 平铺
    ]);
    expect(m.get(2)).toBe(MODERN('dirt'));
    expect(m.get(0)).toBe('grass_block_top.png');
  });

  it('大小写不敏感，缺块时只返回匹配到的 tile', () => {
    const m = matchTiles([MODERN('DIRT'), MODERN('Stone')]);
    expect(m.size).toBe(2);
    expect(m.get(2)).toBe(MODERN('DIRT'));
    expect(m.get(3)).toBe(MODERN('Stone'));
    expect(m.has(0)).toBe(false);
  });

  it('备选命名（cobble / tree_side / wood 等老式命名）', () => {
    const m = matchTiles(['pack/cobble.png', 'pack/tree_side.png', 'pack/wood.png']);
    expect(m.get(4)).toBe('pack/cobble.png');
    expect(m.get(6)).toBe('pack/tree_side.png');
    expect(m.get(8)).toBe('pack/wood.png');
  });
});
