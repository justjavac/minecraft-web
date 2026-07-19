'use client';

import { memo, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { buildChunkGeometry, type GeometryData } from '@/lib/mesher';
import { getMesherPool } from '@/lib/mesherPool';
import type { Chunk, World } from '@/lib/world';
import type { AtlasMaterials } from '@/lib/textures';

export function toGeometry(data: GeometryData): THREE.BufferGeometry | null {
  if (data.indices.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
  geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
  return geo;
}

interface ChunkMeshProps {
  world: World;
  chunk: Chunk;
  /** chunk.version 变化时重建几何 */
  version: number;
  materials: AtlasMaterials;
}

export const ChunkMesh = memo(function ChunkMesh({ world, chunk, version, materials }: ChunkMeshProps) {
  const groupRef = useRef<THREE.Group>(null);
  /** 当前展示中的 mesh（新几何就绪后才替换，消除加载闪烁） */
  const currentRef = useRef<THREE.Mesh[]>([]);

  // 网格化优先交给 Worker 池（后台线程）；Worker 不可用或出错时回退主线程同步构建。
  // 旧 mesh 保留到新几何就绪再交换；mesh 命令式创建（three#30398），几何与 effect 成对释放
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    let cancelled = false;
    const key = `${chunk.cx},${chunk.cz}`;

    const datas: (Uint16Array | null)[] = [];
    const lights: (Uint8Array | null)[] = [];
    const skys: (Uint8Array | null)[] = [];
    for (let gz = -1; gz <= 1; gz++) {
      for (let gx = -1; gx <= 1; gx++) {
        const c = world.chunks.get(`${chunk.cx + gx},${chunk.cz + gz}`);
        datas.push(c?.data ?? null);
        lights.push(c?.light ?? null);
        skys.push(c?.sky ?? null);
      }
    }

    const swap = (solid: GeometryData, water: GeometryData): void => {
      if (cancelled) return;
      const next: THREE.Mesh[] = [];
      for (const [data, mat] of [
        [solid, materials.solid],
        [water, materials.water],
      ] as const) {
        const geo = toGeometry(data);
        if (!geo) continue;
        const mesh = new THREE.Mesh(geo, mat);
        next.push(mesh);
        group.add(mesh);
      }
      for (const m of currentRef.current) {
        m.removeFromParent();
        m.geometry.dispose();
      }
      currentRef.current = next;
    };

    const fallback = () => {
      // 微任务延后：StrictMode 模拟卸载先跑完 cleanup，避免同步构建出的几何被误销毁
      queueMicrotask(() => {
        if (cancelled) return;
        const { solid, water } = buildChunkGeometry(world, chunk);
        swap(solid, water);
      });
    };

    const pool = getMesherPool();
    if (pool) {
      pool
        .build(key, version, chunk.cx, chunk.cz, datas, lights, skys)
        .then(({ solid, water, version: v }) => {
          if (cancelled) return;
          if (v !== version) return; // 过期结果
          // Worker 结果为空但中心 chunk 实际有内容：说明 worker 出错，回退主线程
          if (solid.indices.length === 0 && water.indices.length === 0 && datas[4]?.some((b) => b !== 0)) {
            fallback();
            return;
          }
          swap(solid, water);
        })
        .catch(() => {
          if (!cancelled) fallback();
        });
    } else {
      fallback();
    }
    return () => {
      cancelled = true;
    };
  }, [world, chunk, version, materials]);

  // 组件卸载时清理当前 mesh（StrictMode 模拟卸载发生在任何构建完成之前，数组必为空，安全）
  useEffect(
    () => () => {
      for (const m of currentRef.current) {
        m.removeFromParent();
        m.geometry.dispose();
      }
      currentRef.current = [];
    },
    [],
  );

  return <group ref={groupRef} />;
});
