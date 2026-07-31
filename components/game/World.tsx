'use client';

import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { World, type Chunk } from '@/lib/world';
import { getAtlasMaterials, type AtlasMaterials } from '@/lib/textures';
import {
  clearWorldStore,
  DIM_KEYS,
  dimExtrasToScopes,
  listChunkKeys,
  loadChunks,
  loadWorldMeta,
  mergeDims,
  saveChunk,
  saveModifiedChunks,
  saveWorldMeta,
  scopesToDimExtras,
  worldMeta,
  type DimExtras,
  type DimKey,
  type SaveExtras,
} from '@/lib/persistence';
import { playerPosition, setActiveWorld, debugInfo, teleportState, worldClock } from '@/lib/game';
import { findLanding, ensurePortal, mapCoords, type Dimension } from '@/lib/dimension';
import { createEndTerrain } from '@/lib/end';
import { createNetherTerrain } from '@/lib/nether';
import { makeEnderDragon, mobs } from '@/lib/mobs';
import { clearEndFight, dragonState, initEndFight } from '@/lib/endfight';
import { clearEffects } from '@/lib/effects';
import { rescanCropsChunk } from '@/lib/crops';
import { rescanSaplingsChunk } from '@/lib/saplings';
import { resetSimClock, tickWorld } from '@/lib/sim';
import { clearWorldScopes, restoreWorldScopes, snapshotWorldScopes } from '@/lib/worldScope';
import { flushLight } from '@/lib/lights';
import { preloadSounds } from '@/lib/sound';
import { useRendererKind } from './renderer-kind';
import { emptySlots } from '@/lib/slots';
import { MAX_HEALTH, MAX_HUNGER, useGameStore } from '@/lib/store';
import { ChunkMesh } from './ChunkMesh';

/** 非主世界 chunk 在 IndexedDB 中的键前缀（与主世界存档隔离） */
const dimPrefix = (d: Dimension): string => (d === 'nether' ? 'n:' : d === 'end' ? 'e:' : '');

/** chunk 生成时间片预算（毫秒/帧）：初始加载期放大预算全速铺满，游玩期小预算消除 >50ms 长任务 */
const GEN_BUDGET_LOAD = 24;
const GEN_BUDGET_PLAY = 6;

/** 创建某维度的世界实例（下界/末地用各自地形与独立种子） */
function makeDimWorld(d: Dimension, seedStr: string, saved?: Map<string, Uint16Array>): World {
  if (d === 'nether') {
    const nseed = `${seedStr}:nether`;
    return new World(nseed, saved, createNetherTerrain(nseed));
  }
  if (d === 'end') {
    const eseed = `${seedStr}:end`;
    return new World(eseed, saved, createEndTerrain(eseed));
  }
  return new World(seedStr, saved);
}

/** 读取某维度存档：附近立即加载，其余后台惰性补齐 */
async function loadDimWorld(d: Dimension, seedStr: string, center: { x: number; z: number }): Promise<World> {
  const prefix = dimPrefix(d);
  const all = (await listChunkKeys()).filter((k) => (prefix ? k.startsWith(prefix) : !k.startsWith('n:') && !k.startsWith('e:')));
  const radius = useGameStore.getState().settings.renderDistance + 2;
  const ccx = Math.floor(center.x / 16);
  const ccz = Math.floor(center.z / 16);
  const near: string[] = [];
  const rest: string[] = [];
  for (const k of all) {
    const plain = prefix ? k.slice(prefix.length) : k;
    const [cx, cz] = plain.split(',').map(Number);
    (Math.max(Math.abs(cx - ccx), Math.abs(cz - ccz)) <= radius ? near : rest).push(k);
  }
  const saved = new Map<string, Uint16Array>();
  for (const [k, v] of await loadChunks(near)) saved.set(prefix ? k.slice(prefix.length) : k, v);
  const w = makeDimWorld(d, seedStr, saved);
  // 后台加载剩余存档 chunk：本局未修改的直接替换为存档版本
  void loadChunks(rest)
    .then((restData) => {
      for (const [k, v] of restData) {
        const plain = prefix ? k.slice(prefix.length) : k;
        w.applySavedChunk(plain, v);
        // chunk 已生成时数据被存档整体替换（直写 data 不走 setBlock 钩子）：重扫让作物/树苗登记与新数据同步。
        // 未生成的 chunk 存入备用，之后创建时由 WorldRenderer 的首次出现重扫覆盖（此处重扫幂等）
        const c = w.chunks.get(plain);
        if (c) {
          rescanCropsChunk(w, c.cx, c.cz);
          rescanSaplingsChunk(w, c.cx, c.cz);
        }
      }
    })
    .catch((err) => console.warn('后台补齐存档 chunk 失败（不影响游玩）', err));
  return w;
}

