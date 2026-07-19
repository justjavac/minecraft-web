'use client';

import { useEffect } from 'react';
import { GameCanvas } from '@/components/game/GameCanvas';
import { Hud } from '@/components/game/Hud';
import { MainMenu } from '@/components/game/MainMenu';
import { useGameStore } from '@/lib/store';

/** 生产环境注册 Service Worker（离线可玩），开发环境不注册避免缓存干扰 */
function useServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
}

/** 世界/贴图加载中的全屏覆盖层；加载失败时显示错误与重试 */
function LoadingOverlay() {
  const loadError = useGameStore((s) => s.loadError);
  const retryWorld = useGameStore((s) => s.retryWorld);
  const backToMenu = useGameStore((s) => s.backToMenu);
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-zinc-900">
      {loadError ? (
        <>
          <p className="text-sm text-red-400">世界加载失败：{loadError}</p>
          <div className="flex gap-3">
            <button onClick={retryWorld} className="rounded bg-lime-600 px-4 py-1.5 text-sm text-white hover:bg-lime-500">
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
          <p className="text-sm text-zinc-300">正在生成世界…</p>
        </>
      )}
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
      <GameCanvas />
      <Hud />
      {!worldReady && <LoadingOverlay />}
    </div>
  );
}

