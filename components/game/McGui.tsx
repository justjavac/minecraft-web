'use client';

// MC Java GUI 共享框架：Faithful container 纹理背景（原始 512 尺寸、352x332 裁剪居中）+ 按 MC 标准坐标（176x166 ×2）absolute 定位的格子。
// 各容器界面（熔炉/容器/酿造/附魔/交易等）复用：提供纹理与坐标，界面只放特有槽与逻辑。
//
// 光标拖拽交互（MC Java 语义）：格子除 onClick 外支持 onPress（pointerdown，带 button/shift）/
// onDragEnter（拖动中进入）/ onDoubleClick；框架层抑制右键菜单；全局 pointerup 由 CursorItem 统一结束拖动。
// 触屏（pointerType === 'touch'）走 beginTouchPress 延迟判定：快速点按 = 左键、长按 = 右键单发、
// 按住移动 = 左键 + 拖动分发（触屏 pointer capture 挡住 pointerenter，用 elementFromPoint hit-test 找格）。

import type { ReactNode } from 'react';
import { BLOCKS } from '@/lib/blocks';
import { materialTile } from '@/lib/materials';
import { withBase } from '@/lib/basepath';
import type { Slot } from '@/lib/slots';
import { useGameStore } from '@/lib/store';
import { createTouchPress, LONG_PRESS_MS, pressMove, pressTimeout, pressUp, type TouchButton, type TouchPressState } from '@/lib/touchGestures';
import { slotDurabilityPct, slotTile } from './slotDisplay';
import { TileIcon } from './TileIcon';

/** MC 格 18px × 2（Faithful 32x 纹理为 176×166 的 2 倍） */
export const G = 36;

/** 27 背包（(8,84)×2 起，3 行 9 列） */
export const invX = (i: number) => 16 + (i % 9) * G;
export const invY = (i: number) => 168 + Math.floor(i / 9) * G;
/** 9 热键栏（(8,142)×2 起） */
export const hotX = (i: number) => 16 + i * G;
export const HOT_Y = 284;

/** 格子按下信息（与 store 的 GuiPressInfo 对应） */
export interface SlotPress {
  button: number;
  shift: boolean;
}

// ——— 触屏手势协调（长按 = 右键单发、按住移动 = 左键 + 拖动分发）———
// 触屏 pointer capture 会把 pointermove/enter 全部钉在按下格上，其他格收不到 pointerenter；
// 这里在按下后挂 window 监听，用 document.elementFromPoint 找当前所在格（data-mc-slot 标记 + WeakMap 回调）。
/** 格子元素 → onDragEnter 回调（ref 登记，随渲染刷新；WeakMap 不阻碍回收） */
const dragEnterByEl = new WeakMap<Element, () => void>();

interface ActiveTouchPress {
  pointerId: number;
  startX: number;
  startY: number;
  state: TouchPressState;
  timer: ReturnType<typeof setTimeout> | null;
  fire: (button: TouchButton) => void;
  lastHit: Element | null;
}

/** 进行中的触屏按压（单指手势；第二指按下直接忽略） */
let activePress: ActiveTouchPress | null = null;

/** 拖动中 hit-test：坐标 → 所在格，去重后调其 onDragEnter（走 store.slotDragEnter 通道） */
function hitDragEnter(t: ActiveTouchPress, x: number, y: number) {
  const el = document.elementFromPoint(x, y)?.closest('[data-mc-slot]') ?? null;
  if (el === t.lastHit) return;
  t.lastHit = el;
  if (el) dragEnterByEl.get(el)?.();
}

