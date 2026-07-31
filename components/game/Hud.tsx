'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { attackState, bossState, debugInfo, survivalStats } from '@/lib/game';
import { clearMobs } from '@/lib/mobs';
import { anyPanelOpen, MAX_HEALTH, MAX_HUNGER, MAX_SATURATION, useGameStore } from '@/lib/store';
import { effects, clearEffects } from '@/lib/effects';
import { levelFromXp } from '@/lib/xp';
import { loadWorldMeta, type WorldMeta } from '@/lib/persistence';
import { armorPoints } from '@/lib/armor';
import type { Slot } from '@/lib/slots';
import { slotDurabilityPct, slotName, slotTile } from './slotDisplay';
import { McButton } from './McButton';
import { TouchControls } from './TouchControls';
import { SettingsDialog } from './SettingsDialog';
import { CraftingDialog } from './CraftingDialog';
import { FurnaceDialog } from './FurnaceDialog';
import { BrewingDialog } from './BrewingDialog';
import { EnchantingDialog } from './EnchantingDialog';
import { TradingDialog } from './TradingDialog';
import { StorageDialog } from './StorageDialog';
import { TileIcon } from './TileIcon';
import { BlockPicker } from './BlockPicker';

/** 短暂提示条（睡觉/交互反馈），2.5s 自动消失 */
function Notice() {
  const notice = useGameStore((s) => s.notice);
  const setNotice = useGameStore((s) => s.setNotice);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(timer);
  }, [notice, setNotice]);
  if (!notice) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute left-1/2 top-[18%] -translate-x-1/2 rounded bg-black/60 px-3 py-1.5 text-sm text-white shadow"
    >
      {notice}
    </div>
  );
}

/** 一排 10 格计量图标（心/鸡腿/护甲），用 Faithful 纹理对齐 MC Java（full=2 点、half=1 点、container/empty=背景） */
function Meter({ value, kind }: { value: number; kind: 'heart' | 'food' | 'armor' }) {
  return (
    <div className="flex">
      {Array.from({ length: 10 }, (_, i) => {
        const v = value - i * 2;
        const state = v >= 2 ? 'full' : v === 1 ? 'half' : 'empty';
        const src =
          kind === 'heart'
            ? `/textures/gui/hud/heart/${state === 'empty' ? 'container' : state}.png`
            : `/textures/gui/hud/${kind}_${state}.png`;
        return <img key={i} src={src} alt="" draggable={false} className="h-[18px] w-[18px] select-none drop-shadow [image-rendering:pixelated]" />;
      })}
    </div>
  );
}

const CELL_CLASS =
  'relative flex h-9 w-9 cursor-pointer items-center justify-center rounded border bg-black/30 transition-transform duration-100 sm:h-12 sm:w-12';

/** 生存模式热键栏格子：方块堆叠 / 材料 / 工具 / 装备（带耐久条）；选中格叠加 MC hotbar_selection 框 */
function SurvivalCell({ index, slot, active, onClick }: { index: number; slot: Slot; active: boolean; onClick: () => void }) {
  const cls = `${CELL_CLASS} border-white/20 ${active ? '-translate-y-0.5 scale-110' : ''}`;
  const selBox = active ? (
    <img
      src="/textures/gui/hud/hotbar_selection.png"
      alt=""
      draggable={false}
      className="pointer-events-none absolute -inset-1 z-10 h-[calc(100%+8px)] w-[calc(100%+8px)] select-none [image-rendering:pixelated]"
    />
  ) : null;
  // a11y：格子可聚焦，Enter/Space 触发选择（数字键选择在全局键盘处理里，不受影响）
  const ariaLabel = slot
    ? `物品栏 ${index + 1}：${slotName(slot)}${(slot.kind === 'block' || slot.kind === 'material') && slot.count > 1 ? ` ×${slot.count}` : ''}`
    : `物品栏 ${index + 1}：空`;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };
  if (!slot) {
    return (
      <div role="button" tabIndex={0} aria-label={ariaLabel} onKeyDown={onKeyDown} onClick={onClick} className={cls}>
        {selBox}
      </div>
    );
  }
  const tile = slotTile(slot);
  const title = slotName(slot);
  const durabilityPct = slotDurabilityPct(slot);
  return (
    <div title={title} role="button" tabIndex={0} aria-label={ariaLabel} onKeyDown={onKeyDown} onClick={onClick} className={cls}>
      {selBox}
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

/** 攻击冷却蓄力条（MC 1.9 Java 风格：准星下方小横条，冷却走满即隐藏）；50ms 轮询运行时单例，不进 React 状态 */
function AttackIndicator() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 50);
    return () => clearInterval(t);
  }, []);
  const p = attackState.progress;
  if (p >= 1) return null; // 冷却走满：隐藏（MC 满时全亮/不显示）
  return (
    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 translate-y-3.5 mix-blend-difference">
      <div className="h-[3px] w-6 bg-black/60">
        <div className="h-full bg-white" style={{ width: `${Math.min(1, p) * 100}%` }} />
      </div>
    </div>
  );
}

