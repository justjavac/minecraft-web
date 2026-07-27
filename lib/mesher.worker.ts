// 网格化 Worker：后台线程把 3×3 邻居 chunk 数据网格化（输出为可转移的 typed arrays）
// 入口仅被 lib/mesherPool.ts 以 new Worker(new URL(...)) 方式加载

import { buildFromGrid, type GeometryData } from './mesher';

export interface MeshRequest {
  key: string;
  version: number;
  cx: number;
  cz: number;
  datas: (Uint16Array | null)[];
  /** 与 datas 同布局的 3×3 光照数组（可为 null） */
  lights: (Uint8Array | null)[];
  /** 与 datas 同布局的 3×3 天空光数组（可为 null） */
  skys: (Uint8Array | null)[];
  /** 中心 chunk 及 1 格环共 18×18 群系索引（群系顶点色平滑；可为 null 退化为平原色） */
  biomes?: Uint8Array | null;
}

export interface MeshResponse {
  key: string;
  version: number;
  solid: GeometryData;
  water: GeometryData;
}

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<MeshRequest>) => void) | null;
  postMessage(message: MeshResponse, transfer: Transferable[]): void;
};

ctx.onmessage = (e) => {
  const { key, version, cx, cz, datas, lights, skys, biomes } = e.data;
  const { solid, water } = buildFromGrid(cx, cz, datas, lights, skys, biomes);
  const response: MeshResponse = { key, version, solid, water };
  ctx.postMessage(response, [
    solid.positions.buffer,
    solid.normals.buffer,
    solid.uvs.buffer,
    solid.colors.buffer,
    solid.indices.buffer,
    water.positions.buffer,
    water.normals.buffer,
    water.uvs.buffer,
    water.colors.buffer,
    water.indices.buffer,
  ]);
};
