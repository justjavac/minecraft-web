// 爆炸共享逻辑：TNT 与苦力怕共用（破块带防爆规则 + 距离伤害 + 粒子 + 音效）

import { AIR, BLOCKS, tileOf } from './blocks';
import { breakParticles } from './game';
import { boom, playSound } from './sound';
import type { World } from './world';

export interface ExplodeOptions {
  /** 爆炸半径（TNT 4，苦力怕 3） */
  radius: number;
  /** 玩家最大伤害（贴脸），随距离线性衰减 */
  maxDamage: number;
  /** 伤害判定半径 */
  hurtRadius: number;
}

/** 防爆方块：基岩/强化深板岩/黑曜石类（MC 爆炸抗性） */
function blastProof(id: number): boolean {
  const def = BLOCKS[id];
  return def?.unbreakable === true || def?.pickTier === 3;
}

/** 在 (x,y,z) 爆炸：半径内概率破坏方块（中心全碎，边缘渐稀），防爆方块除外，按距离伤玩家 */
export function explodeAt(
  world: World,
  x: number,
  y: number,
  z: number,
  playerPos: { x: number; y: number; z: number },
  onAttackPlayer: (damage: number) => void,
  opts: ExplodeOptions,
): void {
  const { radius: R, maxDamage, hurtRadius } = opts;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const cz = Math.floor(z);
  for (let bx = cx - R; bx <= cx + R; bx++) {
    for (let by = cy - R; by <= cy + R; by++) {
      for (let bz = cz - R; bz <= cz + R; bz++) {
        const id = world.getBlock(bx, by, bz);
        if (id === AIR || blastProof(id)) continue;
        const d = Math.hypot(bx + 0.5 - x, by + 0.5 - y, bz + 0.5 - z);
        if (d <= R + 0.5 && Math.random() < 1 - d / (R + 2)) {
          world.setBlock(bx, by, bz, AIR);
        }
      }
    }
  }
  const pd = Math.hypot(playerPos.x - x, playerPos.y + 0.9 - y, playerPos.z - z);
  if (pd < hurtRadius) onAttackPlayer(Math.max(1, Math.round(maxDamage * (1 - pd / hurtRadius))));
  for (let i = 0; i < 12; i++) breakParticles.push({ x: cx, y: cy, z: cz, tile: tileOf('stone') });
  playSound('dig_cracky', 0.4);
  boom();
}