/** 维度暂存：世界作用域快照（registry，含容器/熔炉/酿造/TNT/信标）+ 玩家位置。
 * player 缺省表示该维度状态来自存档而非本局造访（位置走传送/默认出生点） */
interface DimState {
  player?: { x: number; y: number; z: number };
  scopes: Record<string, unknown>;
}

/** 当前要随 meta 保存的附加状态（位置/时刻/模式/生存数值/各维度容器状态）。
 * dims 合并：当前维度取 live 模块（registry 快照），其余维度取 dimStates 暂存——任何维度都不丢（修复跨维度存档互相覆盖） */
function currentExtras(d: Dimension, dimStates: Partial<Record<Dimension, DimState>>): SaveExtras {
  const s = useGameStore.getState();
  const stashed: Partial<Record<DimKey, DimExtras>> = {};
  for (const dim of DIM_KEYS) {
    const ds = dimStates[dim];
    if (ds) stashed[dim] = scopesToDimExtras(ds.scopes);
  }
  return {
    player: { ...playerPosition },
    respawnPoint: s.respawnPoint ?? undefined,
    dayTime: worldClock.t,
    mode: s.worldMode,
    dimension: d,
    survival:
      s.worldMode === 'survival'
        ? { health: s.health, hunger: s.hunger, saturation: s.saturation, slots: s.hotbarSlots, backpack: s.mainSlots, armor: s.armorSlots, xp: s.xpTotal }
        : undefined,
    dims: mergeDims(d, scopesToDimExtras(snapshotWorldScopes()), stashed),
  };
}

