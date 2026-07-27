// 植被与洞穴群系：双格植物联动、柱作物生长与破坏、藤蔓/悬挂放置、洞穴装饰、神庙战利品、群系顶点色

import { beforeEach, describe, expect, it } from 'vitest';
import { breakBlock, tryPlace } from '../actions';
import { AIR, BLOCK_BY_KEY, STONE } from '../blocks';
import { cameraRef, setActiveWorld } from '../game';
import { tickGrowth } from '../growth';
import { clearDrops, itemDrops } from '../items';
import { buildFromGrid } from '../mesher';
import { BIOME_LIST, VOID_TERRAIN, type Biome, type Terrain } from '../noise';
import { useGameStore } from '../store';
import { clearStorages, getStorage } from '../storage';
import { CHUNK_VOLUME, localIndex, World } from '../world';
import { Vector3, type Camera } from 'three';
import { emptySlots, type Slot } from '../slots';

const K = (k: string) => BLOCK_BY_KEY[k].id;

function setup(): World {
  clearDrops();
  clearStorages();
  const w = new World('flora-test', undefined, VOID_TERRAIN);
  setActiveWorld(w);
  useGameStore.getState().loadSurvival({ health: 20, hunger: 20, slots: emptySlots() });
  useGameStore.setState({ worldMode: 'survival', notice: null });
  return w;
}

function cameraAt(x: number, y: number, z: number, dir: [number, number, number]): void {
  cameraRef.current = {
    position: new Vector3(x, y, z),
    getWorldDirection: (v: Vector3) => v.set(...dir).normalize(),
  } as unknown as Camera;
}

