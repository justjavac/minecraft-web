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

  // 网格化优先交给 Worker 池（后台线程，流式加载不卡主线程）；
  // Worker 不可用时回退主线程同步构建。mesh 命令式创建/销毁——几何生命周期与
  // effect 严格成对（StrictMode 安全）；每次重建都是新 mesh（three#30398）
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    let cancelled = false;
    const meshes: THREE.Mesh[] = [];
    const key = `${chunk.cx},${chunk.cz}`;

    const attach = (solid: GeometryData, water: GeometryData) => {
      if (cancelled) return;
      for (const [data, mat] of [
        [solid, materials.solid],
        [water, materials.water],
      ] as const) {
        const geo = toGeometry(data);
        if (!geo) continue;
        const mesh = new THREE.Mesh(geo, mat);
        meshes.push(mesh);
        group.add(mesh);
      }
    };
    const detach = () => {
      cancelled = true;
      for (const mesh of meshes) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
      }
      meshes.length = 0;
    };

    const datas: (Uint16Array | null)[] = [];
    for (let gz = -1; gz <= 1; gz++) {
      for (let gx = -1; gx <= 1; gx++) {
        datas.push(world.chunks.get(`${chunk.cx + gx},${chunk.cz + gz}`)?.data ?? null);
      }
    }

    const pool = getMesherPool();
    if (pool) {
      void pool.build(key, version, chunk.cx, chunk.cz, datas).then(({ solid, water, version: v }) => {
        // 版本已更新或已卸载：丢弃过期结果（几何数组未使用，随 GC 回收）
        if (cancelled || v !== version) return;
        attach(solid, water);
      });
    } else {
      const { solid, water } = buildChunkGeometry(world, chunk);
      attach(solid, water);
    }
    return detach;
  }, [world, chunk, version, materials]);

  return <group ref={groupRef} />;
});
