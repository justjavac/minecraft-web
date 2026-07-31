'use client';

import { useEffect, useState } from 'react';
import { BLOCKS } from '@/lib/blocks';
import { FUELS, getFurnace, SMELTING, SMELT_TIME, type FurnaceStack } from '@/lib/furnace';
import { materialName, materialTile } from '@/lib/materials';
import { useGameStore } from '@/lib/store';
import { withBase } from '@/lib/basepath';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { TileIcon } from './TileIcon';
import { slotTile } from './slotDisplay';
import type { Slot } from '@/lib/slots';

/** MC 格 18px × 2（Faithful 32x 纹理为 176×166 的 2 倍） */
const G = 36;
/** 熔炉三槽（furnace.png 内坐标 ×2） */
const SLOT_INPUT: [number, number] = [112, 34];
const SLOT_FUEL: [number, number] = [112, 106];
const SLOT_OUTPUT: [number, number] = [232, 70];
/** 进度箭头 / 火焰区（×2） */
const ARROW: [number, number, number, number] = [158, 68, 44, 34];
const FLAME: [number, number, number, number] = [112, 74, 28, 28];
/** 背包 9 格热键栏（(8,142)×2 起） */
const hotX = (i: number) => 16 + i * G;
const HOT_Y = 284;

function itemName(item: string): string {
  const [kind, idStr] = item.split(':');
  return kind === 'block' ? BLOCKS[Number(idStr)].name : materialName(idStr);
}

function itemTile(item: string): number {
  const [kind, idStr] = item.split(':');
  return kind === 'block' ? BLOCKS[Number(idStr)].side : materialTile(idStr);
}

/** 熔炉槽（absolute 定位到 furnace.png 格子上）：图标 + 数量 */
function AbsSlot({ pos, stack, onClick }: { pos: [number, number]; stack: FurnaceStack | null; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="absolute flex items-center justify-center"
      style={{ left: pos[0], top: pos[1], width: G, height: G }}
    >
      {stack && <TileIcon tile={itemTile(stack.item)} size={30} />}
      {stack && stack.count > 1 && (
        <span className="absolute bottom-0 right-0.5 text-[10px] font-bold text-white drop-shadow">{stack.count}</span>
      )}
    </button>
  );
}

/** 热键栏格（absolute 定位）：图标 + 数量 + 点击放入；双重身份物品给「燃 / 烧」两去向 */
function AbsInvSlot({ pos, slot, index }: { pos: [number, number]; slot: Slot; index: number }) {
  const furnacePut = useGameStore((s) => s.furnacePut);
  const item =
    slot?.kind === 'block' ? `block:${slot.id}` : slot?.kind === 'material' ? `material:${slot.material}` : null;
  const usable = item !== null && (FUELS[item] !== undefined || SMELTING[item] !== undefined);
  const both = item !== null && FUELS[item] !== undefined && SMELTING[item] !== undefined;
  const tile = slotTile(slot);
  return (
    <div className="absolute" style={{ left: pos[0], top: pos[1], width: G, height: G }}>
      <button
        disabled={slot !== null && !usable}
        onClick={() => furnacePut(index)}
        title={item ? itemName(item) : ''}
        className="flex h-full w-full items-center justify-center disabled:opacity-30"
      >
        {slot && <TileIcon tile={tile} size={30} />}
      </button>
      {slot && slot.kind !== 'tool' && slot.kind !== 'armor' && slot.count > 1 && (
        <span className="pointer-events-none absolute bottom-0 right-0.5 text-[10px] font-bold text-white drop-shadow">{slot.count}</span>
      )}
      {both && (
        <div className="absolute inset-x-0 -bottom-4 z-10 flex justify-center gap-0.5">
          <button onClick={() => furnacePut(index, 'fuel')} className="rounded-sm bg-orange-600/90 px-1 text-[9px] leading-3 text-white">
            燃
          </button>
          <button onClick={() => furnacePut(index, 'input')} className="rounded-sm bg-sky-600/90 px-1 text-[9px] leading-3 text-white">
            烧
          </button>
        </div>
      )}
    </div>
  );
}

/** 熔炉界面：烧炼物/燃料/产出三槽 + 进度条 + 背包快捷放入 */
export function FurnaceDialog() {
  const furnaceKey = useGameStore((s) => s.furnaceOpen);
  const setOpen = useGameStore((s) => s.setFurnaceOpen);
  const slots = useGameStore((s) => s.hotbarSlots);
  const takeOutput = useGameStore((s) => s.furnaceTakeOutput);
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
          <div className="relative mx-auto select-none overflow-hidden" style={{ width: 352, height: 332 }}>
            {/* MC 熔炉 GUI：furnace.png 原始 512 尺寸（面板在左上 352x332），容器裁剪不拉伸，格子按 352 坐标对齐 */}
            <img src={withBase('/textures/gui/container/furnace.png')} alt="" draggable={false} className="absolute left-0 top-0 max-w-none select-none [image-rendering:pixelated]" style={{ width: 512, height: 512 }} />
            <AbsSlot pos={SLOT_INPUT} stack={f.input} />
            <AbsSlot pos={SLOT_FUEL} stack={f.fuel} />
            <AbsSlot pos={SLOT_OUTPUT} stack={f.output} onClick={takeOutput} />
            {/* 进度箭头区：按烧炼进度叠加 */}
            <div className="absolute overflow-hidden" style={{ left: ARROW[0], top: ARROW[1], width: ARROW[2], height: ARROW[3] }}>
              <div className="h-full bg-white/60 transition-[width]" style={{ width: `${(f.progress / SMELT_TIME) * 100}%` }} />
            </div>
            {/* 火焰区：燃料燃烧中 */}
            {f.burnLeft > 0 && (
              <div className="absolute rounded-sm bg-orange-500/60" style={{ left: FLAME[0], top: FLAME[1], width: FLAME[2], height: FLAME[3] }} />
            )}
            {slots.map((slot, i) => (
              <AbsInvSlot key={i} pos={[hotX(i), HOT_Y]} slot={slot} index={i} />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
