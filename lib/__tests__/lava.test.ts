// 岩浆：定义属性 + 深层洞穴岩浆湖生成 + 流水 id 段回归 + 流动岩浆（MC Java 流动/反应/读档兼容）

import { beforeEach, describe, expect, it } from 'vitest';
import { AIR, BLOCKS, BLOCK_BY_KEY, COBBLE, isLavaId, isWaterId, LAVA, LAVA_FLOW_1, STONE, WATER, WATER_FLOW_1 } from '../blocks';
import { clearFluids, lavaLevel, tickFluids, waterLevel } from '../fluids';
import { VOID_TERRAIN } from '../noise';
import { CHUNK_VOLUME, World } from '../world';

describe('流水 id 段回归（14-20 连续，不与其他方块撞号）', () => {
  it('WATER_FLOW_1 起 7 级连续', () => {
    for (let lv = 1; lv <= 7; lv++) {
      expect(BLOCKS[WATER_FLOW_1 + lv - 1].key).toBe(`water_flow_${lv}`);
      expect(waterLevel(WATER_FLOW_1 + lv - 1)).toBe(lv);
    }
  });

  it('普通方块不被误判为水', () => {
    expect(waterLevel(BLOCK_BY_KEY.granite.id)).toBe(-1);
    expect(waterLevel(BLOCK_BY_KEY.polished_granite.id)).toBe(-1);
    expect(isWaterId(BLOCK_BY_KEY.crafting_table.id)).toBe(false);
    expect(isWaterId(BLOCK_BY_KEY.furnace.id)).toBe(false);
  });
});

describe('岩浆定义', () => {
  it('发光 15、非实心、不可选中、不参与水系', () => {
    const def = BLOCKS[LAVA];
    expect(def.key).toBe('lava');
    expect(def.light).toBe(15);
    expect(def.solid).toBe(false);
    expect(isLavaId(LAVA)).toBe(true);
    expect(isWaterId(LAVA)).toBe(false);
    expect(waterLevel(LAVA)).toBe(-1);
  });
});

describe('深层岩浆湖生成', () => {
  it('y≤10 的洞腔灌岩浆，以上保持空气', () => {
    // 人造地形：y 4-20 全雕空的大洞腔
    const cavern = {
      heightAt: () => 30,
      biomeAt: () => 'plains' as const,
      treeAt: () => null,
      caveAt: (_x: number, y: number) => y >= 4 && y <= 20,
      snowlineAt: () => Infinity,
      undergroundAt: () => null,
      aquiferAt: () => false,
    };
    const w = new World('lava-lake', undefined, cavern);
    expect(w.getBlock(8, 4, 8)).toBe(LAVA);
    expect(w.getBlock(8, 10, 8)).toBe(LAVA);
    expect(w.getBlock(8, 11, 8)).toBe(AIR);
    expect(w.getBlock(8, 20, 8)).toBe(AIR);
    // 洞底（y=3 未雕空）仍是实心
    expect(BLOCKS[w.getBlock(8, 3, 8)].solid).toBe(true);
  });

  it('真实地形深洞里能找到岩浆湖', () => {
    const w = new World('lava-real');
    let lava = 0;
    for (let x = 0; x < 64; x++) {
      for (let z = 0; z < 64; z++) {
        for (let y = 2; y <= 10; y++) {
          if (w.getBlock(x, y, z) === LAVA) lava++;
        }
      }
    }
    expect(lava).toBeGreaterThan(0);
  });
});

