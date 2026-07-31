// 重生锚（MC）：荧石粉充能（1-4 档），下界中已充能时右键设重生点，死亡在锚旁重生并耗 1 档；
// 主世界/末地右键爆炸（交互/爆炸分支在 lib/actions.ts，同床的维度规则）。
//
// 档位为会话级状态：随 worldScope 在维度切换时暂存/恢复（同 beacon 做法），但【存档 dims 落盘不做】——
// persistence 的 dims 映射只认 furnace/brewing/storage/beacon，读档后重生锚回到 0 档（与 MC 有出入，
// 属已知简化：避免 SAVE_VERSION 迁移链加版本，重生点本身也未落盘）。

import { BLOCK_BY_KEY } from './blocks';
import { type World } from './world';
import { registerWorldScope } from './worldScope';

/** MC：重生锚最多 4 档（4 块荧石充满） */
export const MAX_ANCHOR_CHARGE = 4;

/** 重生锚档位：posKey → 档数（1-4；无条目 = 未充能） */
export const anchorCharges = new Map<string, number>();

export function anchorKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

export function getAnchorCharge(x: number, y: number, z: number): number {
  return anchorCharges.get(anchorKey(x, y, z)) ?? 0;
}

export function setAnchorCharge(x: number, y: number, z: number, n: number): void {
  const key = anchorKey(x, y, z);
  if (n <= 0) anchorCharges.delete(key);
  else anchorCharges.set(key, Math.min(n, MAX_ANCHOR_CHARGE));
}

export type AnchorRespawnResult =
  /** sp 处不是重生锚（床等其它重生点路径，调用方按原逻辑处理） */
  | 'not-anchor'
  /** 耗 1 档后仍有剩余：在锚旁重生，重生点保留 */
  | 'ok'
  /** 耗掉最后一档：本次仍在锚旁重生，但重生点随之失效（调用方清重生点） */
  | 'exhausted'
  /** 锚还在但 0 档：无法在此重生，回世界出生点，重生点失效（调用方清重生点） */
  | 'depleted';

/**
 * 死亡重生结算（Player 重生边沿调用）。sp 为 store.respawnPoint（锚上方一格的中心，同床的存法）。
 * 锚被挖走的情况通常由 breakBlock 提前清掉重生点；若走到这里且方块已不是锚，按 'not-anchor' 交由原逻辑。
 */
export function resolveAnchorRespawn(world: World, sp: { x: number; y: number; z: number }): AnchorRespawnResult {
  const bx = Math.floor(sp.x);
  const by = Math.floor(sp.y) - 1;
  const bz = Math.floor(sp.z);
  if (world.getBlock(bx, by, bz) !== BLOCK_BY_KEY.respawn_anchor.id) return 'not-anchor';
  const c = getAnchorCharge(bx, by, bz);
  if (c <= 0) return 'depleted';
  setAnchorCharge(bx, by, bz, c - 1);
  return c - 1 > 0 ? 'ok' : 'exhausted';
}

/** 清空（测试/重置用） */
export function clearAnchors(): void {
  anchorCharges.clear();
}

// 世界作用域自注册（lib/worldScope.ts）：档位随维度切换暂存/恢复；存档 dims 落盘不做（见文件头注释）
registerWorldScope<[string, number][]>({
  name: 'respawnanchor',
  clear: clearAnchors,
  snapshot: () => [...anchorCharges],
  restore: (entries) => {
    anchorCharges.clear();
    for (const [k, v] of entries) anchorCharges.set(k, v);
  },
});
