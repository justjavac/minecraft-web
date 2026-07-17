'use client';

import { useEffect, useRef, useState } from 'react';
import { BLOCKS, HOTBAR_BLOCKS } from '@/lib/blocks';
import { debugInfo, survivalStats } from '@/lib/game';
import { clearMobs } from '@/lib/mobs';
import { MAX_HEALTH, MAX_HUNGER, MAX_SATURATION, useGameStore } from '@/lib/store';
import { loadWorldMeta, type WorldMeta } from '@/lib/persistence';
import { armorPoints, ARMOR_DEFS } from '@/lib/armor';
import { materialName, materialTile } from '@/lib/materials';
import { TOOLS } from '@/lib/tools';
import type { Slot } from '@/lib/slots';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TouchControls } from './TouchControls';
import { SettingsDialog } from './SettingsDialog';
import { CraftingDialog } from './CraftingDialog';
import { FurnaceDialog } from './FurnaceDialog';
import { TileIcon } from './TileIcon';

/** 一排 10 格像素计量条（心/鸡腿），支持半格 */
function Meter({ value, color }: { value: number; color: string }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 10 }, (_, i) => {
        const v = value - i * 2;
        return (
          <div
            key={i}
            className="h-2.5 w-2.5 rounded-[2px] drop-shadow"
            style={{
              backgroundColor: v >= 2 ? color : 'rgba(63,63,70,0.55)',
              backgroundImage:
                v === 1 ? `linear-gradient(to right, ${color} 50%, rgba(63,63,70,0.55) 50%)` : undefined,
            }}
          />
        );
      })}
    </div>
  );
}

const CELL_CLASS =
  'relative flex h-9 w-9 cursor-pointer items-center justify-center rounded border bg-black/30 transition-transform duration-100 sm:h-12 sm:w-12';

/** 创造模式热键栏格子：固定方块图标 */
function HotbarCell({ index, active, onClick, title, icon }: { index: number; active: boolean; onClick: () => void; title: string; icon: string }) {
  return (
    <div
      title={title}
      onClick={onClick}
      className={`${CELL_CLASS} ${active ? '-translate-y-0.5 scale-110 border-white ring-2 ring-white/70' : 'border-white/30'}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/textures/${icon}`} alt={title} className="h-7 w-7 [image-rendering:pixelated] sm:h-9 sm:w-9" />
      <span className="absolute left-0.5 top-0 text-[10px] leading-3 text-white/70">{index + 1}</span>
    </div>
  );
}

/** 生存模式热键栏格子：方块堆叠 / 材料 / 工具 / 装备（带耐久条） */
function SurvivalCell({ index, slot, active, onClick }: { index: number; slot: Slot; active: boolean; onClick: () => void }) {
  const cls = `${CELL_CLASS} ${active ? '-translate-y-0.5 scale-110 border-white ring-2 ring-white/70' : 'border-white/30'}`;
  if (!slot) {
    return <div onClick={onClick} className={cls} />;
  }
  const tile =
    slot.kind === 'block'
      ? BLOCKS[slot.id].side
      : slot.kind === 'material'
        ? materialTile(slot.material)
        : slot.kind === 'tool'
          ? TOOLS[slot.tool].iconTile
          : ARMOR_DEFS[slot.piece].iconTile;
  const title =
    slot.kind === 'block'
      ? BLOCKS[slot.id].name
      : slot.kind === 'material'
        ? materialName(slot.material)
        : slot.kind === 'tool'
          ? TOOLS[slot.tool].name
          : ARMOR_DEFS[slot.piece].name;
  const durabilityPct =
    slot.kind === 'tool'
      ? slot.durability / TOOLS[slot.tool].durability
      : slot.kind === 'armor'
        ? slot.durability / ARMOR_DEFS[slot.piece].durability
        : null;
  return (
    <div title={title} onClick={onClick} className={cls}>
      <TileIcon tile={tile} size={26} />
      <span className="absolute left-0.5 top-0 text-[10px] leading-3 text-white/70">{index + 1}</span>
      {(slot.kind === 'block' || slot.kind === 'material') && slot.count > 1 && (
        <span className="absolute bottom-0 right-0.5 text-[10px] font-bold leading-3 text-white drop-shadow">
          {slot.count}
        </span>
      )}
      {durabilityPct !== null && (
        <div className="absolute bottom-0.5 left-1 right-1 h-0.5 rounded bg-zinc-700">
          <div
            className="h-full rounded"
            style={{ width: `${durabilityPct * 100}%`, backgroundColor: durabilityPct > 0.3 ? '#4ade80' : '#ef4444' }}
          />
        </div>
      )}
    </div>
  );
}

