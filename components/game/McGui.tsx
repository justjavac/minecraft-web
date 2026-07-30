'use client';

// MC Java GUI 共享框架：Faithful container 纹理背景（原始 512 尺寸、352x332 裁剪居中）+ 按 MC 标准坐标（176x166 ×2）absolute 定位的格子。
// 各容器界面（熔炉/容器/酿造/附魔/交易等）复用：提供纹理与坐标，界面只放特有槽与逻辑。

import type { ReactNode } from 'react';
import { BLOCKS } from '@/lib/blocks';
import { armorDefOf } from '@/lib/armor';
import { materialTile } from '@/lib/materials';
import { TOOLS } from '@/lib/tools';
import type { Slot } from '@/lib/slots';
import { TileIcon } from './TileIcon';

/** MC 格 18px × 2（Faithful 32x 纹理为 176×166 的 2 倍） */
export const G = 36;

/** 27 背包（(8,84)×2 起，3 行 9 列） */
export const invX = (i: number) => 16 + (i % 9) * G;
export const invY = (i: number) => 168 + Math.floor(i / 9) * G;
/** 9 热键栏（(8,142)×2 起） */
export const hotX = (i: number) => 16 + i * G;
export const HOT_Y = 284;

/** GUI 框架：container 纹理背景（原始 512 不拉伸，352x332 裁剪面板，mx-auto 屏幕居中），children 放特有槽 */
export function McGuiFrame({ texture, children }: { texture: string; children: ReactNode }) {
  return (
    <div className="relative mx-auto select-none overflow-hidden" style={{ width: 352, height: 332 }}>
      <img
        src={texture}
        alt=""
        draggable={false}
        className="absolute left-0 top-0 max-w-none select-none [image-rendering:pixelated]"
        style={{ width: 512, height: 512 }}
      />
      {children}
    </div>
  );
}

/** 通用 absolute 物品格（图标 + 数量 + 点击），对齐纹理格子 */
export function GuiSlot({
  pos,
  slot,
  onClick,
  title,
}: {
  pos: [number, number];
  slot: Slot;
  onClick?: () => void;
  title?: string;
}) {
  const tile = !slot
    ? 0
    : slot.kind === 'block'
      ? BLOCKS[slot.id].side
      : slot.kind === 'material'
        ? materialTile(slot.material)
        : slot.kind === 'tool'
          ? TOOLS[slot.tool].iconTile
          : armorDefOf(slot).iconTile;
  return (
    <button
      onClick={onClick}
      title={title}
      className="absolute flex items-center justify-center"
      style={{ left: pos[0], top: pos[1], width: G, height: G }}
    >
      {slot && <TileIcon tile={tile} size={30} />}
      {slot && slot.kind !== 'tool' && slot.kind !== 'armor' && slot.count > 1 && (
        <span className="pointer-events-none absolute bottom-0 right-0.5 text-[10px] font-bold text-white drop-shadow">{slot.count}</span>
      )}
    </button>
  );
}

/** 27 背包格（mainSlots） */
export function GuiMainSlots({
  slots,
  onSlotClick,
}: {
  slots: Slot[];
  onSlotClick?: (index: number) => void;
}) {
  return (
    <>
      {slots.map((slot, i) => (
        <GuiSlot key={i} pos={[invX(i), invY(i)]} slot={slot} onClick={onSlotClick ? () => onSlotClick(i) : undefined} />
      ))}
    </>
  );
}

/** 9 热键栏格（hotbarSlots） */
export function GuiHotbarSlots({
  slots,
  onSlotClick,
}: {
  slots: Slot[];
  onSlotClick?: (index: number) => void;
}) {
  return (
    <>
      {slots.map((slot, i) => (
        <GuiSlot key={i} pos={[hotX(i), HOT_Y]} slot={slot} onClick={onSlotClick ? () => onSlotClick(i) : undefined} />
      ))}
    </>
  );
}
