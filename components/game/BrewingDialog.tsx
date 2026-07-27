'use client';

import { useEffect, useState } from 'react';
import { BLOCKS } from '@/lib/blocks';
import { BREW_TIME, BREWING, getBrew, POTIONS, type BrewStack } from '@/lib/brewing';
import { armorDefOf } from '@/lib/armor';
import { materialName, materialTile } from '@/lib/materials';
import { useGameStore } from '@/lib/store';
import { TOOLS } from '@/lib/tools';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TileIcon } from './TileIcon';

function itemName(item: string): string {
  const [kind, idStr] = item.split(':');
  return kind === 'block' ? BLOCKS[Number(idStr)].name : materialName(idStr);
}

function itemTile(item: string): number {
  const [kind, idStr] = item.split(':');
  return kind === 'block' ? BLOCKS[Number(idStr)].side : materialTile(idStr);
}

const BREW_INGREDIENTS = ['nether_wart', 'sugar', 'blaze_powder', 'glistering_melon', 'magma_cream'];

function SlotView({ label, stack }: { label: string; stack: BrewStack | null }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex h-10 w-10 items-center justify-center rounded border border-white/20 bg-black/30">
        {stack && <TileIcon tile={itemTile(stack.item)} size={30} />}
      </div>
      <span className="text-center text-xs text-muted-foreground">
        {label}
        {stack ? ` ${itemName(stack.item)} ×${stack.count}` : ''}
      </span>
    </div>
  );
}

/** 酿造台界面：材料/燃料/三药水槽 + 进度条 + 背包快捷放入 */
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
  // 第一个可酿造的药水对应的产物名（显示在进度条下）
  let outName = '';
  if (b?.ingredient) {
    for (const p of b.potions) {
      const out = p ? BREWING[`${p.item}+${b.ingredient.item}`] : undefined;
      if (out) {
        outName = POTIONS[out]?.name ?? '';
        break;
      }
    }
  }

  return (
    <Dialog
      open={brewKey !== null}
      onOpenChange={(o) => {
        if (!o) setOpen(null);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>酿造台</DialogTitle>
          <DialogDescription>点击背包物品放入：烈焰粉进燃料、材料进材料槽、药水进药水槽，20 秒一轮</DialogDescription>
        </DialogHeader>
        {b && (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-md border p-3">
              <SlotView label="材料" stack={b.ingredient} />
              <div className="flex flex-col items-center gap-1 px-2">
                <div className="h-1.5 w-20 rounded bg-zinc-700">
                  <div
                    className="h-full rounded bg-purple-500 transition-[width]"
                    style={{ width: `${(b.progress / BREW_TIME) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground">{outName ? `→ ${outName}` : ''}</span>
              </div>
              <div className="flex gap-1">
                {b.potions.map((p, i) => (
                  <button key={i} onClick={() => brewingTakePotion(i)} title="取出药水">
                    <SlotView label={`药水${i + 1}`} stack={p} />
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-md border p-3">
              <SlotView label="燃料（烈焰粉）" stack={b.fuel} />
              {b.burnLeft > 0 && <span className="text-xs text-purple-400">可酿 {b.burnLeft} 轮</span>}
            </div>
            <div className="grid grid-cols-9 gap-1">
              {slots.map((slot, i) => {
                if (!slot) return <div key={i} className="h-9 w-9 rounded border border-white/10 bg-black/20" />;
                const usable =
                  slot.kind === 'material' &&
                  (slot.material === 'blaze_powder' || BREW_INGREDIENTS.includes(slot.material) || POTIONS[slot.material] !== undefined);
                const tile =
                  slot.kind === 'block'
                    ? BLOCKS[slot.id].side
                    : slot.kind === 'material'
                      ? materialTile(slot.material)
                      : slot.kind === 'tool'
                        ? TOOLS[slot.tool].iconTile
                        : armorDefOf(slot).iconTile;
                const name = slot.kind === 'block' ? BLOCKS[slot.id].name : slot.kind === 'material' ? materialName(slot.material) : slot.kind === 'tool' ? TOOLS[slot.tool].name : armorDefOf(slot).name;
                return (
                  <button
                    key={i}
                    disabled={!usable}
                    onClick={() => brewingPut(i)}
                    title={name}
                    className="relative h-9 w-9 rounded border border-white/20 bg-black/30 disabled:opacity-30"
                  >
                    <TileIcon tile={tile} size={28} className="mx-auto" />
                    {slot.kind !== 'tool' && slot.kind !== 'armor' && slot.count > 1 && (
                      <span className="absolute bottom-0 right-0.5 text-[10px] font-bold text-white">
                        {slot.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
