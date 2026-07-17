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

/** 世界/贴图加载中的全屏覆盖层 */
function LoadingOverlay() {
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-zinc-900">
      <div className="h-8 w-8 animate-spin rounded-[4px] bg-gradient-to-br from-lime-400 to-emerald-600 [animation-duration:1.1s]" />
      <p className="text-sm text-zinc-300">正在生成世界…</p>
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