describe('流动岩浆（MC Java：维度距离/节奏/水火反应）', () => {
  // 流体队列与岩浆节奏累加器是模块全局的：测试间必须清空
  beforeEach(() => clearFluids());

  const NETHER_TERRAIN = { ...VOID_TERRAIN, kind: 'nether' as const };

  /** 铺一行石头地板（y=10），承接水平扩散 */
  function floor(w: World, x0: number, x1: number, z: number): void {
    for (let x = x0; x <= x1; x++) w.setBlock(x, 10, z, BLOCK_BY_KEY.stone.id);
  }

  it('lavaLevel 识别源/流动岩浆/非岩浆', () => {
    expect(lavaLevel(LAVA)).toBe(0);
    expect(lavaLevel(LAVA_FLOW_1)).toBe(1);
    expect(lavaLevel(LAVA_FLOW_1 + 6)).toBe(7);
    expect(lavaLevel(WATER)).toBe(-1);
    expect(lavaLevel(STONE)).toBe(-1);
  });

  it('流动岩浆定义：发光 15、非实心、按岩浆判定（isLavaId 涵盖伤害/着火/防爆）', () => {
    for (let lv = 1; lv <= 7; lv++) {
      const id = LAVA_FLOW_1 + lv - 1;
      expect(BLOCKS[id].key).toBe(`lava_flow_${lv}`);
      expect(BLOCKS[id].solid).toBe(false);
      expect(BLOCKS[id].light).toBe(15);
      expect(isLavaId(id)).toBe(true);
      expect(isWaterId(id)).toBe(false);
      expect(waterLevel(id)).toBe(-1);
    }
  });

  it('主世界：按 1.5s 节奏扩散（前 3 拍不动），水平至多 3 格', () => {
    const w = new World('lava-flow-ow', undefined, VOID_TERRAIN);
    floor(w, 0, 12, 6);
    w.setBlock(6, 11, 6, LAVA);
    for (let i = 0; i < 3; i++) tickFluids(w, 128); // 0.4×3=1.2s < 1.5s：未到岩浆节奏
    expect(w.getBlock(7, 11, 6)).toBe(AIR);
    tickFluids(w, 128); // 1.6s：第一步
    expect(lavaLevel(w.getBlock(7, 11, 6))).toBe(1);
    for (let i = 0; i < 30; i++) tickFluids(w, 256);
    expect(lavaLevel(w.getBlock(9, 11, 6))).toBe(3); // 3 格远（level 1-3）
    expect(w.getBlock(10, 11, 6)).toBe(AIR); // 第 4 格不扩散
    expect(w.getBlock(6, 11, 6)).toBe(LAVA); // 源不消失
  });

  it('下界：水平扩散 7 格', () => {
    // 下界 kind 会走下界 chunk 生成（岩浆海/岩层会干扰断言）：用空 saved chunk 跳过生成，kind 仍驱动下界节奏
    const saved = new Map([['0,0', new Uint16Array(CHUNK_VOLUME)]]);
    const w = new World('lava-flow-nether', saved, NETHER_TERRAIN);
    floor(w, 0, 15, 6);
    w.setBlock(6, 11, 6, LAVA);
    for (let i = 0; i < 40; i++) tickFluids(w, 512);
    expect(lavaLevel(w.getBlock(13, 11, 6))).toBe(7); // 7 格远（level 1-7）
    expect(w.getBlock(14, 11, 6)).toBe(AIR); // 第 8 格不扩散
  });

  it('向下流动与水相同：源下方成 1 级流，下落直达', () => {
    const w = new World('lava-fall', undefined, VOID_TERRAIN);
    w.setBlock(8, 30, 8, LAVA);
    for (let i = 0; i < 30; i++) tickFluids(w, 128);
    expect(w.getBlock(8, 29, 8)).toBe(LAVA_FLOW_1);
    expect(w.getBlock(8, 25, 8)).toBe(LAVA_FLOW_1);
  });

  it('侧向流入水的岩浆 → 圆石', () => {
    const w = new World('lava-cobble', undefined, VOID_TERRAIN);
    floor(w, 0, 12, 6);
    w.setBlock(0, 11, 6, WATER);
    for (let i = 0; i < 30; i++) tickFluids(w, 256); // 水先向东铺满（至多 7 级，x=1..7）
    expect(waterLevel(w.getBlock(7, 11, 6))).toBe(7);
    w.setBlock(10, 11, 6, LAVA); // 岩浆源，西侧 3 格外是水流末端
    for (let i = 0; i < 40; i++) tickFluids(w, 512);
    expect(w.getBlock(7, 11, 6)).toBe(COBBLE); // 岩浆西流进水 → 圆石（MC）
  });

  it('岩浆源上方是水（水从上方浇下）→ 石头', () => {
    const w = new World('lava-stone', undefined, VOID_TERRAIN);
    floor(w, 4, 8, 6);
    w.setBlock(6, 11, 6, LAVA);
    w.setBlock(6, 12, 6, WATER); // 源正上方放水
    for (let i = 0; i < 4; i++) tickFluids(w, 128);
    expect(w.getBlock(6, 11, 6)).toBe(STONE); // MC：水浇在岩浆源上成石头
  });

  it('岩浆源遇侧向水 → 黑曜石', () => {
    const w = new World('lava-obsidian', undefined, VOID_TERRAIN);
    floor(w, 4, 8, 6);
    w.setBlock(6, 11, 6, LAVA);
    w.setBlock(5, 11, 6, WATER); // 侧向贴邻放水
    for (let i = 0; i < 4; i++) tickFluids(w, 128);
    expect(w.getBlock(6, 11, 6)).toBe(BLOCK_BY_KEY.obsidian.id); // MC：源 + 侧向水 → 黑曜石
  });

  it('读档兼容：流动岩浆 id 追加在注册表末尾，chunk 数据往返不变', () => {
    // 追加位置回归：lava_flow_1..7 是注册表最后 7 项；既有 id 锚点不动（id 写入存档 Uint16Array）
    expect(LAVA_FLOW_1).toBe(BLOCKS.length - 7);
    expect(WATER_FLOW_1).toBe(14);
    expect(LAVA).toBe(21);
    const saved = new Map<string, Uint16Array>();
    const w1 = new World('lava-persist', saved, VOID_TERRAIN);
    w1.setBlock(8, 30, 8, LAVA_FLOW_1 + 2); // 3 级流动岩浆
    saved.set('0,0', new Uint16Array(w1.getChunk(0, 0).data));
    const w2 = new World('lava-persist', saved, VOID_TERRAIN);
    expect(w2.getBlock(8, 30, 8)).toBe(LAVA_FLOW_1 + 2);
  });
});
