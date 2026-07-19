'use client';

import { useState } from 'react';
import { getStorage } from '@/lib/storage';
import { useGameStore } from '@/lib/store';
import type { Slot } from '@/lib/slots';
import { slotCount, slotName, slotTile } from './slotDisplay';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TileIcon } from './TileIcon';

function Cell({ slot, onClick }: { slot: Slot; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={slotName(slot)}
      className="relative h-9 w-9 rounded border border-white/20 bg-black/30 hover:border-white/50"
    >
      {slot && (
        <>
          <TileIcon tile={slotTile(slot)} size={28} className="mx-auto" />
          {slotCount(slot) > 1 && (
            <span className="absolute bottom-0 right-0.5 text-[10px] font-bold text-white">{slotCount(slot)}</span>
          )}
        </>
      )}
    </button>
  );
}

/** 容器界面（箱子/木桶）：27 格容器 + 27 背包 + 9 热键栏，点击互相转移整叠 */
export function StorageDialog() {
  const storageKey = useGameStore((s) => s.storageOpen);
  const setOpen = useGameStore((s) => s.setStorageOpen);
  const hotbarSlots = useGameStore((s) => s.hotbarSlots);
  const mainSlots = useGameStore((s) => s.mainSlots);
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
          <DialogDescription>点击物品在物品栏与容器之间转移（整叠）</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-9 gap-1 rounded-md border p-2">
            {storage.map((slot, i) => (
              <Cell
                key={i}
                slot={slot}
                onClick={() => {
                  storageTake(i);
                  refresh();
                }}
              />
            ))}
          </div>
          <div className="grid grid-cols-9 gap-1 rounded-md border p-2">
            {mainSlots.map((slot, i) => (
              <Cell
                key={i}
                slot={slot}
                onClick={() => {
                  storagePut('main', i);
                  refresh();
                }}
              />
            ))}
          </div>
          <div className="grid grid-cols-9 gap-1 rounded-md border border-white/40 p-2">
            {hotbarSlots.map((slot, i) => (
              <Cell
                key={i}
                slot={slot}
                onClick={() => {
                  storagePut('hotbar', i);
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
