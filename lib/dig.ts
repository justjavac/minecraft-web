// 挖掘时间换算：blocks.ts 的 digTime 表存 MC 徒手时间（需镐方块 = 硬度×5，徒手可采 = 硬度×1.5）。
// 工具类型匹配且采掘层级达标时切回 hardness×1.5 基值再除工具速度（MC 规则）。纯逻辑可单测

import { BLOCKS, type BlockId } from './blocks';
import type { Slot } from './slots';
import { TOOLS, type ToolTier } from './tools';

/** MC 采掘层级排序（与 actions.ts 掉落判定一致）：木 0 石 1 铁 2 钻 3 合金 4 */
const TIER_ORDER: ToolTier[] = ['wood', 'stone', 'iron', 'diamond', 'netherite'];

/**
 * 有效挖掘时长（秒，MC）：
 * - 工具类型匹配方块 tool（剑除外）且采掘层级达标：需镐方块（needsPick/pickTier，digTime 为硬度×5）
 *   按 ×1.5 基值（digTime×0.3）除工具速度；徒手可采方块（digTime 已是硬度×1.5）直接除速度。
 *   效率附魔仅在匹配时生效，MC Java 公式：工具速度 + (等级²+1)（效率 V 钻镐 8→34）
 * - 层级不足（木镐挖钻石矿）：退回 digTime 慢速档（硬度×5），且挖完不掉落（掉落门禁在 actions.ts）
 * - 徒手或工具类型不匹配：原 digTime（需镐方块即 MC 的 hardness×5 慢速惩罚）
 * - 急迫效果：每级 +20%（MC Java；信标 4 层 II 级 +40%）
 * - 头在水中 ×5 慢；脚不沾地（悬空/飞行挖掘）再 ×5 慢（MC Java 规则）
 */
export function effectiveDigTime(blockId: BlockId, held: Slot, haste: boolean | number, underwater = false, onGround = true): number {
  const def = BLOCKS[blockId];
  const digTime = def?.digTime ?? 1;
  const hasteLvl = haste === true ? 1 : haste || 0;
  // MC：急迫 +20%/级；头在水中挖掘 5 倍慢；脚不沾地（悬空）也 5 倍慢
  let speedMul = (1 + 0.2 * hasteLvl) / (underwater ? 5 : 1) / (onGround ? 1 : 5);
  let matched = false;
  if (held?.kind === 'tool') {
    const tool = TOOLS[held.tool];
    // MC：需镐方块还要求采掘层级达标（needsPick 任意镐；pickTier 限定最低层级），不足退回 ×5 慢速档
    const needTier = def?.pickTier ?? (def?.needsPick ? 0 : null);
    const tierOk = needTier === null || TIER_ORDER.indexOf(tool.tier) >= needTier;
    matched = tool.kind !== 'sword' && def?.tool === tool.kind && tierOk;
    if (matched) {
      // MC Java 效率附魔：工具速度 + (等级²+1)（效率 V：+26）
      const eff = held.ench?.efficiency ?? 0;
      speedMul *= tool.speed + (eff > 0 ? eff * eff + 1 : 0);
    }
  }
  // 需镐方块是 ×5 基值，匹配时切到 ×1.5 基值（1.5/5 = 0.3）；徒手可采方块本就是 ×1.5 基值
  const base = matched && (def?.needsPick === true || def?.pickTier !== undefined) ? digTime * 0.3 : digTime;
  return base / speedMul;
}
