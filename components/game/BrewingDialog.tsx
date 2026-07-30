'use client';

import { useEffect, useState } from 'react';
import { BREW_TIME, getBrew, INGREDIENTS, POTIONS } from '@/lib/brewing';
import { useGameStore } from '@/lib/store';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { AbsSlot, GuiSlot, McGuiFrame } from './McGui';
import { slotName } from './slotDisplay';

/** 酿造台界面（MC Java）：brewing_stand.png 纹理背景，燃料/材料/三药水槽/热键栏按 MC 坐标 absolute 对齐 */
export function BrewingDialog() {
  const brewKey = useGameStore((s) => s.brewingOpen);
  const setOpen = useGameStore((s) => s.setBrewingOpen);
  const slots = useGameStore((s) => s.hotbarSlots);
  const brewingPut = useGameStore((s) => s.brewingPut);
  const brewingTakePotion = useGameStore((s) => s.brewingTakePotion);
  const [, setTick] = useState(0);

  // 酿造进度连续变化：打开时 250ms 刷新
  useEffect(() => {
    if (!brewKey) return;
    const t = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [brewKey]);

  const b = brewKey ? getBrew(brewKey) : null;

  return (
    <Dialog
      open={brewKey !== null}
      onOpenChange={(o) => {
        if (!o) setOpen(null);
      }}
    >
      <DialogContent className="border-0 bg-transparent p-0 shadow-none sm:max-w-none">
        {b && (
          <McGuiFrame texture="/textures/gui/container/brewing_stand.png">
            {/* 燃料（左上） */}
            <AbsSlot pos={[30, 30]} stack={b.fuel} />
            {/* 材料（上中） */}
            <AbsSlot pos={[158, 30]} stack={b.ingredient} />
            {/* 药水槽（品字形下 3） */}
            {b.potions.map((p, i) => (
              <AbsSlot
                key={i}
                pos={([[106, 106], [158, 106], [210, 106]] as [number, number][])[i]}
                stack={p}
                onClick={() => brewingTakePotion(i)}
              />
            ))}
            {/* 进度箭头区（右上）：按酿造进度叠加 */}
            <div className="absolute overflow-hidden" style={{ left: 205, top: 32, width: 24, height: 58 }}>
              <div
                className="w-full bg-purple-500/70 transition-[height]"
                style={{ height: `${(b.progress / BREW_TIME) * 100}%` }}
              />
            </div>
            {/* 热键栏 9 格（点击放入；仅烈焰粉/酿造材料/药水可用） */}
            {slots.map((slot, i) => {
              const usable =
                slot !== null &&
                slot.kind === 'material' &&
                (slot.material === 'blaze_powder' || INGREDIENTS.includes(slot.material) || POTIONS[slot.material] !== undefined);
              return (
                <GuiSlot
                  key={i}
                  pos={[16 + i * 36, 282]}
                  slot={slot}
                  disabled={slot !== null && !usable}
                  onClick={() => brewingPut(i)}
                  title={slotName(slot)}
                />
              );
            })}
          </McGuiFrame>
        )}
      </DialogContent>
    </Dialog>
  );
}
