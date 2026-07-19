// 矿石/岩石团簇与基岩层生成：按 chunk 确定性播种，在石头/深板岩中植入矿脉
// 数值参考原版分布，按 WORLD_HEIGHT=64 缩放（y 越低越稀有；深板岩带 y≤9）

import { BLOCK_BY_KEY } from './blocks';
import { mulberry32, type Terrain } from './noise';
import { CHUNK_SIZE, WORLD_HEIGHT, localIndex } from './world';

const STONE = BLOCK_BY_KEY.stone.id;
const DEEPSLATE = BLOCK_BY_KEY.deepslate.id;
const BEDROCK = BLOCK_BY_KEY.bedrock.id;

interface Vein {
  id: number;
  /** 每 chunk 矿脉条数 [min, max] */
  count: [number, number];
  /** 单条矿脉方块数 [min, max] */
  size: [number, number];
  minY: number;
  maxY: number;
  /** 可替换的宿主方块（默认石头+深板岩） */
  hosts?: number[];
}

const KEY = (k: string) => BLOCK_BY_KEY[k].id;

const VEINS: Vein[] = [
  // 岩石团簇（石头→各类石头/土/砾石/黏土）
  { id: KEY('dirt'), count: [4, 8], size: [8, 20], minY: 0, maxY: 55 },
  { id: KEY('gravel'), count: [3, 6], size: [6, 14], minY: 0, maxY: 55 },
  { id: KEY('granite'), count: [3, 6], size: [8, 16], minY: 0, maxY: 55 },
  { id: KEY('diorite'), count: [3, 6], size: [8, 16], minY: 0, maxY: 55 },
  { id: KEY('andesite'), count: [3, 6], size: [8, 16], minY: 0, maxY: 55 },
  { id: KEY('clay'), count: [1, 3], size: [4, 8], minY: 18, maxY: 24, hosts: [STONE, KEY('dirt'), KEY('sand')] },
  { id: KEY('tuff'), count: [1, 2], size: [6, 12], minY: 0, maxY: 12 },
  // 矿脉（y 越低越稀有）
  { id: KEY('coal_ore'), count: [8, 14], size: [4, 10], minY: 0, maxY: 46 },
  { id: KEY('iron_ore'), count: [5, 9], size: [3, 7], minY: 0, maxY: 30 },
  { id: KEY('copper_ore'), count: [3, 6], size: [3, 7], minY: 4, maxY: 40 },
  { id: KEY('gold_ore'), count: [1, 3], size: [2, 5], minY: 0, maxY: 14 },
  { id: KEY('lapis_ore'), count: [1, 2], size: [2, 4], minY: 0, maxY: 16 },
  { id: KEY('diamond_ore'), count: [1, 3], size: [2, 5], minY: 0, maxY: 10 },
  { id: KEY('emerald_ore'), count: [0, 1], size: [1, 2], minY: 0, maxY: 14 },
];

const randInt = (rand: () => number, [min, max]: [number, number]): number =>
  min + Math.floor(rand() * (max - min + 1));

/** 地形填充后调用：基岩层 + 深板岩渐变 + 团簇矿脉（全部按 chunk 坐标确定性） */
export function applyOres(seedHash: number, terrain: Terrain, cx: number, cz: number, data: Uint16Array): void {
  const rand = mulberry32(
    (seedHash ^ Math.imul(cx + 0x9e37, 0x85ebca6b) ^ Math.imul(cz + 0x27d4, 0x165667b1)) | 0,
  );

  // 列存在性：虚空列（heightAt < 0，如测试地形）不做任何填充
  const solid = (x: number, z: number) => terrain.heightAt(cx * CHUNK_SIZE + x, cz * CHUNK_SIZE + z) >= 0;

  // 基岩：y=0 全铺，y=1 约 1/2，y=2 约 1/4（与原版的随机底床一致）
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      if (!solid(x, z)) continue;
      data[localIndex(x, 0, z)] = BEDROCK;
      if (rand() < 0.5) data[localIndex(x, 1, z)] = BEDROCK;
      if (rand() < 0.25) data[localIndex(x, 2, z)] = BEDROCK;
    }
  }

  // 深板岩带：y≤9，越往下越密，把石头渐变为深板岩
  for (let y = 0; y <= 9; y++) {
    const p = ((9 - y) / 9) * 0.75;
    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        const i = localIndex(x, y, z);
        if (data[i] === STONE && rand() < p) data[i] = DEEPSLATE;
      }
    }
  }

  // 团簇矿脉：随机起点 + 随机游走成矿团
  for (const v of VEINS) {
    const hosts = v.hosts ?? [STONE, DEEPSLATE];
    const count = randInt(rand, v.count);
    for (let n = 0; n < count; n++) {
      let x = Math.floor(rand() * CHUNK_SIZE);
      let y = v.minY + Math.floor(rand() * (v.maxY - v.minY + 1));
      let z = Math.floor(rand() * CHUNK_SIZE);
      const size = randInt(rand, v.size);
      for (let s = 0; s < size; s++) {
        if (x >= 0 && x < CHUNK_SIZE && y >= 0 && y < WORLD_HEIGHT && z >= 0 && z < CHUNK_SIZE) {
          const i = localIndex(x, y, z);
          if (hosts.includes(data[i])) data[i] = v.id;
        }
        x += Math.floor(rand() * 3) - 1;
        y += Math.floor(rand() * 3) - 1;
        z += Math.floor(rand() * 3) - 1;
      }
    }
  }
}