export function WorldRenderer() {
  const mode = useGameStore((s) => s.mode);
  const seed = useGameStore((s) => s.seed);
  const worldRetry = useGameStore((s) => s.worldRetry);
  const dimension = useGameStore((s) => s.dimension);
  const kind = useRendererKind();
  const [world, setWorld] = useState<World | null>(null);
  const [materials, setMaterials] = useState<AtlasMaterials | null>(null);
  const [chunkList, setChunkList] = useState<Chunk[]>([]);
  const worldRef = useRef<World | null>(null);
  /** 两个维度的世界实例缓存（切换不丢 chunk 与生成状态） */
  const worldsRef = useRef<Partial<Record<Dimension, World>>>({});
  /** 各维度的世界作用域暂存（registry 快照 + 玩家位置），切换时暂存/恢复 */
  const dimStateRef = useRef<Partial<Record<Dimension, DimState>>>({});
  const firstLoadRef = useRef(true);
  /** 初始加载中（出生点周围尚未铺满）：updateAround 用大预算全速生成；铺满后转游玩小预算 */
  const initialLoadRef = useRef(true);
  const lastGeneration = useRef(-1);
  /** 已做作物/树苗重扫的 chunk key（generation 变化时按差集补扫，避免每帧重复扫已扫 chunk） */
  const scannedChunksRef = useRef(new Set<string>());

  // 创建/加载世界 + 贴图（维度切换时重跑：暂存旧维度状态，加载/恢复新维度）
  useEffect(() => {
    let cancelled = false;
    // 两个 Map 对象身份恒定（只改字段），cleanup 里用局部引用消除 exhaustive-deps 告警
    const worlds = worldsRef.current;
    const dimStates = dimStateRef.current;
    void (async () => {
      try {
        const mats = await getAtlasMaterials(kind);
        // 首次进入（继续游戏）：读 meta 决定维度与全局状态
        if (mode === 'continue' && firstLoadRef.current) {
          firstLoadRef.current = false;
          const meta = await loadWorldMeta();
          const metaDim = meta?.dimension ?? 'overworld';
          if (metaDim !== dimension) {
            // 以 meta 的维度为准回写 store，effect 用新维度重跑
            useGameStore.getState().setDimension(metaDim);
            return;
          }
          worldClock.t = meta?.dayTime ?? 0.3; // 恢复昼夜时刻，无记录则从上午开始
          // 按维度恢复容器/站点状态：当前维度与其他维度一样进暂存，由下方统一 restore 进 live 模块
          // （避免「先 restore 再被通用恢复逻辑清空」的双重恢复问题）
          dimStates[dimension] = { scopes: dimExtrasToScopes(meta?.dims?.[dimension]) };
          for (const dim of DIM_KEYS) {
            if (dim === dimension) continue;
            const de = meta?.dims?.[dim];
            if (de) dimStates[dim] = { scopes: dimExtrasToScopes(de) };
          }
          const store = useGameStore.getState();
          if (meta?.player) store.setSpawnPoint(meta.player);
          if (meta?.respawnPoint) store.setRespawnPoint(meta.respawnPoint); // 床设的重生点随存档恢复
          store.setWorldMode(meta?.mode ?? 'creative');
          // MC：死亡后重进世界回满血（存档可能在死亡瞬间写入 health 0，避免载入「尸体态」）
          const sv = meta?.survival ?? { health: MAX_HEALTH, hunger: MAX_HUNGER, slots: emptySlots() };
          if ((sv.health ?? MAX_HEALTH) <= 0) sv.health = MAX_HEALTH;
          store.loadSurvival(sv);
          const center = meta?.player ?? { x: 8.5, y: 40, z: 8.5 };
          worlds[dimension] = await loadDimWorld(dimension, meta?.seed ?? seed, center);
        } else if (mode !== 'continue' && firstLoadRef.current) {
          firstLoadRef.current = false;
          await clearWorldStore();
          worldClock.t = 0.3; // 新世界从上午开始
          worlds[dimension] = makeDimWorld(dimension, seed);
          for (const k of Object.keys(dimStates)) delete dimStates[k as Dimension]; // 新世界不沿用旧世界的维度暂存
          clearWorldScopes(); // 清空上一个世界的全部世界作用域残留（容器/红石/生物/掉落物……）
          clearEffects(); // 新世界清空药水效果（玩家作用域，不走世界 registry）
          await saveWorldMeta(worldMeta(seed, { mode: useGameStore.getState().worldMode, dimension: 'overworld' }));
        }
        // 切换维度/首次造访：取缓存或读档新建
        let w = worlds[dimension];
        if (!w) {
          w = await loadDimWorld(dimension, seed, teleportState.pending ?? { x: 8.5, z: 8.5 });
          worlds[dimension] = w;
        }
        if (cancelled) return;
        // 恢复该维度的世界作用域状态（registry：快照里有的整体替换，缺失的可恢复系统自动清空）
        const ds = dimStates[dimension];
        delete dimStates[dimension];
        restoreWorldScopes(ds?.scopes ?? {});
        if (ds?.player) useGameStore.getState().setSpawnPoint(ds.player);
        // 跨维度传送：落点扫描 + 无门造门 + 传送坐标落定（末地落固定出生平台，不造下界门；末地返回主世界不造门）
        if (teleportState.pending) {
          const tp = teleportState.pending;
          if (dimension === 'end') {
            useGameStore.getState().setSpawnPoint({ x: tp.x, y: tp.y, z: tp.z }); // tp 即 END_SPAWN
          } else if (!tp.fromEnd) {
            // MC 坐标映射：主世界 ↔ 下界 1:8（下界旅行 1 格 = 主世界 8 格）
            const mapped = mapCoords(tp, dimension);
            const landing = findLanding(w, Math.floor(mapped.x), Math.floor(mapped.z), dimension);
            ensurePortal(w, Math.floor(landing.x), Math.floor(landing.y), Math.floor(landing.z));
            useGameStore.getState().setSpawnPoint(landing);
          }
          teleportState.pending = null;
        }
        // 末地：初始化龙战（柱顶水晶；未屠龙则生成末影龙）
        if (dimension === 'end') {
          initEndFight(w);
          if (!dragonState.slain && !mobs.some((m) => m.type === 'ender_dragon')) mobs.push(makeEnderDragon(0.5, 84, 0.5));
        } else {
          clearEndFight();
        }
        w.onChunkRemoved = (c) => {
          void saveChunk(dimPrefix(dimension) + `${c.cx},${c.cz}`, c.data);
        };
        worldRef.current = w;
        setActiveWorld(w);
        resetSimClock(); // 新维度/新世界：模拟时间累加器清零，不带入旧世界
        initialLoadRef.current = true; // 新维度/新世界：先全速铺满出生点周围
        scannedChunksRef.current.clear(); // 重扫记录按世界实例归零（chunk 首次出现时补扫）
        lastGeneration.current = -1;
        setWorld(w);
        setMaterials(mats);
        useGameStore.getState().setLoadError(null);
        useGameStore.getState().setWorldReady(true);
        preloadSounds();
      } catch (err) {
        // 贴图/存档加载失败：显示错误并提供重试，不再无限转圈
        console.error('世界加载失败', err);
        if (!cancelled) useGameStore.getState().setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
      useGameStore.getState().setWorldReady(false);
      const w = worlds[dimension];
      if (w) void saveModifiedChunks(w, currentExtras(dimension, dimStates), dimPrefix(dimension));
      // 暂存本维度世界作用域状态（registry 快照：位置/容器/熔炉/酿造/TNT/信标），随后统一清理全部作用域系统
      dimStates[dimension] = {
        player: { ...playerPosition },
        scopes: snapshotWorldScopes(),
      };
      clearWorldScopes();
      worldRef.current = null;
      setActiveWorld(null);
    };
  }, [mode, seed, kind, worldRetry, dimension]);

  // 定期存档 + 关闭页面前兜底
  useEffect(() => {
    if (!world) return;
    const flush = () => {
      void saveModifiedChunks(world, currentExtras(dimension, dimStateRef.current), dimPrefix(dimension));
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
  }, [world, dimension]);

  // 每帧：重建脏 chunk 网格（限流）+ 按玩家位置调度 chunk + 统一模拟循环（lib/sim.ts）
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
    // 每帧按时间片调度 chunk 生成：加载期大预算全速铺满，游玩期 6ms 防止成批生成叠出长任务
    try {
      const remaining = w.updateAround(
        playerPosition.x,
        playerPosition.z,
        useGameStore.getState().settings.renderDistance,
        initialLoadRef.current ? GEN_BUDGET_LOAD : GEN_BUDGET_PLAY,
      );
      if (remaining === 0) initialLoadRef.current = false;
    } catch (err) {
      console.error('chunk 调度失败（下帧重试）', err);
    }
    // 统一模拟循环：生物/流体/重力/作物/昼夜/红石/熔炉/酿造的 tick 与暂停策略全部收口在 lib/sim.ts
    tickWorld(w, delta);
    debugInfo.chunks = w.chunks.size;
    debugInfo.dirty = w.dirtyChunks.size;
    if (w.generation !== lastGeneration.current) {
      // chunk 集合变化：对首次出现的 chunk 重扫登记作物/树苗（新生成与读档恢复都直写 data，
      // 不走 setBlock 钩子，村庄农田的小麦也靠这里开始生长）；卸载的 chunk 从记录中移除
      const scanned = scannedChunksRef.current;
      for (const [k, c] of w.chunks) {
        if (scanned.has(k)) continue;
        rescanCropsChunk(w, c.cx, c.cz);
        rescanSaplingsChunk(w, c.cx, c.cz);
        scanned.add(k);
      }
      for (const k of scanned) {
        if (!w.chunks.has(k)) scanned.delete(k);
      }
    }
    if (drained > 0 || w.generation !== lastGeneration.current) {
      lastGeneration.current = w.generation;
      setChunkList(Array.from(w.chunks.values()));
    }
  });

  if (!world || !materials) return null;
  return (
    <>
      {chunkList.map((c) => (
        // 只传坐标（不传 chunk 对象、不传 world 实例）：world 走 getActiveWorld() 单例，
        // 避免 dev 的 React DevTools 序列化 fiber props 时拖出 world 的数百 MB chunk 数据
        <ChunkMesh
          key={`${c.cx},${c.cz}`}
          cx={c.cx}
          cz={c.cz}
          version={c.version}
          materials={materials}
        />
      ))}
    </>
  );
}