/** 触屏按下：不立即分发，先挂起等待定案（点按=左键 / 长按=右键 / 移动=左键+拖动）；桌面 pointer 路径不走这里 */
function beginTouchPress(e: { pointerId: number; clientX: number; clientY: number }, fire: (button: TouchButton) => void): void {
  if (activePress) return;
  const t: ActiveTouchPress = {
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    state: createTouchPress(),
    timer: null,
    fire,
    lastHit: null,
  };
  activePress = t;
  t.timer = setTimeout(() => {
    const b = pressTimeout(t.state);
    if (b !== null) t.fire(b);
  }, LONG_PRESS_MS);
  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== t.pointerId || activePress !== t) return;
    if (t.state.resolved === null) {
      const b = pressMove(t.state, ev.clientX - t.startX, ev.clientY - t.startY);
      if (b !== null) t.fire(b);
    }
    // 已定案（左键拖动 / 长按后的右键拖动）：分发经过的格子（store 内部对起始格与重复格去重）
    if (t.state.resolved !== null) hitDragEnter(t, ev.clientX, ev.clientY);
  };
  const finish = (ev: PointerEvent, cancelled: boolean) => {
    if (ev.pointerId !== t.pointerId || activePress !== t) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    if (t.timer) clearTimeout(t.timer);
    activePress = null;
    if (!cancelled) {
      const b = pressUp(t.state);
      if (b !== null) {
        t.fire(b);
        // 点按在抬起时才结算按下：CursorItem 的全局 pointerup 已先跑过（dragEnd 落空），
        // 补一次 dragEnd 让「光标有物时的按下 pending」立即按普通点击结算（放/合并/交换）
        useGameStore.getState().dragEnd();
      }
      // 已定案的抬起（拖动结束 / 长按后抬起）：由 CursorItem 的全局 pointerup 统一 dragEnd
    } else if (t.state.resolved !== null) {
      // 长按/拖动已触发后系统取消（pointercancel）：CursorItem 不监听 cancel，补 dragEnd 避免 pending 残留
      useGameStore.getState().dragEnd();
    }
  };
  const onUp = (ev: PointerEvent) => finish(ev, false);
  const onCancel = (ev: PointerEvent) => finish(ev, true);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
}

/** 格子按下统一入口：触屏走延迟判定，鼠标/笔保持按下即分发（桌面路径不变） */
function slotPointerDown(e: { pointerType: string; pointerId: number; clientX: number; clientY: number; button: number; shiftKey: boolean }, onPress: (info: SlotPress) => void): void {
  if (e.pointerType === 'touch') beginTouchPress(e, (button) => onPress({ button, shift: false }));
  else onPress({ button: e.button, shift: e.shiftKey });
}

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
    <div
      className={`relative select-none overflow-hidden ${centered ? 'mx-auto' : ''}`}
      style={{ width, height }}
      // 界面内抑制系统右键菜单（右键是 MC 交互的一半：半取/单放/逐格分发）
      onContextMenu={(e) => e.preventDefault()}
    >
      <img
        src={withBase(texture)}
        alt=""
        draggable={false}
        className="absolute left-0 top-0 max-w-none select-none [image-rendering:pixelated]"
        style={{ width: imgW, height: imgH }}
      />
      {children}
    </div>
  );
}

