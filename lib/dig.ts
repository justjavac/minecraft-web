// 挖掘时间换算：blocks.ts 的 digTime 表存 MC 徒手时间（需镐方块 = 硬度×5，徒手可采 = 硬度×1.5）。
// 工具类型匹配时切回 hardness×1.5 基值再除工具倍率（MC 规则）。纯逻辑可单测

import { BLOCKS, type BlockId } from './blocks';
import type { Slot } from './slots';
import { TOOLS } from './tools';

/**
 * 有效挖掘时长（秒，MC）：
 * - 工具类型匹配方块 tool（剑除外）：需镐方块（needsPick/pickTier，digTime 为硬度×5）按 ×1.5 基值（digTime×0.3）
 *   除工具倍率；徒手可采方块（digTime 已是硬度×1.5）直接除倍率。效率附魔仅在匹配时 +30%/级
 * - 徒手或工具类型不匹配：原 digTime（需镐方块即 MC 的 hardness×5 慢速惩罚）
 * - 急迫效果：每级 +30%（MC 急迫 I +20%，与本项目效率附魔同风格取 30%；信标 4 层 II 级 +60%）
 */
export function effectiveDigTime(blockId: BlockId, held: Slot, haste: boolean | number): number {
  const def = BLOCKS[blockId];
  const digTime = def?.digTime ?? 1;
  const hasteLvl = haste === true ? 1 : haste || 0;
  let speedMul = 1 + 0.3 * hasteLvl;
  let matched = false;
  if (held?.kind === 'tool') {
    const tool = TOOLS[held.tool];
    matched = tool.kind !== 'sword' && def?.tool === tool.kind;
    if (matched) speedMul *= tool.speed * (1 + 0.3 * (held.ench?.efficiency ?? 0));
  }
  // 需镐方块是 ×5 基值，匹配时切到 ×1.5 基值（1.5/5 = 0.3）；徒手可采方块本就是 ×1.5 基值
  const base = matched && (def?.needsPick === true || def?.pickTier !== undefined) ? digTime * 0.3 : digTime;
  return base / speedMul;
}
