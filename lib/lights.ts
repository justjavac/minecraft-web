// 方块光照：chunk lightmap（0-15），光源播种 + BFS 衰减传播，跨 chunk 边界接力级联

import { BLOCKS } from './blocks';
import { CHUNK_SIZE, CHUNK_VOLUME, WORLD_HEIGHT, chunkKey, localIndex, type Chunk, type World } from './world';

const DIRS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
] as const;
const NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** 重算一个 chunk 的光照（光源 + 邻居边界面接力；不透明方块阻挡） */
export function recomputeLight(world: World, chunk: Chunk): void {
  const light = chunk.light;
  light.fill(0);

  // 环形 BFS 队列
  const qx = new Int16Array(CHUNK_VOLUME * 2);
  const qy = new Int16Array(CHUNK_VOLUME * 2);
  const qz = new Int16Array(CHUNK_VOLUME * 2);
  let qh = 0;
  let qt = 0;
  const push = (x: number, y: number, z: number, v: number): void => {
    const i = localIndex(x, y, z);
    if (light[i] >= v) return;
    light[i] = v;
    qx[qt] = x;
    qy[qt] = y;
    qz[qt] = z;
    qt++;
  };

  // 种子 1：本 chunk 内的光源方块
  for (let y = 0; y < WORLD_HEIGHT; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const lv = BLOCKS[chunk.data[localIndex(x, y, z)]]?.light ?? 0;
        if (lv > 0) push(x, y, z, lv);
      }
    }
  }
  // 种子 2：四邻居边界面光照（跨界衰减 1 接力）
  for (const [dx, dz] of NEIGHBORS) {
    const n = world.chunks.get(chunkKey(chunk.cx + dx, chunk.cz + dz));
    if (!n) continue;
    for (let y = 0; y < WORLD_HEIGHT; y++) {
      for (let t = 0; t < CHUNK_SIZE; t++) {
        let lv: number;
        let x: number;
        let z: number;
        if (dx === 1) {
          lv = n.light[localIndex(0, y, t)];
          x = CHUNK_SIZE - 1;
          z = t;
        } else if (dx === -1) {
          lv = n.light[localIndex(CHUNK_SIZE - 1, y, t)];
          x = 0;
          z = t;
        } else if (dz === 1) {
          lv = n.light[localIndex(t, y, 0)];
          x = t;
          z = CHUNK_SIZE - 1;
        } else {
          lv = n.light[localIndex(t, y, CHUNK_SIZE - 1)];
          x = t;
          z = 0;
        }
        if (lv > 1) push(x, y, z, lv - 1);
      }
    }
  }

  // BFS 衰减传播
  while (qh < qt) {
    const x = qx[qh];
    const y = qy[qh];
    const z = qz[qh];
    qh++;
    const v = light[localIndex(x, y, z)];
    if (v <= 1) continue;
    for (const [dx, dy, dz] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (nx < 0 || nx >= CHUNK_SIZE || nz < 0 || nz >= CHUNK_SIZE || ny < 0 || ny >= WORLD_HEIGHT) continue;
      const ni = localIndex(nx, ny, nz);
      if (BLOCKS[chunk.data[ni]]?.opaque) continue;
      push(nx, ny, nz, v - 1);
    }
  }
}