/** 生存模式护甲 + 血条 + 饥饿条（护甲条在上，与 MC 一致） */
function SurvivalBars() {
  const health = useGameStore((s) => s.health);
  const hunger = useGameStore((s) => s.hunger);
  const armor = useGameStore((s) => armorPoints(s.armorSlots));
  return (
    <div className="absolute bottom-[4.6rem] left-1/2 w-[19.5rem] -translate-x-1/2 space-y-1 sm:w-[28.5rem]">
      {armor > 0 && <Meter value={armor * 2} color="#9ca3af" />}
      <div className="flex justify-between">
        <Meter value={health} color="#ef4444" />
        <Meter value={hunger} color="#d97706" />
      </div>
    </div>
  );
}

/** 死亡遮罩：重生回出生点并清空怪物（物品已掉落在死亡点） */
function DeathOverlay() {
  const respawn = () => {
    const s = useGameStore.getState();
    s.setHealth(MAX_HEALTH);
    s.setHunger(MAX_HUNGER);
    s.setSaturation(MAX_SATURATION);
    s.setDead(false);
    survivalStats.exhaustion = 0;
    clearMobs();
  };
  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-black/70">
      <Card className="w-72">
        <CardHeader>
          <CardTitle className="text-red-500">你死了！</CardTitle>
        </CardHeader>
        <CardContent>
          <Button className="w-full" onClick={respawn}>
            重生
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/** F3 调试面板：250ms 间隔直接写 DOM，避免每帧 React 重渲染 */
function DebugPanel() {
  const ref = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      const el = ref.current;
      if (!el) return;
      el.textContent = [
        `FPS ${debugInfo.fps.toFixed(0)}`,
        `XYZ ${debugInfo.x.toFixed(2)} / ${debugInfo.y.toFixed(2)} / ${debugInfo.z.toFixed(2)}`,
        `Chunk ${Math.floor(debugInfo.x / 16)}, ${Math.floor(debugInfo.z / 16)}`,
        `朝向 ${debugInfo.yaw.toFixed(0)}° · 时刻 ${debugInfo.hour}:00`,
        `已加载 chunk ${debugInfo.chunks} · 待重建 ${debugInfo.dirty}`,
        debugInfo.target ? `目标 ${debugInfo.target}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    }, 250);
    return () => clearInterval(timer);
  }, []);

  return (
    <pre
      ref={ref}
      className="absolute left-2 top-2 m-0 whitespace-pre rounded bg-black/50 p-2 font-mono text-xs leading-5 text-lime-300"
    />
  );
}

/** 暂停遮罩：每次打开时重新挂载，内部状态自动重置 */
function PauseOverlay() {
  const backToMenu = useGameStore((s) => s.backToMenu);
  const hasLocked = useGameStore((s) => s.hasLocked);
  const [lockFailed, setLockFailed] = useState(false);
  const [meta, setMeta] = useState<WorldMeta | null>(null);

  useEffect(() => {
    void loadWorldMeta()
      .then(setMeta)
      .catch(() => setMeta(null));
  }, []);

  const relock = () => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;
    // Chrome 在 Esc 退出指针锁后约 1.25s 内会拒绝再次锁定
    const p = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    p?.catch(() => setLockFailed(true));
  };

  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/50">
      <Card className="w-72">
        <CardHeader>
          <CardTitle>{hasLocked ? '已暂停' : '准备进入'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button className="w-full" onClick={relock}>
            {hasLocked ? '继续游戏' : '点击进入世界'}
          </Button>
          {lockFailed && (
            <p className="text-xs text-destructive">
              浏览器暂时拒绝了指针锁定（Esc 后需稍等片刻），请再点一次
            </p>
          )}
          <Button variant="secondary" className="w-full" onClick={backToMenu}>
            保存并回到主菜单
          </Button>
          <SettingsDialog />
          <p className="pt-1 text-xs text-muted-foreground">
            WASD 移动 · 空格 跳/上浮 · Shift 下降 · F 飞行 · 按住左键 挖掘 · 右键 放置 · 1-9/滚轮 选方块 · F3 调试
          </p>
          {meta && (
            <p className="text-xs text-muted-foreground/70">
              种子 {meta.seed} · 保存于 {new Date(meta.updatedAt).toLocaleTimeString()}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** DOM 覆盖层：准星、热键栏、血条、暂停/死亡遮罩 */
export function Hud() {
  const selectedSlot = useGameStore((s) => s.selectedSlot);
  const flying = useGameStore((s) => s.flying);
  const paused = useGameStore((s) => s.paused);
  const debug = useGameStore((s) => s.debug);
  const touchMode = useGameStore((s) => s.touchMode);
  const worldMode = useGameStore((s) => s.worldMode);
  const dead = useGameStore((s) => s.dead);
  const lastDamageAt = useGameStore((s) => s.lastDamageAt);
  const hotbarSlots = useGameStore((s) => s.hotbarSlots);
  const setSlot = useGameStore((s) => s.setSlot);
  const setCraftingOpen = useGameStore((s) => s.setCraftingOpen);

  // 当前选中项名称（创造=方块，生存=槽位内容）
  const heldSlot = hotbarSlots[selectedSlot];
  const selectedName =
    worldMode === 'creative'
      ? BLOCKS[HOTBAR_BLOCKS[selectedSlot]].name
      : !heldSlot
        ? '空手'
        : heldSlot.kind === 'block'
          ? BLOCKS[heldSlot.id].name
          : heldSlot.kind === 'material'
            ? materialName(heldSlot.material)
            : heldSlot.kind === 'tool'
              ? TOOLS[heldSlot.tool].name
              : ARMOR_DEFS[heldSlot.piece].name;

  return (
    <div className="pointer-events-none absolute inset-0 z-10 select-none">
      {/* 准星 */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-2xl font-light text-white mix-blend-difference">
        +
      </div>

      {/* 热键栏（可点选，移动端小屏缩小；创造=固定面板，生存=槽位背包） */}
      <div className="pointer-events-auto absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
        <div className="mb-1 text-center text-sm text-white drop-shadow-md">
          {selectedName}
          {flying ? ' · 飞行中' : ''}
        </div>
        <div className="flex gap-1 rounded-lg bg-black/40 p-1 backdrop-blur-sm">
          {worldMode === 'creative'
            ? HOTBAR_BLOCKS.map((id, i) => (
                <HotbarCell key={id} index={i} active={i === selectedSlot} onClick={() => setSlot(i)} title={BLOCKS[id].name} icon={BLOCKS[id].icon} />
              ))
            : hotbarSlots.map((slot, i) => (
                <SurvivalCell key={i} index={i} slot={slot} active={i === selectedSlot} onClick={() => setSlot(i)} />
              ))}
        </div>
        {worldMode === 'survival' && (
          <div className="mt-1 text-center">
            <button
              onClick={() => setCraftingOpen(true, false)}
              className="rounded bg-black/50 px-2 py-0.5 text-xs text-white/80 hover:bg-black/70"
            >
              合成 (E)
            </button>
          </div>
        )}
      </div>

      {/* 生存：血条 + 饥饿条 */}
      {worldMode === 'survival' && <SurvivalBars />}

      {/* 受击红屏闪烁 */}
      {lastDamageAt > 0 && (
        <div
          key={lastDamageAt}
          className="absolute inset-0 z-20 bg-red-600"
          style={{ animation: 'hurt-flash 0.5s ease-out forwards' }}
        />
      )}

      {/* 触屏控制层 */}
      {touchMode && !paused && <TouchControls />}

      {/* 暂停遮罩（指针未锁定） */}
      {paused && <PauseOverlay />}

      {/* 死亡遮罩 */}
      {dead && <DeathOverlay />}

      {/* 合成界面 */}
      {worldMode === 'survival' && <CraftingDialog />}

      {/* 熔炉界面 */}
      <FurnaceDialog />

      {/* F3 调试面板 */}
      {debug && <DebugPanel />}
    </div>
  );
}
