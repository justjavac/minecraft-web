'use client';

import '@/lib/three-compat';
import { useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { WorldRenderer } from './World';
import { Player } from './Player';
import { BlockHighlight } from './BlockHighlight';
import { PlacePreview } from './PlacePreview';
import { CrackOverlay } from './CrackOverlay';
import { BreakParticles } from './BreakParticles';
import { Mobs } from './Mobs';
import { ItemDrops } from './ItemDrops';
import { Tnt } from './Tnt';
import { DayNight } from './DayNight';
import { Rain } from './Rain';
import { UnderwaterFX, skyFog } from './UnderwaterFX';
import { RendererKindContext, type RendererKind } from './renderer-kind';
import { useGameStore } from '@/lib/store';

/** WebGPU 能力检测：无 API 或拿不到适配器则降级 WebGL */
async function detectKind(): Promise<RendererKind> {
  // TS DOM 类型未内置 WebGPU，手动收窄
  const gpu = typeof navigator !== 'undefined'
    ? (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
    : undefined;
  if (!gpu) return 'webgl';
  try {
    const adapter = await gpu.requestAdapter();
    return adapter ? 'webgpu' : 'webgl';
  } catch {
    return 'webgl';
  }
}

export function GameCanvas() {
  const renderDistance = useGameStore((s) => s.settings.renderDistance);
  /** 实际生效的渲染器（检测完成前为 null，此期间加载层仍在显示） */
  const [kind, setKind] = useState<RendererKind | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      // 渲染器选择在本会话生效一次；设置里切换在下次进入世界时才生效（避免中途重建丢进度）
      const k = useGameStore.getState().settings.renderer === 'webgpu' ? await detectKind() : 'webgl';
      if (alive) setKind(k);
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!kind) return null;
  const fog = skyFog(renderDistance);
  return (
    <RendererKindContext.Provider value={kind}>
      <Canvas
        key={kind} // 渲染器切换时整体重建
        gl={
          kind === 'webgpu'
            ? // WebGPU：动态加载 three/webgpu；初始化失败时回退 WebGL 并触发材质降级
              (async (props) => {
                try {
                  const { WebGPURenderer } = await import('three/webgpu');
                  const renderer = new WebGPURenderer({ canvas: props.canvas as HTMLCanvasElement, antialias: false });
                  await renderer.init();
                  return renderer;
                } catch (err) {
                  console.warn('[renderer] WebGPU 初始化失败，回退到 WebGL', err);
                  setKind('webgl');
                  const { WebGLRenderer } = await import('three');
                  return new WebGLRenderer({ canvas: props.canvas as HTMLCanvasElement, antialias: false });
                }
              })
            : { antialias: false }
        }
        dpr={1}
        camera={{ fov: 75, near: 0.1, far: 400, position: [8.5, 40, 8.5] }}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
        }}
      >
        <color attach="background" args={['#87ceeb']} />
        <fog attach="fog" args={['#87ceeb', fog.near, fog.far]} />
        <DayNight />
        <Rain />
        <WorldRenderer />
        <Player />
        <Mobs />
        <ItemDrops />
        <Tnt />
        <BlockHighlight />
        <PlacePreview />
        <CrackOverlay />
        <BreakParticles />
        <UnderwaterFX />
      </Canvas>
    </RendererKindContext.Provider>
  );
}
