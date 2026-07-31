'use client';

import { getStorage } from '@/lib/storage';
import { useGameStore } from '@/lib/store';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { GuiSlot, McGuiFrame } from './McGui';

/** 容器界面（箱子/木桶）：27 格容器 + 27 背包 + 9 热键栏。
 *  MC Java 光标拖拽：左键拿放/合并/交换，右键半取/单放，shift 快移（容器↔背包/热键栏），
 *  拖动分发（容器格参与），双击收集（含容器格）。容器内容不走 store 字段：订阅 guiTick 重渲染 */
export function StorageDialog() {
  const storageKey = useGameStore((s) => s.storageOpen);
  const setOpen = useGameStore((s) => s.setStorageOpen);
  const hotbarSlots = useGameStore((s) => s.hotbarSlots);
  const mainSlots = useGameStore((s) => s.mainSlots);
  const slotMouseDown = useGameStore((s) => s.slotMouseDown);
  const slotDragEnter = useGameStore((s) => s.slotDragEnter);
  const slotDoubleClick = useGameStore((s) => s.slotDoubleClick);
  // 容器内容（lib/storage storages map）变化不走 zustand 字段：guiTick 计数驱动重渲染
  useGameStore((s) => s.guiTick);

  if (!storageKey) return null;
  const storage = getStorage(storageKey);

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
              onPress={(info) => slotMouseDown('storage', i, info)}
              onDragEnter={() => slotDragEnter('storage', i)}
              onDoubleClick={() => slotDoubleClick('storage', i)}
            />
          ))}
          {mainSlots.map((slot, i) => (
            <GuiSlot
              key={'m' + i}
              pos={[16 + (i % 9) * 36, 166 + Math.floor(i / 9) * 36]}
              slot={slot}
              onPress={(info) => slotMouseDown('main', i, info)}
              onDragEnter={() => slotDragEnter('main', i)}
              onDoubleClick={() => slotDoubleClick('main', i)}
            />
          ))}
          {hotbarSlots.map((slot, i) => (
            <GuiSlot
              key={'h' + i}
              pos={[16 + i * 36, 282]}
              slot={slot}
              onPress={(info) => slotMouseDown('hotbar', i, info)}
              onDragEnter={() => slotDragEnter('hotbar', i)}
              onDoubleClick={() => slotDoubleClick('hotbar', i)}
            />
          ))}
        </McGuiFrame>
      </DialogContent>
    </Dialog>
  );
}