/** 通用 absolute 物品格（图标 + 数量 + 点击/光标拖拽），对齐纹理格子 */
export function GuiSlot({
  pos,
  slot,
  onClick,
  onPress,
  onDragEnter,
  onDoubleClick,
  title,
  disabled,
}: {
  pos: [number, number];
  slot: Slot;
  /** 旧式单击（整格操作）；与 onPress 二选一，不要同时传 */
  onClick?: () => void;
  /** 光标拖拽：pointerdown（左/右/shift；触屏延迟判定：点按=左键、长按=右键、移动=左键+拖动） */
  onPress?: (info: SlotPress) => void;
  /** 光标拖拽：拖动中进入此格（分发/逐格放一；桌面走 pointerenter，触屏走 elementFromPoint hit-test） */
  onDragEnter?: () => void;
  /** 双击（光标有物时收集同类） */
  onDoubleClick?: () => void;
  title?: string;
  disabled?: boolean;
}) {
  const tile = slotTile(slot);
  /** 工具/装备耐久比例（其余 null 不显示耐久条） */
  const pct = slotDurabilityPct(slot);
  return (
    <button
      ref={onDragEnter ? (el) => { if (el) dragEnterByEl.set(el, onDragEnter); } : undefined}
      data-mc-slot={onDragEnter ? '' : undefined}
      onClick={onClick}
      onPointerDown={onPress ? (e) => slotPointerDown(e, onPress) : undefined}
      onPointerEnter={onDragEnter}
      onDoubleClick={onDoubleClick}
      title={title}
      disabled={disabled}
      className="absolute flex items-center justify-center disabled:opacity-30"
      // touchAction none：格子上禁浏览器滚动/缩放手势（拖动分发不被抢走）；callout none：禁 iOS 长按弹窗
      style={{ left: pos[0], top: pos[1], width: G, height: G, touchAction: 'none', WebkitTouchCallout: 'none' }}
    >
      {slot && <TileIcon tile={tile} size={30} blockId={slot.kind === 'block' ? slot.id : undefined} />}
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

/** 'block:X' 材料串 → 方块 id（3D 图标用；非方块返回 undefined） */
function stackBlockId(item: string): number | undefined {
  return item.startsWith('block:') ? Number(item.slice(6)) : undefined;
}

/** 熔炉/酿造槽格（absolute）：{ item, count } 图标 + 数量 + 光标拖拽（熔炉烧炼物/燃料/产出，酿造材料/药水/燃料） */
export function AbsSlot({
  pos,
  stack,
  onClick,
  onPress,
}: {
  pos: [number, number];
  stack: { item: string; count: number } | null;
  onClick?: () => void;
  /** 光标拖拽：pointerdown（左/右/shift）。产出槽等「只能取」的格子由 action 层保证 */
  onPress?: (info: SlotPress) => void;
}) {
  return (
    <button
      onClick={onClick}
      onPointerDown={onPress ? (e) => slotPointerDown(e, onPress) : undefined}
      className="absolute flex items-center justify-center"
      style={{ left: pos[0], top: pos[1], width: G, height: G, touchAction: 'none', WebkitTouchCallout: 'none' }}
    >
      {stack && <TileIcon tile={stackTile(stack.item)} size={30} blockId={stackBlockId(stack.item)} />}
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
  onSlotPress,
  onSlotDragEnter,
  onSlotDoubleClick,
}: {
  slots: Slot[];
  onSlotClick?: (index: number) => void;
  onSlotPress?: (index: number, info: SlotPress) => void;
  onSlotDragEnter?: (index: number) => void;
  onSlotDoubleClick?: (index: number) => void;
}) {
  return (
    <>
      {slots.map((slot, i) => (
        <GuiSlot
          key={i}
          pos={[invX(i), invY(i)]}
          slot={slot}
          onClick={onSlotClick ? () => onSlotClick(i) : undefined}
          onPress={onSlotPress ? (info) => onSlotPress(i, info) : undefined}
          onDragEnter={onSlotDragEnter ? () => onSlotDragEnter(i) : undefined}
          onDoubleClick={onSlotDoubleClick ? () => onSlotDoubleClick(i) : undefined}
        />
      ))}
    </>
  );
}

/** 9 热键栏格（hotbarSlots） */
export function GuiHotbarSlots({
  slots,
  onSlotClick,
  onSlotPress,
  onSlotDragEnter,
  onSlotDoubleClick,
}: {
  slots: Slot[];
  onSlotClick?: (index: number) => void;
  onSlotPress?: (index: number, info: SlotPress) => void;
  onSlotDragEnter?: (index: number) => void;
  onSlotDoubleClick?: (index: number) => void;
}) {
  return (
    <>
      {slots.map((slot, i) => (
        <GuiSlot
          key={i}
          pos={[hotX(i), HOT_Y]}
          slot={slot}
          onClick={onSlotClick ? () => onSlotClick(i) : undefined}
          onPress={onSlotPress ? (info) => onSlotPress(i, info) : undefined}
          onDragEnter={onSlotDragEnter ? () => onSlotDragEnter(i) : undefined}
          onDoubleClick={onSlotDoubleClick ? () => onSlotDoubleClick(i) : undefined}
        />
      ))}
    </>
  );
}
