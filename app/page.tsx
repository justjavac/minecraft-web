'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { GameErrorBoundary } from '@/components/game/GameErrorBoundary';
import { MainMenu } from '@/components/game/MainMenu';
import { debugInfo, loadingState } from '@/lib/game';
import { useGameStore } from '@/lib/store';

// 游戏本体（three.js 全家）按需加载：主菜单不下载/解析 three（首屏 chunk 从 ~2MB 降到菜单壳体积）
const GameCanvas = dynamic(() => import('@/components/game/GameCanvas').then((m) => m.GameCanvas), { ssr: false });
// Hud 的 import 链也拉 three（TouchControls→lib/actions→three、lib/mobs→three），一并 dynamic
const Hud = dynamic(() => import('@/components/game/Hud').then((m) => m.Hud), { ssr: false });

/** 生产环境注册 Service Worker（离线可玩），开发环境不注册避免缓存干扰 */
function useServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
}

/** 世界/贴图加载中的全屏覆盖层；按阶段显示渲染器检测/区块生成进度；加载失败时显示错误与重试 */
function LoadingOverlay() {
  const loadError = useGameStore((s) => s.loadError);
  const retryWorld = useGameStore((s) => s.retryWorld);
  const backToMenu = useGameStore((s) => s.backToMenu);
  /** 加载阶段（检测渲染器/生成世界）与已加载区块数，250ms 轮询运行时单例（不挂 store，避免高频重渲染其他组件） */
  const [progress, setProgress] = useState({ phase: loadingState.phase, chunks: 0 });
  /** 重试按钮短暂禁用（1.5s），防连点全量重跑 */
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setProgress({ phase: loadingState.phase, chunks: debugInfo.chunks });
    }, 250);
    return () => clearInterval(timer);
  }, []);

  const onRetry = () => {
    if (retrying) return;
    setRetrying(true);
    retryWorld();
    setTimeout(() => setRetrying(false), 1500);
  };

  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-zinc-900">
      {loadError ? (
        <>
          <p className="text-sm text-red-400">世界加载失败：{loadError}</p>
          <div className="flex gap-3">
            <button
              onClick={onRetry}
              disabled={retrying}
              className="rounded bg-lime-600 px-4 py-1.5 text-sm text-white hover:bg-lime-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              重试
            </button>
            <button onClick={backToMenu} className="rounded bg-zinc-700 px-4 py-1.5 text-sm text-white hover:bg-zinc-600">
              回到主菜单
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="h-8 w-8 animate-spin rounded-[4px] bg-gradient-to-br from-lime-400 to-emerald-600 [animation-duration:1.1s]" />
          <p className="text-sm text-zinc-300">
            {progress.phase === 'detect' ? '正在检测渲染器…' : `正在生成世界…（已加载 ${progress.chunks} 个区块）`}
          </p>
        </>
      )}
    </div>
  );
}

/** WebGL/渲染崩溃兜底：与 loadError 界面同一套像素风样式 */
function FatalErrorFallback() {
  const backToMenu = useGameStore((s) => s.backToMenu);
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-zinc-900 px-6 text-center">
      <p className="text-sm text-red-400">你的浏览器不支持 WebGL 或显卡驱动异常</p>
      <p className="text-xs text-zinc-400">请尝试开启硬件加速、更新浏览器或显卡驱动后重试</p>
      <div className="flex gap-3">
        <button onClick={() => location.reload()} className="rounded bg-lime-600 px-4 py-1.5 text-sm text-white hover:bg-lime-500">
          重试
        </button>
        <button onClick={backToMenu} className="rounded bg-zinc-700 px-4 py-1.5 text-sm text-white hover:bg-zinc-600">
          回到主菜单
        </button>
      </div>
    </div>
  );
}

export default function Home() {
  const screen = useGameStore((s) => s.screen);
  const worldReady = useGameStore((s) => s.worldReady);
  useServiceWorker();
  if (screen === 'menu') return <MainMenu />;
  return (
    <div className="fixed inset-0 overflow-hidden bg-black">
      <GameErrorBoundary fallback={<FatalErrorFallback />}>
        <GameCanvas />
        <Hud />
        {!worldReady && <LoadingOverlay />}
      </GameErrorBoundary>
    </div>
  );
}

