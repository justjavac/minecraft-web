'use client';

import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { World, type Chunk } from '@/lib/world';
import { getAtlasMaterials, type AtlasMaterials } from '@/lib/textures';
import {
  clearWorldStore,
  listChunkKeys,
  loadChunks,
  loadWorldMeta,
  saveChunk,
  saveModifiedChunks,
  saveWorldMeta,
  worldMeta,
  type SaveExtras,
} from '@/lib/persistence';
import { playerPosition, setActiveWorld, debugInfo, worldClock } from '@/lib/game';
import { clearFurnaces, furnaces, tickFurnaces } from '@/lib/furnace';
import { tickFluids } from '@/lib/fluids';
import { tickCrops } from '@/lib/crops';
import { tickSaplings } from '@/lib/saplings';
import { flushLight } from '@/lib/lights';
import { preloadSounds } from '@/lib/sound';
import { useRendererKind } from './renderer-kind';
import { emptySlots } from '@/lib/slots';
import { MAX_HEALTH, MAX_HUNGER, useGameStore } from '@/lib/store';
import { ChunkMesh } from './ChunkMesh';

/** 当前要随 meta 保存的附加状态（位置/时刻/模式/生存数值/熔炉） */
function currentExtras(): SaveExtras {
  const s = useGameStore.getState();
  return {
    player: { ...playerPosition },
    dayTime: worldClock.t,
    mode: s.worldMode,
    survival:
      s.worldMode === 'survival'
        ? { health: s.health, hunger: s.hunger, saturation: s.saturation, slots: s.hotbarSlots, armor: s.armorSlots }
        : undefined,
    furnaces: furnaces.size > 0 ? Object.fromEntries(furnaces) : undefined,
  };
}

export function WorldRenderer() {
  const mode = useGameStore((s) => s.mode);
  const seed = useGameStore((s) => s.seed);
  const kind = useRendererKind();
  const [world, setWorld] = useState<World | null>(null);
  const [materials, setMaterials] = useState<AtlasMaterials | null>(null);
  const [chunkList, setChunkList] = useState<Chunk[]>([]);
  const worldRef = useRef<World | null>(null);
  const lastUpdate = useRef(0);
  const lastFluid = useRef(0);
  const lastGeneration = useRef(-1);

  // 创建/加载世界 + 贴图
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const mats = await getAtlasMaterials(kind);
      let w: World;
      if (mode === 'continue') {
        const meta = await loadWorldMeta();
        const center = meta?.player ?? { x: 8.5, y: 40, z: 8.5 };
        // 只预载出生点附近的存档 chunk，其余后台惰性补齐（不拖慢启动）
        const radius = useGameStore.getState().settings.renderDistance + 2;
        const ccx = Math.floor(center.x / 16);
        const ccz = Math.floor(center.z / 16);
        const allKeys = await listChunkKeys();
        const near: string[] = [];
        const rest: string[] = [];
        for (const k of allKeys) {
          const [cx, cz] = k.split(',').map(Number);
          (Math.max(Math.abs(cx - ccx), Math.abs(cz - ccz)) <= radius ? near : rest).push(k);
        }
        const saved = await loadChunks(near);
        w = new World(meta?.seed ?? seed, saved);
        worldClock.t = meta?.dayTime ?? 0.3; // 恢复昼夜时刻，无记录则从上午开始
        // 恢复熔炉状态
        clearFurnaces();
        if (meta?.furnaces) {
          for (const [k, v] of Object.entries(meta.furnaces)) furnaces.set(k, v);
        }
        const store = useGameStore.getState();
        if (meta?.player) store.setSpawnPoint(meta.player);
        store.setWorldMode(meta?.mode ?? 'creative');
        store.loadSurvival(meta?.survival ?? { health: MAX_HEALTH, hunger: MAX_HUNGER, slots: emptySlots() });
        // 后台加载剩余存档 chunk：本局未修改的直接替换为存档版本
        void loadChunks(rest).then((restData) => {
          if (cancelled) return;
          for (const [k, v] of restData) w.applySavedChunk(k, v);
        });
      } else {
        await clearWorldStore();
        worldClock.t = 0.3; // 新世界从上午开始
        w = new World(seed);
        await saveWorldMeta(worldMeta(seed, { mode: useGameStore.getState().worldMode }));
      }
      if (cancelled) return;
      w.onChunkRemoved = (c) => {
        void saveChunk(`${c.cx},${c.cz}`, c.data);
      };
      worldRef.current = w;
      setActiveWorld(w);
      setWorld(w);
      setMaterials(mats);
      useGameStore.getState().setWorldReady(true);
      preloadSounds();
    })();
    return () => {
      cancelled = true;
      useGameStore.getState().setWorldReady(false);
      const w = worldRef.current;
      if (w) void saveModifiedChunks(w, currentExtras());
      clearFurnaces();
      worldRef.current = null;
      setActiveWorld(null);
    };
  }, [mode, seed, kind]);

    // 定期存档 + 关闭页面前兜底
  useEffect(() => {
    if (!world) return;
    const flush = () => {
      void saveModifiedChunks(world, currentExtras());
    };
    const timer = setInterval(flush, 5000);
    // beforeunload 在移动端 Safari 不可靠，pagehide 是兜底
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      clearInterval(timer);
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
    };
  }, [world]);

  // 每帧：重建脏 chunk 网格（限流）+ 按玩家位置调度 chunk + 推进熔炉烧炼 + 流体传播
  useFrame((_, delta) => {
    const w = worldRef.current;
    if (!w) return;
    // 先冲刷光照脏标记（本帧建网读到的是最新光照；批量编辑也只重算一次）
    flushLight(w);
    let drained = 0;
    while (drained < 6) {
      const key = w.pollDirty();
      if (!key) break;
      const c = w.chunks.get(key);
      if (c) c.version++;
      drained++;
    }
    const now = performance.now();
    if (now - lastUpdate.current > 250) {
      lastUpdate.current = now;
      w.updateAround(
        playerPosition.x,
        playerPosition.z,
        useGameStore.getState().settings.renderDistance,
      );
    }
    if (now - lastFluid.current > 400) {
      lastFluid.current = now;
      tickFluids(w);
      tickSaplings(w, 0.4); // 内部按 2s 累计触发生长/凋零
      tickCrops(w, 0.4); // 同上节奏推进小麦生长
    }
    if (!useGameStore.getState().paused) {
      tickFurnaces(Math.min(delta, 0.05));
    }
    debugInfo.chunks = w.chunks.size;
    debugInfo.dirty = w.dirtyChunks.size;
    if (drained > 0 || w.generation !== lastGeneration.current) {
      lastGeneration.current = w.generation;
      setChunkList(Array.from(w.chunks.values()));
    }
  });

  if (!world || !materials) return null;
  return (
    <>
      {chunkList.map((c) => (
        <ChunkMesh
          key={`${c.cx},${c.cz}`}
          world={world}
          chunk={c}
          version={c.version}
          materials={materials}
        />
      ))}
    </>
  );
}
