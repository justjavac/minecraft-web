'use client';

// 光标堆叠跟随件（MC Java）：拿起的物品跟随鼠标渲染在 GUI 层最上方（pointer-events-none），
// 全局 pointerup 统一结束拖动分发（store.dragEnd：未形成拖动则对起始格按普通点击处理）。

import { useEffect, useState } from 'react';
import { useGameStore } from '@/lib/store';
import { slotTile } from './slotDisplay';
import { TileIcon } from './TileIcon';

export function CursorItem() {
  const cursor = useGameStore((s) => s.cursorSlot);
  const dragEnd = useGameStore((s) => s.dragEnd);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      // 仅光标有物时跟踪（避免每次鼠标移动都重渲染）
      if (useGameStore.getState().cursorSlot) setPos({ x: e.clientX, y: e.clientY });
    };
    const up = () => dragEnd();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [dragEnd]);

  if (!cursor || !pos) return null;
  return (
    <div className="pointer-events-none fixed z-[100]" style={{ left: pos.x, top: pos.y, transform: 'translate(-50%,-50%)' }}>
      <TileIcon tile={slotTile(cursor)} size={32} blockId={cursor.kind === 'block' ? cursor.id : undefined} />
      {cursor.kind !== 'tool' && cursor.kind !== 'armor' && cursor.count > 1 && (
        <span className="absolute bottom-0 right-0 text-[10px] font-bold text-white drop-shadow">{cursor.count}</span>
      )}
    </div>
  );
}
