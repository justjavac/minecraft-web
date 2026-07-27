// 柱状作物生长与仙人掌邻贴规则（MC 随机刻观感）：仙人掌/甘蔗/竹子随机拔节；
// 仙人掌四邻出现实心方块即破。无登记表——按 MC 随机刻方式从已加载 chunk 随机抽样

import { AIR, BLOCK_BY_KEY, BLOCKS, type BlockId } from './blocks';
import { WORLD_HEIGHT, type World } from './world';

/** 柱高上限（竹子为复刻简化值，MC 为 12-16） */
const MAX_HEIGHT: Record<string, number> = { cactus: 3, sugar_cane: 3, bamboo: 6 };

let acc = 0;
let rngState = 0x9e3779b9;
function rand(): number {
  rngState = (rngState * 1103515245 + 12345) | 0;
  return ((rngState >>> 9) & 0x7fffffff) / 0x7fffffff;
}

/** 水平四邻是否有实心方块 */
function adjacentSolid(world: World, x: number, y: number, z: number): boolean {
  return (
    BLOCKS[world.getBlock(x + 1, y, z)]?.solid === true ||
    BLOCKS[world.getBlock(x - 1, y, z)]?.solid === true ||
    BLOCKS[world.getBlock(x, y, z + 1)]?.solid === true ||
    BLOCKS[world.getBlock(x, y, z - 1)]?.solid === true
  );
}

/** 尝试把所在柱拔高一节（竹子：旧顶段变茎段，新节为带叶顶段） */
function tryGrow(world: World, x: number, y: number, z: number, key: 'cactus' | 'sugar_cane' | 'bamboo'): void {
  const stalk = BLOCK_BY_KEY[key].id;
  const tip = key === 'bamboo' ? BLOCK_BY_KEY.bamboo_top.id : stalk;
  let tipY = y;
  while (world.getBlock(x, tipY + 1, z) === stalk || world.getBlock(x, tipY + 1, z) === tip) tipY++;
  let baseY = y;
  while (world.getBlock(x, baseY - 1, z) === stalk) baseY--;
  if (tipY - baseY + 1 >= MAX_HEIGHT[key]) return;
  if (tipY + 1 >= WORLD_HEIGHT || world.getBlock(x, tipY + 1, z) !== AIR) return;
  if (tip !== stalk) world.setBlock(x, tipY, z, stalk);
  world.setBlock(x, tipY + 1, z, tip);
}

/** 每 ~2s：每个已加载 chunk 随机抽 12 格（MC 随机刻），命中柱作物则按概率拔节/触发仙人掌邻贴破坏 */
export function tickGrowth(world: World, dt: number): void {
  acc += dt;
  if (acc < 2) return;
  acc = 0;
  for (const chunk of world.chunks.values()) {
    for (let n = 0; n < 12; n++) {
      const x = chunk.cx * 16 + Math.floor(rand() * 16);
      const z = chunk.cz * 16 + Math.floor(rand() * 16);
      const y = Math.floor(rand() * WORLD_HEIGHT);
      const id = world.getBlock(x, y, z);
      const key = BLOCKS[id]?.key;
      if (key === 'cactus' && adjacentSolid(world, x, y, z)) {
        world.setBlock(x, y, z, AIR);
        onDrop?.(id, x + 0.5, y + 0.3, z + 0.5);
      } else if (key === 'cactus' || key === 'sugar_cane' || key === 'bamboo') {
        if (rand() < 1 / 8) tryGrow(world, x, y, z, key);
      }
    }
  }
}

/** 仙人掌破坏掉落回调（actions 注入，避免循环依赖） */
let onDrop: ((id: BlockId, x: number, y: number, z: number) => void) | null = null;
export function setGrowthDropHandler(fn: typeof onDrop): void {
  onDrop = fn;
}
