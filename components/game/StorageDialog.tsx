'use client';

import { useState } from 'react';
import { getStorage } from '@/lib/storage';
import { useGameStore } from '@/lib/store';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { GuiSlot, McGuiFrame } from './McGui';

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
      <DialogContent className="border-0 bg-transparent p-0 shadow-none sm:max-w-none">
        {/* MC 容器 GUI：shulker_box.png 纹理（27 格容器 + 背包 + 热键栏），格子按 MC 坐标 absolute 对齐 */}
        <McGuiFrame texture="/textures/gui/container/shulker_box.png">
          {storage.map((slot, i) => (
            <GuiSlot
              key={'c' + i}
              pos={[16 + (i % 9) * 36, 34 + Math.floor(i / 9) * 36]}
              slot={slot}
              onClick={() => {
                storageTake(i);
                refresh();
              }}
            />
          ))}
          {mainSlots.map((slot, i) => (
            <GuiSlot
              key={'m' + i}
              pos={[16 + (i % 9) * 36, 166 + Math.floor(i / 9) * 36]}
              slot={slot}
              onClick={() => {
                storagePut('main', i);
                refresh();
              }}
            />
          ))}
          {hotbarSlots.map((slot, i) => (
            <GuiSlot
              key={'h' + i}
              pos={[16 + i * 36, 282]}
              slot={slot}
              onClick={() => {
                storagePut('hotbar', i);
                refresh();
              }}
            />
          ))}
        </McGuiFrame>
      </DialogContent>
    </Dialog>
  );
}