/** 重算天空光：直降全亮到首个不透明方块，再向侧面衰减渗透（MC 天空光规则） */
export function recomputeSky(world: World, chunk: Chunk): void {
  const sky = chunk.sky;
  sky.fill(0);

  // 环形 BFS 队列
  const qx = new Int16Array(CHUNK_VOLUME * 2);
  const qy = new Int16Array(CHUNK_VOLUME * 2);
  const qz = new Int16Array(CHUNK_VOLUME * 2);
  let qh = 0;
  let qt = 0;

  // 1) 垂直直降：每列自天顶 15，直到碰到第一个不透明方块（同时入队供侧面渗透）
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
        const i = localIndex(x, y, z);
        if (BLOCKS[chunk.data[i]]?.opaque) break;
        sky[i] = 15;
        qx[qt] = x;
        qy[qt] = y;
        qz[qt] = z;
        qt++;
      }
    }
  }

  // 2) 边界接力 + BFS 衰减传播
  const push = (x: number, y: number, z: number, v: number): void => {
    const i = localIndex(x, y, z);
    if (sky[i] >= v) return;
    sky[i] = v;
    qx[qt] = x;
    qy[qt] = y;
    qz[qt] = z;
    qt++;
  };
  for (const [dx, dz] of NEIGHBORS) {
    const n = world.chunks.get(chunkKey(chunk.cx + dx, chunk.cz + dz));
    if (!n) continue;
    for (let y = 0; y < WORLD_HEIGHT; y++) {
      for (let t = 0; t < CHUNK_SIZE; t++) {
        let lv: number;
        let x: number;
        let z: number;
        if (dx === 1) {
          lv = n.sky[localIndex(0, y, t)];
          x = CHUNK_SIZE - 1;
          z = t;
        } else if (dx === -1) {
          lv = n.sky[localIndex(CHUNK_SIZE - 1, y, t)];
          x = 0;
          z = t;
        } else if (dz === 1) {
          lv = n.sky[localIndex(t, y, 0)];
          x = t;
          z = CHUNK_SIZE - 1;
        } else {
          lv = n.sky[localIndex(t, y, CHUNK_SIZE - 1)];
          x = t;
          z = 0;
        }
        if (lv > 1) push(x, y, z, lv - 1);
      }
    }
  }
  while (qh < qt) {
    const x = qx[qh];
    const y = qy[qh];
    const z = qz[qh];
    qh++;
    const v = sky[localIndex(x, y, z)];
    if (v <= 1) continue;
    for (const [dx, dy, dz] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (nx < 0 || nx >= CHUNK_SIZE || nz < 0 || nz >= CHUNK_SIZE || ny < 0 || ny >= WORLD_HEIGHT) continue;
      const ni = localIndex(nx, ny, nz);
      if (BLOCKS[chunk.data[ni]]?.opaque) continue;
      push(nx, ny, nz, v - 1);
    }
  }
}

/** 边界光照签名（级联触发比较用；每 2 格采样降低比较成本） */
function borderSign(chunk: Chunk): number {
  let h = 0;
  for (let y = 0; y < WORLD_HEIGHT; y += 2) {
    for (let t = 0; t < CHUNK_SIZE; t += 2) {
      h =
        (h * 31 +
          chunk.light[localIndex(0, y, t)] * 7 +
          chunk.light[localIndex(CHUNK_SIZE - 1, y, t)] * 3 +
          chunk.light[localIndex(t, y, 0)] * 5 +
          chunk.light[localIndex(t, y, CHUNK_SIZE - 1)] +
          chunk.sky[localIndex(0, y, t)] * 11 +
          chunk.sky[localIndex(CHUNK_SIZE - 1, y, t)] * 13 +
          chunk.sky[localIndex(t, y, 0)] * 17 +
          chunk.sky[localIndex(t, y, CHUNK_SIZE - 1)] * 19) |
        0;
    }
  }
  return h;
}

/**
 * 方块变化后级联重算：从变化 chunk 出发，边界签名有变就向邻居扩散（光照最多跨 15 格，
 * 单个编辑的实际级联通常 1-2 个 chunk）
 */
export function cascadeLight(world: World, start: Chunk): void {
  const queue: Chunk[] = [start];
  const seen = new Set<string>([chunkKey(start.cx, start.cz)]);
  while (queue.length > 0) {
    const c = queue.pop()!;
    const before = borderSign(c);
    recomputeLight(world, c);
    recomputeSky(world, c);
    if (borderSign(c) === before) continue;
    for (const [dx, dz] of NEIGHBORS) {
      const key = chunkKey(c.cx + dx, c.cz + dz);
      if (seen.has(key)) continue;
      const n = world.chunks.get(key);
      if (!n) continue;
      seen.add(key);
      queue.push(n);
    }
  }
}

/**
 * 冲刷标记 lightDirty 的 chunk（批量编辑场景：setBlock 只打标记，
 * 每帧建网前统一重算一次，避免逐 setBlock 全量重算的雪崩）。
 * 每帧限量处理，余下的留到后续帧——大面积光照变化（爆破/放置发光体）
 * 不会在同一帧全部重算而卡住玩家
 */
const FLUSH_BUDGET = 3;

export function flushLight(world: World): void {
  let budget = FLUSH_BUDGET;
  for (const c of world.chunks.values()) {
    if (budget <= 0) break;
    if (!c.lightDirty) continue;
    c.lightDirty = false;
    budget--;
    cascadeLight(world, c);
  }
}
