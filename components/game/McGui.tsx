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

/** GUI 框架：container 纹理背景（原始尺寸不拉伸、裁剪面板，mx-auto 屏幕居中），children 放特有槽。
 *  标准面板 352x332（纹理 512x512）；交易台等宽面板用 width/imgW 覆盖（如 villager.png 为 552x332 / 1024x512） */
export function McGuiFrame({
  texture,
  children,
  width = 352,
  height = 332,
  imgW = 512,
  imgH = 512,
  centered = true,
}: {
  texture: string;
  children: ReactNode;
  width?: number;
  height?: number;
  imgW?: number;
  imgH?: number;
  /** false 时取消 mx-auto（与配方书等侧栏并排时由外层 flex 控制布局） */
  centered?: boolean;
}) {
  return (
    <div className={`relative select-none overflow-hidden ${centered ? 'mx-auto' : ''}`} style={{ width, height }}>
      <img
        src={texture}
        alt=""
        draggable={false}
        className="absolute left-0 top-0 max-w-none select-none [image-rendering:pixelated]"
        style={{ width: imgW, height: imgH }}
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
  disabled,
}: {
  pos: [number, number];
  slot: Slot;
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
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
  /** 工具/装备耐久比例（其余 null 不显示耐久条） */
  const pct =
    slot?.kind === 'tool'
      ? slot.durability / TOOLS[slot.tool].durability
      : slot?.kind === 'armor'
        ? slot.durability / armorDefOf(slot).durability
        : null;
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="absolute flex items-center justify-center disabled:opacity-30"
      style={{ left: pos[0], top: pos[1], width: G, height: G }}
    >
      {slot && <TileIcon tile={tile} size={30} />}
      {slot && slot.kind !== 'tool' && slot.kind !== 'armor' && slot.count > 1 && (
        <span className="pointer-events-none absolute bottom-0 right-0.5 text-[10px] font-bold text-white drop-shadow">{slot.count}</span>
      )}
      {pct !== null && pct < 1 && (
        <span className="pointer-events-none absolute bottom-0.5 left-1 right-1 h-0.5 bg-zinc-700">
          <span
            className="block h-full"
            style={{ width: `${pct * 100}%`, backgroundColor: pct > 0.3 ? '#4ade80' : '#ef4444' }}
          />
        </span>
      )}
    </button>
  );
}

/** 材料名 → tile（兼容 'block:X' / 'material:X' 前缀与裸材料名） */
function stackTile(item: string): number {
  if (item.startsWith('block:')) return BLOCKS[Number(item.slice(6))].side;
  if (item.startsWith('material:')) return materialTile(item.slice(9));
  return materialTile(item);
}

/** 熔炉/酿造槽格（absolute）：{ item, count } 图标 + 数量（熔炉烧炼物/燃料/产出，酿造材料/药水/燃料） */
export function AbsSlot({
  pos,
  stack,
  onClick,
}: {
  pos: [number, number];
  stack: { item: string; count: number } | null;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="absolute flex items-center justify-center"
      style={{ left: pos[0], top: pos[1], width: G, height: G }}
    >
      {stack && <TileIcon tile={stackTile(stack.item)} size={30} />}
      {stack && stack.count > 1 && (
        <span className="pointer-events-none absolute bottom-0 right-0.5 text-[10px] font-bold text-white drop-shadow">{stack.count}</span>
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
