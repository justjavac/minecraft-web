'use client';

import { useEffect, useRef, type TouchEvent } from 'react';
import { tryPlace } from '@/lib/actions';
import { touchInput } from '@/lib/game';
import { useGameStore } from '@/lib/store';
import { Button } from '@/components/ui/button';

const JOY_RADIUS = 44; // 摇杆活动半径 px

/**
 * 触屏控制层：左下虚拟摇杆移动，其余区域拖动转视角，右侧动作按钮。
 * 通过多点触控 identifier 分别追踪摇杆指和视角指。
 */
export function TouchControls() {
  const flying = useGameStore((s) => s.flying);
  const worldMode = useGameStore((s) => s.worldMode);
  const backToMenu = useGameStore((s) => s.backToMenu);

  const lookId = useRef<number | null>(null);
  const lookLast = useRef({ x: 0, y: 0 });
  const joyId = useRef<number | null>(null);
  const joyCenter = useRef({ x: 0, y: 0 });
  const joyBase = useRef<HTMLDivElement>(null);
  const joyKnob = useRef<HTMLDivElement>(null);

  // —— 视角拖动（全屏底层） ——
  const onLookStart = (e: TouchEvent<HTMLDivElement>) => {
    if (lookId.current !== null) return;
    const t = e.changedTouches[0];
    lookId.current = t.identifier;
    lookLast.current = { x: t.clientX, y: t.clientY };
  };
  const onLookMove = (e: TouchEvent<HTMLDivElement>) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier !== lookId.current) continue;
      touchInput.lookDX += t.clientX - lookLast.current.x;
      touchInput.lookDY += t.clientY - lookLast.current.y;
      lookLast.current = { x: t.clientX, y: t.clientY };
    }
  };
  const onLookEnd = (e: TouchEvent<HTMLDivElement>) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === lookId.current) lookId.current = null;
    }
  };

  // —— 虚拟摇杆 ——
  const setKnob = (dx: number, dy: number) => {
    joyKnob.current?.style.setProperty(
      'transform',
      `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`,
    );
  };
  const applyJoy = (clientX: number, clientY: number) => {
    let dx = clientX - joyCenter.current.x;
    let dy = clientY - joyCenter.current.y;
    const len = Math.hypot(dx, dy);
    if (len > JOY_RADIUS) {
      dx = (dx / len) * JOY_RADIUS;
      dy = (dy / len) * JOY_RADIUS;
    }
    touchInput.moveX = dx / JOY_RADIUS;
    touchInput.moveY = -dy / JOY_RADIUS; // 上推 = 前进
    setKnob(dx, dy);
  };
  const onJoyStart = (e: TouchEvent<HTMLDivElement>) => {
    if (joyId.current !== null) return;
    const t = e.changedTouches[0];
    joyId.current = t.identifier;
    const rect = joyBase.current?.getBoundingClientRect();
    if (rect) {
      joyCenter.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    applyJoy(t.clientX, t.clientY);
  };
  const onJoyMove = (e: TouchEvent<HTMLDivElement>) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier !== joyId.current) continue;
      applyJoy(t.clientX, t.clientY);
    }
  };
  const onJoyEnd = (e: TouchEvent<HTMLDivElement>) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier !== joyId.current) continue;
      joyId.current = null;
      touchInput.moveX = 0;
      touchInput.moveY = 0;
      setKnob(0, 0);
    }
  };

  /** 按住型按钮（跳/降/挖） */
  const holdProps = (key: 'jump' | 'down' | 'dig') => ({
    onTouchStart: () => {
      touchInput[key] = true;
    },
    onTouchEnd: () => {
      touchInput[key] = false;
    },
    onTouchCancel: () => {
      touchInput[key] = false;
    },
  });

  // 卸载时清空输入，避免状态带进下一局
  useEffect(
    () => () => {
      touchInput.moveX = 0;
      touchInput.moveY = 0;
      touchInput.jump = false;
      touchInput.down = false;
      touchInput.dig = false;
    },
    [],
  );

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-10 select-none"
      style={{ touchAction: 'none' }}
    >
      {/* 视角拖动层（全屏最底层，按钮/摇杆/热键栏在其上方拦截各自触摸） */}
      <div
        className="absolute inset-0"
        onTouchStart={onLookStart}
        onTouchMove={onLookMove}
        onTouchEnd={onLookEnd}
        onTouchCancel={onLookEnd}
      />

      {/* 虚拟摇杆 */}
      <div
        ref={joyBase}
        className="absolute bottom-24 left-4 h-28 w-28 rounded-full border-2 border-white/40 bg-black/30"
        onTouchStart={onJoyStart}
        onTouchMove={onJoyMove}
        onTouchEnd={onJoyEnd}
        onTouchCancel={onJoyEnd}
      >
        <div
          ref={joyKnob}
          className="absolute left-1/2 top-1/2 h-12 w-12 rounded-full bg-white/60"
          style={{ transform: 'translate(-50%, -50%)' }}
        />
      </div>

      {/* 动作按钮 */}
      <div
        className="absolute bottom-24 right-3 flex flex-col items-end gap-2"
        style={{ touchAction: 'manipulation' }}
      >
        {worldMode === 'creative' && (
          <Button
            variant="secondary"
            className="h-10 rounded-full px-4"
            onTouchStart={() => useGameStore.getState().toggleFly()}
          >
            {flying ? '落地' : '飞行'}
          </Button>
        )}
        {flying && (
          <Button variant="secondary" className="h-10 rounded-full px-4" {...holdProps('down')}>
            降
          </Button>
        )}
        <div className="flex gap-2">
          <Button variant="secondary" className="h-12 w-12 rounded-full" {...holdProps('dig')}>
            挖
          </Button>
          <Button
            variant="secondary"
            className="h-12 w-12 rounded-full"
            onTouchStart={() => tryPlace()}
          >
            放
          </Button>
        </div>
        <Button variant="secondary" className="h-14 w-14 rounded-full text-lg" {...holdProps('jump')}>
          跳
        </Button>
      </div>

      {/* 返回主菜单（WorldRenderer 卸载时自动存档） */}
      <Button variant="outline" size="sm" className="absolute right-2 top-2" onClick={backToMenu}>
        菜单
      </Button>
    </div>
  );
}
