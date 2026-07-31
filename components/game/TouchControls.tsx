'use client';

import { useEffect, useRef, useState, type TouchEvent } from 'react';
import { tryPlace } from '@/lib/actions';
import { touchInput } from '@/lib/game';
import { useGameStore } from '@/lib/store';
import { Button } from '@/components/ui/button';

const JOY_RADIUS = 44; // 摇杆活动半径 px
const PLACE_INTERVAL = 150; // 按住连放间隔，对齐 lib/actions.ts 的 PLACE_COOLDOWN

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
  /** 按住「放」的连放定时器 */
  const placeTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // 潜行/冲刺是切换开关（非按住），本地 state 驱动按钮激活态，touchInput 供 Player 每帧读取
  const [sneakOn, setSneakOn] = useState(false);
  const [sprintOn, setSprintOn] = useState(false);

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

  // 潜行/冲刺互斥（MC：潜行时不冲刺），切换时自动关掉另一个
  const toggleSneak = () => {
    const next = !sneakOn;
    setSneakOn(next);
    touchInput.sneak = next;
    if (next && sprintOn) {
      setSprintOn(false);
      touchInput.sprint = false;
    }
  };
  const toggleSprint = () => {
    const next = !sprintOn;
    setSprintOn(next);
    touchInput.sprint = next;
    if (next && sneakOn) {
      setSneakOn(false);
      touchInput.sneak = false;
    }
  };

  // —— 按住连放：按下立即放一次，随后按放置冷却间隔连放，松开/取消停止 ——
  const stopPlace = () => {
    if (placeTimer.current !== null) {
      clearInterval(placeTimer.current);
      placeTimer.current = null;
    }
  };
  const startPlace = () => {
    if (placeTimer.current !== null) return;
    tryPlace();
    placeTimer.current = setInterval(tryPlace, PLACE_INTERVAL);
  };

  // 卸载时清空输入与定时器，避免状态带进下一局
  useEffect(
    () => () => {
      touchInput.moveX = 0;
      touchInput.moveY = 0;
      touchInput.jump = false;
      touchInput.down = false;
      touchInput.dig = false;
      touchInput.sneak = false;
      touchInput.sprint = false;
      if (placeTimer.current !== null) {
        clearInterval(placeTimer.current);
        placeTimer.current = null;
      }
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

      {/* 虚拟摇杆（touch-joy-pos 含 safe-area 偏移） */}
      <div
        ref={joyBase}
        className="touch-joy-pos absolute h-28 w-28 rounded-full border-2 border-white/40 bg-black/30"
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

      {/* 动作按钮（touch-actions-pos 含 safe-area 偏移） */}
      <div
        className="touch-actions-pos absolute flex flex-col items-end gap-2"
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
        {/* 潜行/冲刺切换（点按开/关；互斥，对齐 MC 潜行时不冲刺） */}
        <div className="flex gap-2">
          <Button
            variant="secondary"
            className={`h-10 w-10 rounded-full ${
              sneakOn ? 'bg-emerald-600/80 text-white ring-2 ring-emerald-300 hover:bg-emerald-600/70' : ''
            }`}
            onTouchStart={toggleSneak}
          >
            潜
          </Button>
          <Button
            variant="secondary"
            className={`h-10 w-10 rounded-full ${
              sprintOn ? 'bg-amber-500/80 text-white ring-2 ring-amber-300 hover:bg-amber-500/70' : ''
            }`}
            onTouchStart={toggleSprint}
          >
            冲
          </Button>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" className="h-12 w-12 rounded-full" {...holdProps('dig')}>
            挖
          </Button>
          <Button
            variant="secondary"
            className="h-12 w-12 rounded-full"
            onTouchStart={startPlace}
            onTouchEnd={stopPlace}
            onTouchCancel={stopPlace}
          >
            放
          </Button>
        </div>
        <Button variant="secondary" className="h-14 w-14 rounded-full text-lg" {...holdProps('jump')}>
          跳
        </Button>
      </div>

      {/* 返回主菜单（WorldRenderer 卸载时自动存档）；MC widgets 按钮（min-height 40px，touch-menu-pos 含 safe-area 偏移） */}
      <button className="mc-btn touch-menu-pos absolute" onClick={backToMenu}>
        菜单
      </button>
    </div>
  );
}