/** 氧气气泡条（MC：头入水时显示在饥饿行上方；剩余 <15s 才显示，气泡随剩余秒数逐个变空，快耗尽时最后几个爆泡） */
function AirBubbles() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 200);
    return () => clearInterval(t);
  }, []);
  const air = survivalStats.air;
  if (air >= 15) return null; // 满氧气不显示（MC）
  // 10 个气泡：每格 1.5s（氧气共 15s）；剩余 3s 内用爆泡图标（MC 气泡破裂动画的简化）
  return (
    <div className="flex justify-end">
      {Array.from({ length: 10 }, (_, i) => {
        const threshold = (i + 1) * 1.5;
        const state = air >= threshold ? 'air' : air >= threshold - 3 ? 'air_bursting' : 'air_empty';
        return <img key={i} src={`/textures/gui/hud/${state}.png`} alt="" draggable={false} className="h-[18px] w-[18px] select-none drop-shadow [image-rendering:pixelated]" />;
      })}
    </div>
  );
}

/** 生存模式护甲 + 血条 + 饥饿条（护甲条在上，与 MC 一致；置于热键栏簇内最上方） */
function SurvivalBars() {
  const health = useGameStore((s) => s.health);
  const hunger = useGameStore((s) => s.hunger);
  const xpTotal = useGameStore((s) => s.xpTotal);
  const armor = useGameStore((s) => armorPoints(s.armorSlots));
  const [, setTick] = useState(0);
  // 药水效果倒计时徽章（1s 刷新）
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const active: [string, number][] = [];
  if (effects.speed > 0) active.push(['迅捷', effects.speed]);
  if (effects.strength > 0) active.push(['力量', effects.strength]);
  if (effects.fireRes > 0) active.push(['抗火', effects.fireRes]);
  if (effects.regen > 0) active.push(['再生', effects.regen]);
  if (effects.waterBreath > 0) active.push(['水肺', effects.waterBreath]);
  if (effects.haste > 0) active.push(['急迫', effects.haste]);
  if (effects.resistance > 0) active.push(['抗性', effects.resistance]);
  if (effects.jumpBoost > 0) active.push(['跳跃', effects.jumpBoost]);
  if (effects.levitation > 0) active.push(['漂浮', effects.levitation]);
  return (
    <div className="w-full space-y-1 pb-0.5">
      {active.length > 0 && (
        <div className="flex justify-center gap-1.5">
          {active.map(([name, sec]) => (
            <span key={name} className="rounded bg-purple-700/80 px-1.5 py-0.5 text-[10px] text-white">
              {name} {Math.floor(sec / 60)}:{String(Math.floor(sec % 60)).padStart(2, '0')}
            </span>
          ))}
        </div>
      )}
      {armor > 0 && <Meter value={armor * 2} kind="armor" />}
      {(() => {
        const { level, progress } = levelFromXp(xpTotal);
        return (
          <div className="relative h-[10px] w-[182px]">
            {/* MC 经验条：experience_bar 底 + progress 按比例裁剪（Faithful 纹理） */}
            <img src="/textures/gui/hud/experience_bar_background.png" alt="" draggable={false} className="h-full w-full select-none [image-rendering:pixelated]" />
            <div className="absolute left-0 top-0 h-full overflow-hidden" style={{ width: `${progress * 100}%` }}>
              <img src="/textures/gui/hud/experience_bar_progress.png" alt="" draggable={false} className="h-full w-[182px] select-none [image-rendering:pixelated]" />
            </div>
            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-green-400" style={{ textShadow: '1px 1px 0 #000' }}>
              {level}
            </span>
          </div>
        );
      })()}
      <AirBubbles />
      <div className="flex justify-between">
        <Meter value={health} kind="heart" />
        <Meter value={hunger} kind="food" />
      </div>
    </div>
  );
}

