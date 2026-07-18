// 网格化 Worker：后台线程把 3×3 邻居 chunk 数据网格化（输出为可转移的 typed arrays）
// 入口仅被 lib/mesherPool.ts 以 new Worker(new URL(...)) 方式加载

import { buildFromGrid, type GeometryData } from './mesher';

export interface MeshRequest {
  key: string;
  version: number;
  cx: number;
  cz: number;
  datas: (Uint16Array | null)[];
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
  const { key, version, cx, cz, datas } = e.data;
  const { solid, water } = buildFromGrid(cx, cz, datas);
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
