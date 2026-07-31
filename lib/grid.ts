// 网格常量：独立叶子模块，供 world.ts 与 mesher（含 Web Worker 端）共用。
// 注意：Web Worker 只应经本模块取常量——从 './world' 取值会把 world 的整条依赖链
// （fluids/redstone/mobs/store/react/idb）拖进 worker 包，导致 worker 初始化挂死

export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 128;
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;

export const localIndex = (x: number, y: number, z: number): number =>
  (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;

export const chunkKey = (cx: number, cz: number): string => `${cx},${cz}`;

/** 把世界坐标 (x, y, z) 的方块写入 chunk (cx, cz) 的数据；xz 落在本 chunk 外或 y 越界时直接忽略 */
export const put = (
  data: Uint16Array, cx: number, cz: number, x: number, y: number, z: number, id: number,
): void => {
  const lx = x - cx * CHUNK_SIZE;
  const lz = z - cz * CHUNK_SIZE;
  if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return;
  data[localIndex(lx, y, lz)] = id;
};