/** 竖屏触屏提示条：建议横屏游玩（仅触屏 + 竖屏显示，可关闭，不持久化） */
function PortraitHint() {
  const [portrait, setPortrait] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait)');
    const update = () => setPortrait(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  if (!portrait || dismissed) return null;
  return (
    <div
      className="pointer-events-auto absolute left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded bg-black/70 px-3 py-1.5 text-xs text-white"
      style={{ top: 'calc(0.5rem + env(safe-area-inset-top, 0px))' }}
    >
      <span>建议横屏游玩，体验更佳</span>
      <button
        aria-label="关闭提示"
        className="flex h-6 w-6 items-center justify-center rounded bg-white/15"
        onClick={() => setDismissed(true)}
      >
        ✕
      </button>
    </div>
  );
}

/** 死亡遮罩（对齐 MC Java 死亡界面：暗红渐变 + 大标题 + 按钮）；重生回出生点并清空怪物（物品已掉落在死亡点）；末地死亡回主世界（MC 规则） */
function DeathOverlay() {
  const backToMenu = useGameStore((s) => s.backToMenu);
  const deathPos = useGameStore((s) => s.deathPos);
  const respawn = () => {
    const s = useGameStore.getState();
    s.setHealth(MAX_HEALTH);
    s.setHunger(MAX_HUNGER);
    s.setSaturation(MAX_SATURATION);
    s.setDead(false);
    survivalStats.exhaustion = 0;
    survivalStats.wither = 0; // MC：死亡清空凋零 DoT（否则复活后继续扣血）
    clearEffects(); // MC：死亡清空全部药水效果
    clearMobs();
    if (s.dimension === 'end') s.setDimension('overworld'); // MC：末地死亡回主世界重生点
  };
  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex flex-col items-center justify-center bg-gradient-to-b from-red-900/70 via-red-950/60 to-black/70">
      <h2 className="mb-8 text-4xl font-bold text-white [text-shadow:3px_3px_0_#3f3f3f]">你死了！</h2>
      {deathPos && (
        <p className="-mt-4 mb-6 text-center text-sm leading-6 text-white/90 [text-shadow:1px_1px_0_#000]">
          死亡地点：{deathPos.x}, {deathPos.y}, {deathPos.z}
          <br />
          物品掉落在死亡点附近
        </p>
      )}
      <div className="flex w-72 flex-col gap-2">
        <McButton onClick={respawn}>重生</McButton>
        <McButton onClick={backToMenu}>标题画面</McButton>
      </div>
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
    <div className="pointer-events-auto absolute inset-0 flex flex-col items-center justify-center bg-black/45">
      {/* MC Java 游戏菜单：标题 + 按钮列 */}
      <h2 className="mb-6 text-2xl font-bold text-white [text-shadow:2px_2px_0_#3f3f3f]">{hasLocked ? '游戏菜单' : '准备进入'}</h2>
      <div className="flex w-72 flex-col gap-2">
        <McButton onClick={relock}>{hasLocked ? '继续游戏' : '点击进入世界'}</McButton>
        {lockFailed && (
          <p className="text-center text-xs text-red-300 [text-shadow:1px_1px_0_#000]">
            浏览器暂时拒绝了指针锁定（Esc 后需稍等片刻），请再点一次
          </p>
        )}
        <SettingsDialog />
        <McButton onClick={backToMenu}>保存并回到主菜单</McButton>
      </div>
      <p className="mt-6 max-w-md px-4 text-center text-xs leading-5 text-white/70 [text-shadow:1px_1px_0_#000]">
        WASD 移动 · 空格 跳/上浮 · Shift 下降 · F 飞行 · 按住左键 挖掘 · 右键 放置 · 1-9/滚轮 选方块 · F3 调试
      </p>
      {meta && (
        <p className="mt-1 text-xs text-white/50 [text-shadow:1px_1px_0_#000]">
          种子 {meta.seed} · 保存于 {new Date(meta.updatedAt).toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}

/** Boss 血条（凋灵在附近时置顶显示，MC 紫色条） */
function BossBar() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, []);
  if (!bossState.name) return null;
  return (
    <div className="absolute left-1/2 top-2 w-96 -translate-x-1/2">
      <div className="mb-1 text-center text-sm font-bold text-white" style={{ textShadow: '1px 1px 0 #000' }}>
        {bossState.name}
      </div>
      <div className="h-2 rounded bg-black/60">
        <div className="h-full rounded bg-purple-600 transition-[width]" style={{ width: `${(bossState.hp / bossState.max) * 100}%` }} />
      </div>
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
  const panelOpen = useGameStore(anyPanelOpen);

  // 当前选中项名称（创造/生存同一套槽位：方块/材料/工具/装备）
  const heldSlot = hotbarSlots[selectedSlot];
  const selectedName = heldSlot ? slotName(heldSlot) : '空手';

  return (
    <div className="pointer-events-none absolute inset-0 z-10 select-none">
      {/* 准星 */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-2xl font-light text-white mix-blend-difference">
        +
      </div>

      {/* 攻击冷却蓄力条（MC 1.9，准星下方） */}
      {!dead && <AttackIndicator />}

      {/* Boss 血条 */}
      <BossBar />

      {/* 竖屏触屏提示（建议横屏） */}
      {touchMode && <PortraitHint />}

      <Notice />

      {/* 热键栏（可点选，移动端小屏缩小；创造=固定面板，生存=槽位背包；生存时血量饥饿置顶） */}
      <div className="pointer-events-auto absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-1">
        {worldMode === 'survival' && <SurvivalBars />}
        <div className="text-center text-sm text-white drop-shadow-md">
          {selectedName}
          {flying ? ' · 飞行中' : ''}
        </div>
        <div className="relative p-1">
          {/* MC 热键栏：hotbar.png 纹理背景（Faithful），格子图标叠加，选中格 hotbar_selection 框 */}
          <img src="/textures/gui/hud/hotbar.png" alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full select-none [image-rendering:pixelated]" />
          <div className="relative flex gap-1">
            {hotbarSlots.map((slot, i) => (
              <SurvivalCell key={i} index={i} slot={slot} active={i === selectedSlot} onClick={() => setSlot(i)} />
            ))}
          </div>
        </div>
        {worldMode === 'creative' ? (
          <div className="mt-1 text-center">
            <button
              onClick={() => useGameStore.getState().setPickerOpen(true)}
              className={`rounded bg-black/50 text-white/80 hover:bg-black/70 ${touchMode ? 'px-4 py-2.5 text-sm' : 'px-2 py-0.5 text-xs'}`}
            >
              选块 (E)
            </button>
          </div>
        ) : (
          <div className="mt-1 text-center">
            <button
              onClick={() => setCraftingOpen(true, false)}
              className={`rounded bg-black/50 text-white/80 hover:bg-black/70 ${touchMode ? 'px-4 py-2.5 text-sm' : 'px-2 py-0.5 text-xs'}`}
            >
              合成 (E)
            </button>
          </div>
        )}
      </div>

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

      {/* 暂停遮罩（指针未锁定；有界面打开时不显示，关掉界面即可直接继续） */}
      {paused && !panelOpen && <PauseOverlay />}

      {/* 死亡遮罩 */}
      {dead && <DeathOverlay />}

      {/* 合成界面（生存）/ 选块界面（创造） */}
      {worldMode === 'survival' ? <CraftingDialog /> : <BlockPicker />}

      {/* 熔炉界面 */}
      <FurnaceDialog />

      {/* 酿造台界面 */}
      <BrewingDialog />

      {/* 附魔台界面 */}
      <EnchantingDialog />

      {/* 村民交易界面 */}
      <TradingDialog />

      {/* 容器界面（箱子/木桶） */}
      <StorageDialog />

      {/* F3 调试面板 */}
      {debug && <DebugPanel />}
    </div>
  );
}
