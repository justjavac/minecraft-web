// 边界切片快照（worker 瘦身传输）的正确性测试：
// 核心思路——在邻居 chunk 的"1 格环以外"内部放陷阱方块/光照，若 mesher 有任何越界 1 格的访问，
// 切片重组路径（内部恒 0）与整块路径的输出就会不同；逐字节相等即证明访问不越界且切片无损。

import { describe, expect, it } from 'vitest';
import { GLASS, STONE, WATER } from '../blocks';
import { CHUNK_SIZE, CHUNK_VOLUME, WORLD_HEIGHT } from '../grid';
import { buildFromGrid, expandBorders, sliceBorders, type GeometryData } from '../mesher';

const idx = (x: number, y: number, z: number): number => (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;

interface Full9 {
  datas: Uint16Array[];
  lights: Uint8Array[];
  skys: Uint8Array[];
}

function makeFull9(): Full9 {
  return {
    datas: Array.from({ length: 9 }, () => new Uint16Array(CHUNK_VOLUME)),
    lights: Array.from({ length: 9 }, () => new Uint8Array(CHUNK_VOLUME)),
    skys: Array.from({ length: 9 }, () => new Uint8Array(CHUNK_VOLUME)),
  };
}

function expectGeometryEqual(a: GeometryData, b: GeometryData): void {
  expect(Buffer.from(a.positions.buffer).equals(Buffer.from(b.positions.buffer))).toBe(true);
  expect(Buffer.from(a.normals.buffer).equals(Buffer.from(b.normals.buffer))).toBe(true);
  expect(Buffer.from(a.uvs.buffer).equals(Buffer.from(b.uvs.buffer))).toBe(true);
  expect(Buffer.from(a.colors.buffer).equals(Buffer.from(b.colors.buffer))).toBe(true);
  expect(Buffer.from(a.indices.buffer).equals(Buffer.from(b.indices.buffer))).toBe(true);
}

describe('mesher 边界切片快照', () => {
  it('切片重组与 3×3 整块路径输出逐字节一致（邻居内部陷阱值不影响结果）', () => {
    const { datas, lights, skys } = makeFull9();
    // 中心 chunk（索引 4）：四周边界 + 角 + 内部各放一些方块（含透明/水，覆盖剔除/AO/水路径）
    const c = datas[4];
    c[idx(15, 10, 8)] = STONE; // +x 边界
    c[idx(0, 10, 8)] = STONE; // -x 边界
    c[idx(8, 10, 15)] = STONE; // +z 边界
    c[idx(8, 10, 0)] = GLASS; // -z 边界（同类透明剔除路径）
    c[idx(15, 10, 15)] = STONE; // 角（对角 AO 会探到角邻居）
    c[idx(7, 20, 7)] = WATER;
    c[idx(8, 20, 8)] = STONE;
    // 边邻居（+x 为索引 5）：邻中心列 x=0 的方块会被读到（面剔除/AO/光照）
    datas[5][idx(0, 10, 8)] = STONE; // 与中心 (15,10,8) 贴面 → 剔除中心 +x 面
    datas[5][idx(0, 11, 9)] = STONE; // 中心 (15,10,8) +x 面的 AO 遮挡
    lights[5][idx(0, 10, 12)] = 14; // 边界光照采样
    skys[5][idx(0, 10, 12)] = 15;
    // 其余边邻居的邻中心列也铺一些
    datas[3][idx(15, 10, 8)] = STONE; // -x 邻居邻中心列
    datas[7][idx(8, 10, 0)] = STONE; // +z 邻居邻中心列
    datas[1][idx(8, 10, 15)] = GLASS; // -z 邻居邻中心列（与中心玻璃贴面）
    // 角邻居（+x,+z 为索引 8）：靠中心角柱 (0,y,0) 会被对角 AO 探到
    datas[8][idx(0, 11, 0)] = STONE;
    datas[0][idx(15, 10, 15)] = STONE;
    // ——— 陷阱：所有邻居 1 格环以外的内部区域，任何正确实现都不该读到 ———
    for (const k of [0, 1, 2, 3, 5, 6, 7, 8]) {
      datas[k][idx(8, 30, 8)] = STONE;
      lights[k][idx(8, 30, 8)] = 15;
      skys[k][idx(8, 30, 8)] = 15;
    }
    datas[5][idx(2, 10, 8)] = STONE; // +x 邻居 x≥1 列也不该被读
    datas[5][idx(1, 10, 8)] = STONE;
    datas[8][idx(1, 11, 1)] = STONE; // 角邻居角柱以外

    const ref = buildFromGrid(3, -2, datas, lights, skys, null);
    const snap = sliceBorders(datas, lights, skys);
    const expanded = expandBorders(snap);
    const got = buildFromGrid(3, -2, expanded.datas, expanded.lights, expanded.skys, null);
    expectGeometryEqual(got.solid, ref.solid);
    expectGeometryEqual(got.water, ref.water);
    expect(got.solid.indices.length).toBeGreaterThan(0); // 确实出了几何，不是两边都空
  });

  it('跨 chunk 面剔除与边界光照：邻居贴面剔除中心边界面，边界面的光取自邻居切片', () => {
    // 基线：中心 (15,10,8) 孤立方块，+x 邻居存在但为空
    const base = makeFull9();
    base.datas[4][idx(15, 10, 8)] = STONE;
    const g0 = buildFromGrid(0, 0, ...unpack(expandBorders(sliceBorders(base.datas, base.lights, base.skys))), null);
    expect(g0.solid.indices.length).toBe(6 * 6);

    // 邻居邻中心列放石头：中心 +x 面被跨 chunk 剔除
    const culled = makeFull9();
    culled.datas[4][idx(15, 10, 8)] = STONE;
    culled.datas[5][idx(0, 10, 8)] = STONE;
    const g1 = buildFromGrid(0, 0, ...unpack(expandBorders(sliceBorders(culled.datas, culled.lights, culled.skys))), null);
    expect(g1.solid.indices.length).toBe(5 * 6);

    // 天空光全 0、仅邻居 (0,10,8) 格光照 12：+x 面恰好取邻居切片里的光 → 顶点色 = 12/15
    const lit = makeFull9();
    lit.datas[4][idx(15, 10, 8)] = STONE;
    lit.lights[5][idx(0, 10, 8)] = 12;
    const g2 = buildFromGrid(0, 0, ...unpack(expandBorders(sliceBorders(lit.datas, lit.lights, lit.skys))), null);
    const maxColor = Math.max(...g2.solid.colors);
    expect(maxColor).toBeCloseTo(12 / 15, 5);
    // 只有 +x 一个面（4 顶点）拿到这束光，其余面无光（天空光 0）
    expect([...g2.solid.colors].filter((v) => v > 0).length).toBe(12); // 4 顶点 × RGB
  });

  it('邻居缺失（null）时切片全 null，与整块 null 路径一致', () => {
    const { datas, lights, skys } = makeFull9();
    datas[4][idx(15, 10, 15)] = STONE;
    skys[4].fill(15);
    const nullDatas: (Uint16Array | null)[] = datas.map((d, i) => (i === 4 ? d : null));
    const nullLights: (Uint8Array | null)[] = lights.map((l, i) => (i === 4 ? l : null));
    const nullSkys: (Uint8Array | null)[] = skys.map((s, i) => (i === 4 ? s : null));

    const snap = sliceBorders(nullDatas, nullLights, nullSkys);
    expect(snap.edgeDatas.every((a) => a === null)).toBe(true);
    expect(snap.cornerDatas.every((a) => a === null)).toBe(true);
    expect(snap.data).not.toBeNull();

    const ref = buildFromGrid(0, 0, nullDatas, nullLights, nullSkys, null);
    const expanded = expandBorders(snap);
    expect(expanded.datas.filter((a) => a !== null).length).toBe(1);
    const got = buildFromGrid(0, 0, expanded.datas, expanded.lights, expanded.skys, null);
    expectGeometryEqual(got.solid, ref.solid);
    expectGeometryEqual(got.water, ref.water);
  });

  it('切片尺寸：中心整块 + 边/角切片（快照瘦身布局自证）', () => {
    const { datas, lights, skys } = makeFull9();
    const snap = sliceBorders(datas, lights, skys);
    expect(snap.data?.length).toBe(CHUNK_VOLUME);
    for (const a of snap.edgeDatas) expect(a?.length).toBe(CHUNK_SIZE * WORLD_HEIGHT);
    for (const a of snap.edgeLights) expect(a?.length).toBe(CHUNK_SIZE * WORLD_HEIGHT);
    for (const a of snap.cornerDatas) expect(a?.length).toBe(WORLD_HEIGHT);
    for (const a of snap.cornerSkys) expect(a?.length).toBe(WORLD_HEIGHT);
  });
});

/** expandBorders 结果摊开成 buildFromGrid 的前三个参数 */
function unpack(e: { datas: (Uint16Array | null)[]; lights: (Uint8Array | null)[]; skys: (Uint8Array | null)[] }): [(Uint16Array | null)[], (Uint8Array | null)[], (Uint8Array | null)[]] {
  return [e.datas, e.lights, e.skys];
}
