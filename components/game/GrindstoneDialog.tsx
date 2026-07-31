'use client';

import { grindResult } from '@/lib/grindstone';
import { useGameStore } from '@/lib/store';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { GuiHotbarSlots, GuiMainSlots, GuiSlot, McGuiFrame } from './McGui';

/** 砂轮槽位坐标（沿用 anvil.png 内两输入 + 一输出的格位，×2） */
const SLOT_IN1: [number, number] = [54, 94];
const SLOT_IN2: [number, number] = [152, 94];
const SLOT_OUT: [number, number] = [268, 94];

/**
 * 砂轮界面（MC Java 光标拖拽）：两输入槽（仅工具/装备）+ 输出槽（只能取）。
 * ① 两件同种 → 合并修复（A+B+5% 最大耐久封顶，附魔全移除）；② 单件附魔 → 祛魔返还经验；
 * 输出由 lib/grindstone.ts grindResult 派生，取出即生效（输入清空 + 经验返还）。
 * 纹理回退：public/textures/gui/container/ 无 grindstone.png（Faithful 包未收录），
 * 用布局同为「两输入 + 一输出」的 anvil.png 基底 + 标题代替。
 */
export function GrindstoneDialog() {
  const open = useGameStore((s) => s.grindstoneOpen);
  const setOpen = useGameStore((s) => s.setGrindstoneOpen);
  const grindSlots = useGameStore((s) => s.grindSlots);
  const hotbarSlots = useGameStore((s) => s.hotbarSlots);
  const mainSlots = useGameStore((s) => s.mainSlots);
  const slotMouseDown = useGameStore((s) => s.slotMouseDown);
  const slotDragEnter = useGameStore((s) => s.slotDragEnter);
  const slotDoubleClick = useGameStore((s) => s.slotDoubleClick);
  const grindSlotMouseDown = useGameStore((s) => s.grindSlotMouseDown);
  const grindTakeOutput = useGameStore((s) => s.grindTakeOutput);

  const result = grindResult(grindSlots[0], grindSlots[1]);

  return (
    <Dialog
      open={open !== null}
      onOpenChange={(o) => {
        if (!o) setOpen(null);
      }}
    >
      <DialogContent className="border-0 bg-transparent p-0 shadow-none sm:max-w-none">
        <McGuiFrame texture="/textures/gui/container/anvil.png">
          {/* 标题（anvil.png 基底无砂轮标题，覆盖显示） */}
          <span className="absolute left-[16px] top-[12px] text-[13px] text-zinc-100 [text-shadow:1px_1px_0_rgba(0,0,0,0.8)]">砂轮</span>
          {/* 两输入槽：仅工具/装备（约束在 action 层） */}
          <GuiSlot pos={SLOT_IN1} slot={grindSlots[0]} onPress={(info) => grindSlotMouseDown(0, info)} title="放入工具/装备" />
          <GuiSlot pos={SLOT_IN2} slot={grindSlots[1]} onPress={(info) => grindSlotMouseDown(1, info)} title="放入同种第二件（合并修复）" />
          {/* 输出槽：只能取（shift 直接入背包）；取出返还祛魔经验 */}
          <GuiSlot pos={SLOT_OUT} slot={result?.out ?? null} onPress={(info) => grindTakeOutput(info)} title={result ? '取出（返还经验）' : undefined} />
          {!result && (
            <span className="absolute left-[54px] top-[140px] w-[252px] text-center text-[11px] text-white/50">
              两件同种合并修复 / 单件附魔祛魔返经验
            </span>
          )}
          <GuiMainSlots
            slots={mainSlots}
            onSlotPress={(i, info) => slotMouseDown('main', i, info)}
            onSlotDragEnter={(i) => slotDragEnter('main', i)}
            onSlotDoubleClick={(i) => slotDoubleClick('main', i)}
          />
          <GuiHotbarSlots
            slots={hotbarSlots}
            onSlotPress={(i, info) => slotMouseDown('hotbar', i, info)}
            onSlotDragEnter={(i) => slotDragEnter('hotbar', i)}
            onSlotDoubleClick={(i) => slotDoubleClick('hotbar', i)}
          />
        </McGuiFrame>
      </DialogContent>
    </Dialog>
  );
}
