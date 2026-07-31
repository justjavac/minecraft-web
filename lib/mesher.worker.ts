// 网格化 Worker：后台线程把中心 chunk + 邻居边界切片网格化（输出为可转移的 typed arrays）
// 入口仅被 lib/mesherPool.ts 以 new Worker(new URL(...)) 方式加载

import { buildFromGrid, expandBorders, type BorderSnapshot, type GeometryData } from './mesher';

/** 数据部分为中心整块 + 邻居 1 格边界切片（mesher 对邻居的访问不越界 ±1 格，见 mesher.ts 切片段注释） */
export interface MeshRequest extends BorderSnapshot {
  key: string;
  version: number;
  cx: number;
  cz: number;
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
  const { key, version, cx, cz, biomes } = e.data;
  // 边界切片重组成 3×3 整块布局（切片外区域恒 0，与邻居缺失语义一致），再走原建网热路径
  const { datas, lights, skys } = expandBorders(e.data);
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
