'use client';

import { useEffect, useState } from 'react';
import { getFurnace, SMELT_TIME } from '@/lib/furnace';
import { useGameStore } from '@/lib/store';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { AbsSlot, GuiHotbarSlots, GuiMainSlots, McGuiFrame } from './McGui';

/** 熔炉三槽（furnace.png 内坐标 ×2） */
const SLOT_INPUT: [number, number] = [112, 34];
const SLOT_FUEL: [number, number] = [112, 106];
const SLOT_OUTPUT: [number, number] = [232, 70];
/** 进度箭头 / 火焰区（×2） */
const ARROW: [number, number, number, number] = [158, 68, 44, 34];
const FLAME: [number, number, number, number] = [112, 74, 28, 28];

/** 熔炉界面（MC Java 光标拖拽）：输入/燃料槽可放可取（仅方块/材料，工具/装备拒绝），
 *  产出槽只能取（左键全取/右键取 1 到光标，shift 直接入背包并结算烧炼经验）；
 *  背包/热键栏 shift 快移：可烧炼物→输入槽、燃料→燃料槽（双重身份优先进燃料槽）。
 *  熔炉槽不参与拖动分发（点击/右键语义已覆盖）。 */
export function FurnaceDialog() {
  const furnaceKey = useGameStore((s) => s.furnaceOpen);
  const setOpen = useGameStore((s) => s.setFurnaceOpen);
  const hotbarSlots = useGameStore((s) => s.hotbarSlots);
  const mainSlots = useGameStore((s) => s.mainSlots);
  const slotMouseDown = useGameStore((s) => s.slotMouseDown);
  const slotDragEnter = useGameStore((s) => s.slotDragEnter);
  const slotDoubleClick = useGameStore((s) => s.slotDoubleClick);
  const furnaceSlotMouseDown = useGameStore((s) => s.furnaceSlotMouseDown);
  const [, setTick] = useState(0);

  // 烧炼进度连续变化：打开时 250ms 刷新
  useEffect(() => {
    if (!furnaceKey) return;
    const t = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [furnaceKey]);

  const f = furnaceKey ? getFurnace(furnaceKey) : null;

  return (
    <Dialog
      open={furnaceKey !== null}
      onOpenChange={(o) => {
        if (!o) setOpen(null);
      }}
    >
      <DialogContent className="border-0 bg-transparent p-0 shadow-none sm:max-w-none">
        {f && (
          <McGuiFrame texture="/textures/gui/container/furnace.png">
            <AbsSlot pos={SLOT_INPUT} stack={f.input} onPress={(info) => furnaceSlotMouseDown('input', info)} />
            <AbsSlot pos={SLOT_FUEL} stack={f.fuel} onPress={(info) => furnaceSlotMouseDown('fuel', info)} />
            <AbsSlot pos={SLOT_OUTPUT} stack={f.output} onPress={(info) => furnaceSlotMouseDown('output', info)} />
            {/* 进度箭头区：按烧炼进度叠加 */}
            <div className="absolute overflow-hidden" style={{ left: ARROW[0], top: ARROW[1], width: ARROW[2], height: ARROW[3] }}>
              <div className="h-full bg-white/60 transition-[width]" style={{ width: `${(f.progress / SMELT_TIME) * 100}%` }} />
            </div>
            {/* 火焰区：燃料燃烧中 */}
            {f.burnLeft > 0 && (
              <div className="absolute rounded-sm bg-orange-500/60" style={{ left: FLAME[0], top: FLAME[1], width: FLAME[2], height: FLAME[3] }} />
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
        )}
      </DialogContent>
    </Dialog>
  );
}
