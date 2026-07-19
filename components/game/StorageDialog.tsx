'use client';

import { useState } from 'react';
import { BLOCKS } from '@/lib/blocks';
import { ARMOR_DEFS } from '@/lib/armor';
import { materialName, materialTile } from '@/lib/materials';
import { getStorage } from '@/lib/storage';
import { useGameStore } from '@/lib/store';
import { TOOLS } from '@/lib/tools';
import type { Slot } from '@/lib/slots';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TileIcon } from './TileIcon';

function slotName(slot: Slot): string {
  if (!slot) return '';
  if (slot.kind === 'block') return BLOCKS[slot.id].name;
  if (slot.kind === 'material') return materialName(slot.material);
  if (slot.kind === 'tool') return TOOLS[slot.tool].name;
  return ARMOR_DEFS[slot.piece].name;
}

function slotTile(slot: Slot): number {
  if (!slot) return 0;
  if (slot.kind === 'block') return BLOCKS[slot.id].side;
  if (slot.kind === 'material') return materialTile(slot.material);
  if (slot.kind === 'tool') return TOOLS[slot.tool].iconTile;
  return ARMOR_DEFS[slot.piece].iconTile;
}

function Cell({ slot, onClick, title }: { slot: Slot; onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="relative h-9 w-9 rounded border border-white/20 bg-black/30 hover:border-white/50"
    >
      {slot && (
        <>
          <TileIcon tile={slotTile(slot)} size={28} className="mx-auto" />
          {slot.kind !== 'tool' && slot.kind !== 'armor' && slot.count > 1 && (
            <span className="absolute bottom-0 right-0.5 text-[10px] font-bold text-white">{slot.count}</span>
          )}
        </>
      )}
    </button>
  );
}

/** 容器界面（箱子/木桶）：27 格容器 + 背包，点击互相转移整叠 */
export function StorageDialog() {
  const storageKey = useGameStore((s) => s.storageOpen);
  const setOpen = useGameStore((s) => s.setStorageOpen);
  const slots = useGameStore((s) => s.hotbarSlots);
  const storagePut = useGameStore((s) => s.storagePut);
  const storageTake = useGameStore((s) => s.storageTake);
  // 容器内容变化不走 store：本地版本号驱动重渲染
  const [, setVer] = useState(0);

  if (!storageKey) return null;
  const storage = getStorage(storageKey);
  const refresh = () => setVer((n) => n + 1);

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) setOpen(null);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>容器</DialogTitle>
          <DialogDescription>点击物品在背包与容器之间转移（整叠）</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-9 gap-1 rounded-md border p-2">
            {storage.map((slot, i) => (
              <Cell
                key={i}
                slot={slot}
                title={slot ? slotName(slot) : ''}
                onClick={() => {
                  storageTake(i);
                  refresh();
                }}
              />
            ))}
          </div>
          <div className="grid grid-cols-9 gap-1 rounded-md border p-2">
            {slots.map((slot, i) => (
              <Cell
                key={i}
                slot={slot}
                title={slot ? slotName(slot) : ''}
                onClick={() => {
                  storagePut(i);
                  refresh();
                }}
              />
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
