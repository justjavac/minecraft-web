// 凋灵 boss：T 形召唤检测（灵魂沙 + 三头骨）、Boss 血条状态

import { AIR, BLOCK_BY_KEY } from './blocks';
import { bossState } from './game';
import { explodeAt } from './explosion';
import { makeWither, mobs } from './mobs';
import type { World } from './world';

const SOUL = () => BLOCK_BY_KEY.soul_sand.id;
const SKULL = () => BLOCK_BY_KEY.wither_skeleton_skull.id;

/**
 * 头骨刚放下的位置 (x,y,z)：尝试以其为顶行三头之一匹配 T 形（两个轴向 × 三个角色）。
 * MC 形状：顶行 3 灵魂沙（上置 3 头骨）+ 中列向下 2 灵魂沙。
 */
export function trySummonWither(world: World, x: number, y: number, z: number, onAttackPlayer: (d: number) => void): boolean {
  if (world.getBlock(x, y, z) !== SKULL()) return false;
  for (const axis of ['x', 'z'] as const) {
    for (const role of [-1, 0, 1] as const) {
      // 顶行三格中心：本格沿轴回退 role 格
      const cx = axis === 'x' ? x - role : x;
      const cz = axis === 'z' ? z - role : z;
      if (matchT(world, cx, y, cz, axis)) {
        // 消耗 3 头骨与 4 灵魂沙，生成凋灵（伴生成爆炸，MC）
        for (const a of [-1, 0, 1]) {
          const [sx, sz] = axis === 'x' ? [cx + a, cz] : [cx, cz + a];
          world.setBlock(sx, y, sz, AIR); // 头骨
          world.setBlock(sx, y - 1, sz, AIR); // 顶行灵魂沙
        }
        world.setBlock(cx, y - 2, cz, AIR);
        world.setBlock(cx, y - 3, cz, AIR);
        const wx = cx + 0.5;
        const wz = cz + 0.5;
        mobs.push(makeWither(wx, y - 2, wz));
        bossState.name = '凋灵';
        bossState.hp = 300;
        bossState.max = 300;
        explodeAt(world, wx, y - 1, wz, { x: wx, y: y - 1, z: wz }, onAttackPlayer, { radius: 3, maxDamage: 20, hurtRadius: 4.5 });
        return true;
      }
    }
  }
  return false;
}

/** 顶行中心 (cx,y,cz)：顶行 3 灵魂沙 + 3 头骨，中列向下 2 灵魂沙 */
function matchT(world: World, cx: number, y: number, cz: number, axis: 'x' | 'z'): boolean {
  for (const a of [-1, 0, 1]) {
    const [sx, sz] = axis === 'x' ? [cx + a, cz] : [cx, cz + a];
    if (world.getBlock(sx, y, sz) !== SKULL()) return false;
    if (world.getBlock(sx, y - 1, sz) !== SOUL()) return false;
  }
  if (world.getBlock(cx, y - 2, cz) !== SOUL()) return false;
  if (world.getBlock(cx, y - 3, cz) !== SOUL()) return false;
  return true;
}
