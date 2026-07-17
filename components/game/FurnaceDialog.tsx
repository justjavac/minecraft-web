'use client';

import { useEffect, useState } from 'react';
import { BLOCKS } from '@/lib/blocks';
import { FUELS, getFurnace, SMELTING, SMELT_TIME, type FurnaceStack } from '@/lib/furnace';
import { ARMOR_DEFS } from '@/lib/armor';
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

function SlotView({ label, stack }: { label: string; stack: FurnaceStack | null }) {
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

/** 熔炉界面：烧炼物/燃料/产出三槽 + 进度条 + 背包快捷放入 */
export function FurnaceDialog() {
  const furnaceKey = useGameStore((s) => s.furnaceOpen);
  const setOpen = useGameStore((s) => s.setFurnaceOpen);
  const slots = useGameStore((s) => s.hotbarSlots);
  const furnacePut = useGameStore((s) => s.furnacePut);
  const takeOutput = useGameStore((s) => s.furnaceTakeOutput);
  const [, setTick] = useState(0);

  // 烧炼进度连续变化：打开时 250ms 刷新
  useEffect(() => {
    if (!furnaceKey) return;
    const t = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [furnaceKey]);

  const f = furnaceKey ? getFurnace(furnaceKey) : null;
  const smeltDef = f?.input ? SMELTING[f.input.item] : undefined;

  return (
    <Dialog
      open={furnaceKey !== null}
      onOpenChange={(o) => {
        if (!o) setOpen(null);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>熔炉</DialogTitle>
          <DialogDescription>点击背包物品放入：燃料进燃料槽，可烧物进烧炼槽，每件 10 秒</DialogDescription>
        </DialogHeader>
        {f && (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-md border p-3">
              <SlotView label="烧炼物" stack={f.input} />
              <div className="flex flex-col items-center gap-1 px-2">
                <div className="h-1.5 w-20 rounded bg-zinc-700">
                  <div
                    className="h-full rounded bg-orange-500 transition-[width]"
                    style={{ width: `${(f.progress / SMELT_TIME) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground">{smeltDef ? `→ ${smeltDef.name}` : ''}</span>
              </div>
              <button onClick={takeOutput} title="取出产出">
                <SlotView label="产出" stack={f.output} />
              </button>
            </div>
            <div className="flex items-center gap-3 rounded-md border p-3">
              <SlotView label="燃料" stack={f.fuel} />
              {f.burnLeft > 0 && (
                <span className="text-xs text-orange-500">燃烧中 {f.burnLeft.toFixed(0)}s</span>
              )}
            </div>
            <div className="grid grid-cols-9 gap-1">
              {slots.map((slot, i) => {
                if (!slot) return <div key={i} className="h-9 w-9 rounded border border-white/10 bg-black/20" />;
                const item =
                  slot.kind === 'block'
                    ? `block:${slot.id}`
                    : slot.kind === 'material'
                      ? `material:${slot.material}`
                      : null;
                const usable = item !== null && (FUELS[item] !== undefined || SMELTING[item] !== undefined);
                const both = item !== null && FUELS[item] !== undefined && SMELTING[item] !== undefined;
                const tile =
                  slot.kind === 'block'
                    ? BLOCKS[slot.id].side
                    : slot.kind === 'material'
                      ? materialTile(slot.material)
                      : slot.kind === 'tool'
                        ? TOOLS[slot.tool].iconTile
                        : ARMOR_DEFS[slot.piece].iconTile;
                // 双重身份物品（如原木）：提供「燃 / 烧」两个去向按钮
                if (both) {
                  return (
                    <div key={i} className="relative h-9 w-9 rounded border border-white/20 bg-black/30" title={itemName(item)}>
                      <TileIcon tile={tile} size={28} className="mx-auto" />
                      <div className="absolute inset-x-0 bottom-0 flex justify-center gap-0.5">
                        <button onClick={() => furnacePut(i, 'fuel')} className="rounded-sm bg-orange-600/90 px-1 text-[9px] leading-3 text-white">
                          燃
                        </button>
                        <button onClick={() => furnacePut(i, 'input')} className="rounded-sm bg-sky-600/90 px-1 text-[9px] leading-3 text-white">
                          烧
                        </button>
                      </div>
                    </div>
                  );
                }
                return (
                  <button
                    key={i}
                    disabled={!usable}
                    onClick={() => furnacePut(i)}
                    title={item ? itemName(item) : ''}
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