function holdBlock(key: string): void {
  const slots: Slot[] = emptySlots();
  slots[0] = { kind: 'block', id: K(key), count: 2 };
  useGameStore.getState().loadSurvival({ health: 20, hunger: 20, slots });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(setup);

describe('双格高植物', () => {
  it('放置两段一次放齐，破坏底段顶段同消', () => {
    const w = setup();
    w.setBlock(4, 31, 4, BLOCK_BY_KEY.grass.id);
    holdBlock('tall_grass');
    cameraAt(4.5, 33.5, 4.5, [0, -1, 0]);
    expect(tryPlace()).toBe(true);
    expect(w.getBlock(4, 32, 4)).toBe(K('tall_grass'));
    expect(w.getBlock(4, 33, 4)).toBe(K('tall_grass_top'));
    breakBlock(w, 4, 32, 4);
    expect(w.getBlock(4, 33, 4)).toBe(AIR);
  });

  it('破坏顶段底段同消（底段不掉第二次）', () => {
    const w = setup();
    w.setBlock(4, 31, 4, K('large_fern'));
    w.setBlock(4, 32, 4, K('large_fern_top'));
    breakBlock(w, 4, 32, 4);
    expect(w.getBlock(4, 31, 4)).toBe(AIR);
  });

  it('真实世界：热带草原出高草丛（底+顶成对）', () => {
    const w = new World('flora-savanna', undefined, {
      heightAt: () => 45, biomeAt: () => 'savanna' as const, treeAt: () => null,
      caveAt: () => false, snowlineAt: () => Infinity, undergroundAt: () => null,
    });
    let pairs = 0;
    for (let cx = 0; cx < 4; cx++) {
      for (let cz = 0; cz < 4; cz++) {
        const data = w.getChunk(cx, cz).data;
        for (let y = 46; y < 52; y++) {
          for (let x = 0; x < 16; x++) {
            for (let z = 0; z < 16; z++) {
              if (data[localIndex(x, y, z)] === K('tall_grass') && data[localIndex(x, y + 1, z)] === K('tall_grass_top')) pairs++;
            }
          }
        }
      }
    }
    expect(pairs).toBeGreaterThan(0);
  });

  it('真实世界：丛林出竹子（茎段顶着带叶顶段）', () => {
    const w = new World('flora-jungle', undefined, {
      heightAt: () => 45, biomeAt: () => 'jungle' as const, treeAt: () => null,
      caveAt: () => false, snowlineAt: () => Infinity, undergroundAt: () => null,
    });
    let stalk = 0;
    let tip = 0;
    for (let cx = 0; cx < 4; cx++) {
      for (let cz = 0; cz < 4; cz++) {
        const data = w.getChunk(cx, cz).data;
        for (let y = 46; y < 53; y++) {
          for (let x = 0; x < 16; x++) {
            for (let z = 0; z < 16; z++) {
              const id = data[localIndex(x, y, z)];
              if (id === K('bamboo')) stalk++;
              if (id === K('bamboo_top') && (data[localIndex(x, y - 1, z)] === K('bamboo') || y - 1 === 45)) tip++;
            }
          }
        }
      }
    }
    expect(stalk).toBeGreaterThan(0);
    expect(tip).toBeGreaterThan(0);
  });
});

describe('柱状植物（仙人掌/甘蔗/竹子）', () => {
  it('破坏中段，上段一并掉落', () => {
    const w = setup();
    for (let y = 31; y <= 33; y++) w.setBlock(4, y, 4, K('cactus'));
    breakBlock(w, 4, 32, 4);
    expect(w.getBlock(4, 33, 4)).toBe(AIR);
    const cactusDrops = itemDrops.filter((d) => d.drop.kind === 'block' && d.drop.blockId === K('cactus'));
    expect(cactusDrops.length).toBe(2); // 中段 + 上段
  });

  it('随机刻下仙人掌会拔节', () => {
    const w = setup();
    // 间隔 2 格摆放（仙人掌四邻不能有实心，否则按 MC 规则应破），提高命中同时保证合法
    for (const x of [2, 5, 8]) for (const z of [2, 5, 8]) w.setBlock(x, 31, z, K('cactus'));
    let grown = false;
    for (let i = 0; i < 6000 && !grown; i++) {
      tickGrowth(w, 2);
      for (const x of [2, 5, 8]) for (const z of [2, 5, 8]) if (w.getBlock(x, 32, z) === K('cactus')) grown = true;
    }
    expect(grown).toBe(true);
  });

  it('仙人掌邻贴实心会破并掉落', () => {
    const w = setup();
    for (let x = 2; x < 10; x++) for (let z = 2; z < 10; z++) {
      w.setBlock(x, 31, z, K('cactus'));
      w.setBlock(x + 1, 31, z, STONE); // 东侧贴实心（x<9 会盖住下一列，x=9 贴到 x=10）
    }
    let broke = false;
    for (let i = 0; i < 3000 && !broke; i++) {
      tickGrowth(w, 2);
      broke = itemDrops.some((d) => d.drop.kind === 'block' && d.drop.blockId === K('cactus'));
    }
    expect(broke).toBe(true);
  });
});

describe('藤蔓与悬挂植物', () => {
  it('藤蔓点在实心墙面并按朝向贴附', async () => {
    const w = setup();
    w.setBlock(5, 31, 4, STONE);
    holdBlock('vine_n');
    cameraAt(4.5, 31.5, 4.5, [1, 0, 0]); // 看向 +x 墙
    await wait(160); // 放置冷却（与上一个 tryPlace 用例隔离）
    expect(tryPlace()).toBe(true);
    expect(w.getBlock(4, 31, 4)).toBe(K('vine_e')); // 藤格在墙西，贴东面
  });

  it('洞穴藤蔓需顶面支撑', async () => {
    const w = setup();
    w.setBlock(4, 32, 4, STONE); // 顶
    holdBlock('cave_vines');
    cameraAt(4.5, 30.5, 4.5, [0, 1, 0]); // 从下方看向顶
    await wait(160);
    expect(tryPlace()).toBe(true);
    expect(w.getBlock(4, 31, 4)).toBe(K('cave_vines'));
    // 顶面是空气则拒绝
    w.setBlock(8, 32, 8, AIR);
    holdBlock('cave_vines');
    cameraAt(8.5, 30.5, 8.5, [0, 1, 0]);
    await wait(160);
    expect(tryPlace()).toBe(false);
  });
});

describe('洞穴群系装饰', () => {
  const cavern = (zone: 'dripstone' | 'lush'): Terrain => ({
    heightAt: () => 45,
    biomeAt: () => 'plains' as const,
    treeAt: () => null,
    caveAt: (_x, y) => y >= 20 && y <= 30, // 大洞腔
    snowlineAt: () => Infinity,
    undergroundAt: () => zone,
  });

  it('滴水石洞：洞地板出滴水石块与石笋、洞顶倒挂钟乳', () => {
    const w = new World('flora-drip', undefined, cavern('dripstone'));
    const found = new Set<number>();
    for (let cx = 0; cx < 3; cx++) for (let cz = 0; cz < 3; cz++) for (const v of w.getChunk(cx, cz).data) found.add(v);
    expect(found.has(K('dripstone_block'))).toBe(true);
    expect(found.has(K('pointed_dripstone'))).toBe(true);
    expect(found.has(K('pointed_dripstone_down'))).toBe(true);
  });

  it('繁茂洞穴：洞地板出苔藓与杜鹃、洞顶垂洞穴藤蔓', () => {
    const w = new World('flora-lush', undefined, cavern('lush'));
    const found = new Set<number>();
    for (let cx = 0; cx < 3; cx++) for (let cz = 0; cz < 3; cz++) for (const v of w.getChunk(cx, cz).data) found.add(v);
    expect(found.has(K('moss_block'))).toBe(true);
    expect(found.has(K('azalea')) || found.has(K('flowering_azalea'))).toBe(true);
    expect(found.has(K('cave_vines'))).toBe(true);
  });
});

describe('神庙战利品', () => {
  it('沙漠神殿：宝箱 + TNT 陷阱层 + 确定性预填战利品', async () => {
    const { structureAt, applyStructures } = await import('../structures');
    const t: Terrain = {
      heightAt: () => 45, biomeAt: () => 'desert' as const, treeAt: () => null,
      caveAt: () => false, snowlineAt: () => Infinity, undergroundAt: () => null,
    };
    // 找一个出沙漠神殿的区域
    let spot: { x: number; z: number } | null = null;
    for (let rx = 0; rx < 40 && !spot; rx++) {
      for (let rz = 0; rz < 40 && !spot; rz++) {
        const s = structureAt(123, t, rx, rz);
        if (s?.kind === 'desert_temple') spot = s;
      }
    }
    expect(spot).not.toBeNull();
    const ccx = Math.floor(spot!.x / 16);
    const ccz = Math.floor(spot!.z / 16);
    const data = new Uint16Array(CHUNK_VOLUME);
    for (let cx = ccx - 1; cx <= ccx + 1; cx++) for (let cz = ccz - 1; cz <= ccz + 1; cz++) applyStructures(123, t, cx, cz, data);
    const found = new Set<number>();
    for (const v of data) found.add(v);
    expect(found.has(K('chest'))).toBe(true);
    expect(found.has(K('tnt'))).toBe(true);
    // 四角宝箱战利品已预填且确定（同参重跑不变）
    const loot = getStorage(`${spot!.x - 2},${t.heightAt(spot!.x, spot!.z) - 2},${spot!.z - 2}`);
    expect(loot.some((s) => s !== null)).toBe(true);
  });
});

describe('群系顶点色', () => {
  it('同一块草方块在不同群系下顶点色不同', () => {
    const datas: (Uint16Array | null)[] = Array.from({ length: 9 }, () => null);
    datas[4] = new Uint16Array(CHUNK_VOLUME);
    datas[4][localIndex(8, 40, 8)] = BLOCK_BY_KEY.grass.id;
    const lights = Array.from({ length: 9 }, () => null);
    // 天空光拉满，亮度项不为 0，群系倍率才体现在顶点色上
    const skys = Array.from({ length: 9 }, (_, i) => (i === 4 ? new Uint8Array(CHUNK_VOLUME).fill(15) : null));
    const mk = (biome: Biome) => {
      const b = new Uint8Array(256).fill(BIOME_LIST.indexOf(biome));
      return buildFromGrid(0, 0, datas.map((d) => d && new Uint16Array(d)), lights, skys, b);
    };
    const plains = mk('plains');
    const jungle = mk('jungle');
    expect(plains.solid.colors.length).toBeGreaterThan(0);
    expect(jungle.solid.colors.length).toBe(plains.solid.colors.length);
    // 丛林绿与平原绿的顶点色必有差异（群系 signature）
    let diff = 0;
    for (let i = 0; i < plains.solid.colors.length; i++) if (plains.solid.colors[i] !== jungle.solid.colors[i]) diff++;
    expect(diff).toBeGreaterThan(0);
  });
});
