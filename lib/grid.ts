// 网格常量：独立叶子模块，供 world.ts 与 mesher（含 Web Worker 端）共用。
// 注意：Web Worker 只应经本模块取常量——从 './world' 取值会把 world 的整条依赖链
// （fluids/redstone/mobs/store/react/idb）拖进 worker 包，导致 worker 初始化挂死

export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 128;
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;

export const localIndex = (x: number, y: number, z: number): number =>
  (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;

export const chunkKey = (cx: number, cz: number): string => `${cx},${cz}`;
